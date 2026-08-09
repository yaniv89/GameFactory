using Forge.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Forge.Infrastructure.Persistence.Configurations;

public sealed class PackageVersionConfiguration : IEntityTypeConfiguration<PackageVersion>
{
    public void Configure(EntityTypeBuilder<PackageVersion> builder)
    {
        builder.ToTable("package_versions");
        builder.HasKey(v => v.Id);
        builder.Property(v => v.Id).HasDefaultValueSql("gen_random_uuid()");

        builder.Property(v => v.Version).IsRequired();
        builder.Property(v => v.EngineRange).IsRequired();
        builder.Property(v => v.Manifest).HasColumnType("jsonb").IsRequired();
        builder.Property(v => v.BundleUrl).IsRequired();
        builder.Property(v => v.BundleSha256).HasColumnType("bytea").IsRequired();
        builder.Property(v => v.SizeBytes).IsRequired();
        builder.Property(v => v.ScanStatus).HasDefaultValue(PackageScanStatus.Pending).IsRequired();
        builder.Property(v => v.ScanReport).HasColumnType("jsonb");
        builder.Property(v => v.PublishedAt).IsRequired();

        // Published versions are immutable and never renumbered — this is
        // the constraint that makes "immutable publish" (docs/SPEC.md
        // Section 10.4 step 6) an actual guarantee, not just a policy.
        builder.HasIndex(v => new { v.PackageId, v.Version }).IsUnique();

        // Backs GetPackageVersionEndpoint and ResolveDependenciesEndpoint,
        // both of which need "every non-yanked version of this package,
        // newest first" (CLAUDE.md Section 1.5 guardrail 19).
        builder.HasIndex(v => new { v.PackageId, v.PublishedAt })
            .HasDatabaseName("ix_package_versions_pkg")
            .IsDescending(false, true);

        builder.HasMany(v => v.Dependencies)
            .WithOne(d => d.Version)
            .HasForeignKey(d => d.VersionId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}
