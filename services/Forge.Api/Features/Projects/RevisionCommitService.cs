using System.Data;
using System.Security.Cryptography;
using System.Text.Json;
using Forge.Domain.Entities;
using Forge.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Npgsql;

namespace Forge.Api.Features.Projects;

public enum CommitResultKind
{
    Committed,
    Deduplicated,
    ProjectNotFound,
    Conflict,
}

public sealed record CommitResult(CommitResultKind Kind, ProjectRevision? Revision, long? ActualHeadRevision);

/// <summary>
/// The optimistic-concurrency commit path shared by
/// <see cref="CommitRevisionEndpoint"/> and <see cref="RestoreRevisionEndpoint"/>
/// (docs/SPEC.md Section 13.3) — restoring an old revision is, underneath,
/// committing its document as a new head, so both endpoints go through
/// the same conflict-safe write rather than duplicating the transaction
/// and dedupe logic.
/// </summary>
public static class RevisionCommitService
{
    public static async Task<CommitResult> CommitAsync(
        ForgeDbContext db,
        Guid projectId,
        Guid? authorId,
        long? expectedHeadRevision,
        string? label,
        bool isCheckpoint,
        JsonElement document,
        CancellationToken ct)
    {
        var raw = JsonSerializer.SerializeToUtf8Bytes(document);
        var hash = SHA256.HashData(raw);

        // Serializable isolation: concurrent commits to the same project
        // must not interleave and silently drop one author's work. Two
        // transactions can both pass the expectedHeadRevision check below
        // against the same pre-conflict head — Postgres then rejects one
        // of them at commit time with a 40001 serialization failure
        // instead of letting it through, which is exactly the guarantee
        // this method is for; the catch clauses below turn that into the
        // same Conflict result the pre-commit check produces, rather than
        // an unhandled exception surfacing as a 500.
        await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct);

        try
        {
            var project = await db.Projects
                .Where(p => p.Id == projectId && p.DeletedAt == null)
                .Select(p => new { p.Id, p.HeadRevision })
                .SingleOrDefaultAsync(ct);
            if (project is null) return new CommitResult(CommitResultKind.ProjectNotFound, null, null);

            if (project.HeadRevision != expectedHeadRevision)
            {
                return new CommitResult(CommitResultKind.Conflict, null, project.HeadRevision);
            }

            // Content-addressed dedupe: committing the document already at
            // head is a no-op, not a new revision row.
            var existing = await db.ProjectRevisions
                .Where(r => r.ProjectId == projectId && r.DocHash == hash)
                .OrderByDescending(r => r.Id)
                .FirstOrDefaultAsync(ct);
            if (existing is not null && existing.Id == project.HeadRevision)
            {
                await tx.CommitAsync(ct);
                return new CommitResult(CommitResultKind.Deduplicated, existing, existing.Id);
            }

            var revision = new ProjectRevision
            {
                ProjectId = projectId,
                ParentId = project.HeadRevision,
                AuthorId = authorId,
                Label = label,
                Doc = document,
                DocHash = hash,
                SizeBytes = raw.Length,
                IsCheckpoint = isCheckpoint,
                CreatedAt = DateTimeOffset.UtcNow,
            };
            db.ProjectRevisions.Add(revision);
            await db.SaveChangesAsync(ct);

            await db.Projects
                .Where(p => p.Id == projectId)
                .ExecuteUpdateAsync(s => s
                    .SetProperty(p => p.HeadRevision, revision.Id)
                    .SetProperty(p => p.UpdatedAt, DateTimeOffset.UtcNow), ct);

            await tx.CommitAsync(ct);
            return new CommitResult(CommitResultKind.Committed, revision, revision.Id);
        }
        catch (PostgresException ex) when (ex.SqlState == PostgresErrorCodes.SerializationFailure)
        {
            return await ConflictAfterSerializationFailureAsync(db, tx, projectId, ct);
        }
        catch (DbUpdateException ex) when (ex.InnerException is PostgresException { SqlState: PostgresErrorCodes.SerializationFailure })
        {
            return await ConflictAfterSerializationFailureAsync(db, tx, projectId, ct);
        }
    }

    /// <summary>
    /// Postgres leaves the connection in an aborted state after a
    /// serialization failure — "current transaction is aborted, commands
    /// ignored until end of transaction block" — until the transaction is
    /// explicitly rolled back, so that has to happen here before this can
    /// run its own read for the actual current head revision the caller
    /// should rebase onto (the <c>await using</c> in <see cref="CommitAsync"/>
    /// only rolls back on method exit, which is too late for the read
    /// below). The <c>await using</c> disposal that follows is then a
    /// no-op against an already-completed transaction.
    /// </summary>
    private static async Task<CommitResult> ConflictAfterSerializationFailureAsync(
        ForgeDbContext db, IDbContextTransaction tx, Guid projectId, CancellationToken ct)
    {
        await tx.RollbackAsync(ct);
        var currentHead = await db.Projects
            .Where(p => p.Id == projectId && p.DeletedAt == null)
            .Select(p => (long?)p.HeadRevision)
            .SingleOrDefaultAsync(ct);
        return new CommitResult(CommitResultKind.Conflict, null, currentHead);
    }
}
