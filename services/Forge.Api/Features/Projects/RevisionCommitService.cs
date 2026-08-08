using System.Data;
using System.Security.Cryptography;
using System.Text.Json;
using Forge.Domain.Entities;
using Forge.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
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
        // this method is for; the catch clause below turns that into the
        // same Conflict result the pre-commit check produces, rather than
        // an unhandled exception surfacing as a 500. Confirmed against a
        // real Postgres serialization failure in CI (not just reasoned
        // about): EF Core doesn't surface the PostgresException directly
        // here — because this transaction is manually managed rather than
        // wrapped in the context's execution strategy, EF re-wraps it in
        // an InvalidOperationException ("likely due to a transient
        // failure") around the DbUpdateException around the
        // PostgresException, specifically because it can't safely retry a
        // transaction it doesn't own. Matching on exception *type* alone
        // (DbUpdateException, or PostgresException directly) missed that
        // wrapping in the first CI run; this walks the whole
        // InnerException chain instead.
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
        catch (Exception ex) when (IsRetryableSerializationConflict(ex))
        {
            // Deliberately not reading back the actual head revision to
            // populate ActualHeadRevision here (unlike the pre-commit
            // conflict branch above, which reads it inside the still-live
            // transaction before anything has gone wrong). Also confirmed
            // in CI: once Postgres reports a serialization failure, the
            // underlying NpgsqlTransaction is already done —
            // NpgsqlTransaction.Rollback() throws "This NpgsqlTransaction
            // has completed; it is no longer usable" if called explicitly
            // here, and any further query on this same connection/tx
            // would be built on the same broken state. Returning null and
            // letting the caller's normal re-fetch-on-conflict path
            // (docs/SPEC.md Section 13.3) run on a fresh request/DbContext
            // is the safe way to recover this specific detail, not a
            // missing feature. The `await using tx` above still disposes
            // safely on method exit — Dispose, unlike Rollback, is a
            // documented no-op against an already-completed transaction.
            return new CommitResult(CommitResultKind.Conflict, null, null);
        }
    }

    /// <summary>
    /// Walks the exception chain because EF Core's wrapping of a
    /// transient Postgres error depends on call shape (see the doc
    /// comment above) — matching a single exception type isn't reliable.
    ///
    /// Matches two distinct SqlStates, both confirmed against real
    /// Postgres errors in CI, not just reasoned about:
    /// <see cref="PostgresErrorCodes.SerializationFailure"/> (40001) is
    /// the ordinary "another transaction's write actually conflicts with
    /// this one" case. <see cref="PostgresErrorCodes.OutOfMemory"/>
    /// (53200) is a different failure a real CI run at 200-way concurrent
    /// Serializable transactions also produced: "not enough elements in
    /// RWConflictPool to record a read/write conflict" — Postgres's
    /// fixed-size predicate-lock tracking pool for Serializable Snapshot
    /// Isolation, exhausted by tracking too many simultaneous
    /// transactions' read/write dependencies at once, not a general
    /// system out-of-memory condition (a real one would come from a
    /// different code path than this transaction's own predicate-lock
    /// bookkeeping). Safe to treat the same as a serialization conflict
    /// here specifically because the only large-allocation structure this
    /// method's own transaction touches is that predicate-lock pool — a
    /// production Postgres under enough real concurrent load can hit the
    /// same ceiling as this CI run did, and the correct response is the
    /// same as an ordinary conflict: ask the caller to retry, not leak a
    /// 500.
    /// </summary>
    private static bool IsRetryableSerializationConflict(Exception ex)
    {
        for (var current = ex; current is not null; current = current.InnerException)
        {
            if (current is PostgresException { SqlState: PostgresErrorCodes.SerializationFailure or PostgresErrorCodes.OutOfMemory })
            {
                return true;
            }
        }
        return false;
    }
}
