using Forge.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Forge.Infrastructure.Persistence.Configurations;

public sealed class ProjectRevisionConfiguration : IEntityTypeConfiguration<ProjectRevision>
{
    public void Configure(EntityTypeBuilder<ProjectRevision> builder)
    {
        builder.ToTable("project_revisions");
        builder.HasKey(r => r.Id);

        builder.Property(r => r.Doc).HasColumnType("jsonb").IsRequired();
        builder.Property(r => r.DocHash).HasColumnType("bytea").IsRequired();
        builder.Property(r => r.SizeBytes).IsRequired();
        builder.Property(r => r.IsCheckpoint).HasDefaultValue(false);
        builder.Property(r => r.CreatedAt).IsRequired();

        builder.HasIndex(r => new { r.ProjectId, r.CreatedAt })
            .HasDatabaseName("ix_revisions_project_created")
            .IsDescending(false, true);

        // Backs ListRevisionsEndpoint's keyset pagination (M5 Phase 3):
        // WHERE project_id = X [AND id < cursor] ORDER BY id DESC. Ids are
        // a monotonic BIGSERIAL assigned inside RevisionCommitService's
        // own transaction, so id order is commit order — a separate
        // timestamp-based index isn't needed for this access pattern, but
        // the composite above doesn't help ORDER BY id, only ORDER BY
        // created_at, so this ships alongside the query that needs it
        // (CLAUDE.md Section 1.5 guardrail 19).
        builder.HasIndex(r => new { r.ProjectId, r.Id })
            .HasDatabaseName("ix_revisions_project_id")
            .IsDescending(false, true);

        builder.HasOne<ProjectRevision>()
            .WithMany()
            .HasForeignKey(r => r.ParentId)
            .OnDelete(DeleteBehavior.Restrict);

        builder.HasOne(r => r.Author)
            .WithMany()
            .HasForeignKey(r => r.AuthorId)
            .OnDelete(DeleteBehavior.SetNull);
    }
}
