using Forge.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Forge.Infrastructure.Persistence.Configurations;

public sealed class AssetConfiguration : IEntityTypeConfiguration<Asset>
{
    public void Configure(EntityTypeBuilder<Asset> builder)
    {
        builder.ToTable("assets");
        builder.HasKey(a => a.Id);

        builder.Property(a => a.OriginalName).IsRequired();
        builder.Property(a => a.DeclaredMimeType).IsRequired();
        builder.Property(a => a.Status).IsRequired();
        builder.Property(a => a.QuarantineBlobPath).IsRequired();
        builder.Property(a => a.Sha256).IsRequired();
        builder.Property(a => a.CreatedAt).IsRequired();

        // SPEC 6.2's own dedupe index, carried forward unchanged
        // (docs/adr/0012 Decision 2): a re-upload of already-known bytes
        // to the same workspace short-circuits onto the existing row
        // rather than reprocessing. Partial (WHERE deleted_at IS NULL) so
        // a deleted asset's hash can be re-uploaded as a fresh row.
        builder.HasIndex(a => new { a.WorkspaceId, a.Sha256 })
            .HasDatabaseName("ux_assets_workspace_sha256")
            .IsUnique()
            .HasFilter("deleted_at IS NULL");

        // Backs Forge.Functions.Assets's worker claim query (docs/adr/0012
        // Decision 4): `WHERE status = 'pending' ORDER BY created_at LIMIT
        // 1 FOR UPDATE SKIP LOCKED` — same low-cardinality-but-tiny-active-
        // subset shape as ix_builds_status/PendingVersionScanner's own
        // claim index.
        builder.HasIndex(a => a.Status)
            .HasDatabaseName("ix_assets_status");

        // Backs ListAssetsEndpoint's "newest first, this workspace only"
        // query — ix_builds_project_created's own precedent, keyed on
        // workspace instead of project since assets are workspace-scoped
        // (optionally project-scoped, docs/adr/0012 Decision 2).
        builder.HasIndex(a => new { a.WorkspaceId, a.CreatedAt })
            .HasDatabaseName("ix_assets_workspace_created")
            .IsDescending(false, true);

        builder.HasOne(a => a.Workspace)
            .WithMany()
            .HasForeignKey(a => a.WorkspaceId)
            .OnDelete(DeleteBehavior.Cascade);

        // Cascade, matching SPEC 6.2's own raw DDL for this FK
        // (`project_id UUID REFERENCES projects(id) ON DELETE CASCADE`)
        // verbatim: a project-scoped asset has no purpose once its project
        // is gone. Workspace-shared assets (ProjectId null) are untouched.
        builder.HasOne(a => a.Project)
            .WithMany()
            .HasForeignKey(a => a.ProjectId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.HasOne(a => a.RequestedBy)
            .WithMany()
            .HasForeignKey(a => a.RequestedByUserId)
            .OnDelete(DeleteBehavior.SetNull);
    }
}
