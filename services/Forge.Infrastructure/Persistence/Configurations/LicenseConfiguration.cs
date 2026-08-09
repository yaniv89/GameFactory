using Forge.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Forge.Infrastructure.Persistence.Configurations;

public sealed class LicenseConfiguration : IEntityTypeConfiguration<License>
{
    public void Configure(EntityTypeBuilder<License> builder)
    {
        builder.ToTable("licenses");
        builder.HasKey(l => l.Id);
        builder.Property(l => l.Id).HasDefaultValueSql("gen_random_uuid()");

        builder.Property(l => l.GrantedVia).IsRequired();
        builder.Property(l => l.GrantedAt).IsRequired();

        // docs/SPEC.md Section 6.2: one license per (package, workspace)
        // — a repeat purchase of an already-owned package is rejected at
        // the endpoint, not silently allowed to create a second row.
        builder.HasIndex(l => new { l.PackageId, l.WorkspaceId }).IsUnique();

        // Backs "does this workspace currently have access" checks —
        // partial on revoked_at IS NULL so a revoked license (refund)
        // never shows up in that lookup without a table scan.
        builder.HasIndex(l => l.WorkspaceId)
            .HasFilter("revoked_at IS NULL")
            .HasDatabaseName("ix_licenses_workspace");

        builder.HasOne(l => l.Package)
            .WithMany()
            .HasForeignKey(l => l.PackageId)
            .OnDelete(DeleteBehavior.Restrict);

        builder.HasOne(l => l.Workspace)
            .WithMany()
            .HasForeignKey(l => l.WorkspaceId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.HasOne(l => l.Purchase)
            .WithMany()
            .HasForeignKey(l => l.PurchaseId)
            .OnDelete(DeleteBehavior.Restrict);
    }
}
