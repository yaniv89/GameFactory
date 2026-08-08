using Forge.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Forge.Infrastructure.Persistence.Configurations;

public sealed class PackageConfiguration : IEntityTypeConfiguration<Package>
{
    public void Configure(EntityTypeBuilder<Package> builder)
    {
        builder.ToTable("packages");
        builder.HasKey(p => p.Id);
        builder.Property(p => p.Id).HasDefaultValueSql("gen_random_uuid()");

        builder.Property(p => p.Name).IsRequired();
        builder.Property(p => p.Kind).IsRequired();
        builder.Property(p => p.DisplayName).IsRequired();
        builder.Property(p => p.Summary).IsRequired();
        builder.Property(p => p.LicenseSpdx).IsRequired();
        builder.Property(p => p.IsDeprecated).HasDefaultValue(false);
        builder.Property(p => p.CreatedAt).IsRequired();

        builder.HasIndex(p => p.Name).IsUnique();

        // docs/SPEC.md Section 6.2: a trigram GIN index backing
        // ListPackagesEndpoint's ILIKE search (CLAUDE.md Section 1.5
        // guardrail 19 — the query and its index ship together). Requires
        // the pg_trgm extension, enabled in ForgeDbContext.OnModelCreating.
        builder.HasIndex(p => new { p.DisplayName, p.Summary })
            .HasDatabaseName("ix_packages_search")
            .HasMethod("gin")
            .HasOperators("gin_trgm_ops", "gin_trgm_ops");

        builder.HasOne(p => p.Author)
            .WithMany()
            .HasForeignKey(p => p.AuthorUserId)
            .OnDelete(DeleteBehavior.Restrict);

        builder.HasMany(p => p.Versions)
            .WithOne(v => v.Package)
            .HasForeignKey(v => v.PackageId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}
