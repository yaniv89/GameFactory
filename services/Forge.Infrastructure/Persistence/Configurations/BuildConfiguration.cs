using Forge.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Forge.Infrastructure.Persistence.Configurations;

public sealed class BuildConfiguration : IEntityTypeConfiguration<Build>
{
    public void Configure(EntityTypeBuilder<Build> builder)
    {
        builder.ToTable("builds");
        builder.HasKey(b => b.Id);

        builder.Property(b => b.Status).IsRequired();
        builder.Property(b => b.CreatedAt).IsRequired();

        // Explicit names: EFCore.NamingConventions' snake_case converter
        // doesn't split a digit run from the word immediately after it
        // (confirmed against a real generated migration, not assumed —
        // InlineScriptSha256Base64 came out as inline_script_sha256base64
        // otherwise), which reads badly for a column two other builds-table
        // strings don't have that problem with.
        builder.Property(b => b.InlineScriptSha256Base64).HasColumnName("inline_script_sha256_base64");
        builder.Property(b => b.InlineStyleSha256Base64).HasColumnName("inline_style_sha256_base64");

        // Backs GET .../builds and GET .../builds/{id}'s natural "most
        // recent first" ordering (ListRevisionsEndpoint's own
        // ix_revisions_project_created precedent).
        builder.HasIndex(b => new { b.ProjectId, b.CreatedAt })
            .HasDatabaseName("ix_builds_project_created")
            .IsDescending(false, true);

        // Backs Forge.Functions.Build's worker claim query (docs/adr/0010
        // Decision 4): `WHERE status = 'queued' ORDER BY created_at LIMIT 1
        // FOR UPDATE SKIP LOCKED`. A plain non-composite index on the
        // low-cardinality Status column alone would normally be a poor
        // choice, but here it's filtering to a tiny, constantly-draining
        // subset (Queued) out of a table where most rows quickly become
        // Ready/Failed — the same "the interesting rows are a small,
        // transient minority" shape PendingVersionScanner's own claim
        // query already relies on for package_versions.
        builder.HasIndex(b => b.Status)
            .HasDatabaseName("ix_builds_status");

        builder.HasOne(b => b.Project)
            .WithMany()
            .HasForeignKey(b => b.ProjectId)
            .OnDelete(DeleteBehavior.Cascade);

        // Restrict, not Cascade: a ProjectRevision is an append-only log
        // entry (ProjectRevisionConfiguration's own ParentId FK is
        // Restrict for the same reason) — a Build referencing one should
        // never be silently deleted by unrelated revision-log cleanup,
        // and nothing in this codebase deletes a ProjectRevision row
        // today regardless.
        builder.HasOne(b => b.Revision)
            .WithMany()
            .HasForeignKey(b => b.RevisionId)
            .OnDelete(DeleteBehavior.Restrict);

        builder.HasOne(b => b.RequestedBy)
            .WithMany()
            .HasForeignKey(b => b.RequestedByUserId)
            .OnDelete(DeleteBehavior.SetNull);
    }
}
