using Forge.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Forge.Infrastructure.Persistence.Configurations;

public sealed class GenerationRequestConfiguration : IEntityTypeConfiguration<GenerationRequest>
{
    public void Configure(EntityTypeBuilder<GenerationRequest> builder)
    {
        builder.ToTable("generation_requests");
        builder.HasKey(g => g.Id);

        builder.Property(g => g.UserPrompt).IsRequired();
        builder.Property(g => g.Category).IsRequired();
        builder.Property(g => g.Status).IsRequired();
        builder.Property(g => g.CreatedAt).IsRequired();

        // docs/adr/0016 Decision 6's live per-workspace-per-day budget
        // check: `COUNT(*) WHERE workspace_id = @ws AND created_at >
        // @todayStart AND status NOT IN (...)`. Same shape as
        // ix_assets_workspace_created (AssetConfiguration).
        builder.HasIndex(g => new { g.WorkspaceId, g.CreatedAt })
            .HasDatabaseName("ix_generation_requests_workspace_created")
            .IsDescending(false, true);

        // Backs Forge.Functions.ArtGen's worker claim query (N3), the
        // same low-cardinality-but-tiny-active-subset shape as
        // ix_assets_status/ix_builds_status.
        builder.HasIndex(g => g.Status)
            .HasDatabaseName("ix_generation_requests_status");

        builder.HasOne(g => g.Workspace)
            .WithMany()
            .HasForeignKey(g => g.WorkspaceId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.HasOne(g => g.Project)
            .WithMany()
            .HasForeignKey(g => g.ProjectId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.HasOne(g => g.RequestedBy)
            .WithMany()
            .HasForeignKey(g => g.RequestedByUserId)
            .OnDelete(DeleteBehavior.SetNull);

        builder.HasMany(g => g.Variations)
            .WithOne(v => v.GenerationRequest)
            .HasForeignKey(v => v.GenerationRequestId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}

public sealed class GenerationVariationConfiguration : IEntityTypeConfiguration<GenerationVariation>
{
    public void Configure(EntityTypeBuilder<GenerationVariation> builder)
    {
        builder.ToTable("generation_variations");
        builder.HasKey(v => v.Id);

        builder.Property(v => v.ProcessedBlobPath).IsRequired();
        builder.Property(v => v.CreatedAt).IsRequired();

        builder.HasIndex(v => v.GenerationRequestId)
            .HasDatabaseName("ix_generation_variations_generation_request");
    }
}
