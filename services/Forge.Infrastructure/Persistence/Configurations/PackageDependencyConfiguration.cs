using Forge.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Forge.Infrastructure.Persistence.Configurations;

public sealed class PackageDependencyConfiguration : IEntityTypeConfiguration<PackageDependency>
{
    public void Configure(EntityTypeBuilder<PackageDependency> builder)
    {
        builder.ToTable("package_dependencies");
        builder.HasKey(d => new { d.VersionId, d.DependsOnName });

        builder.Property(d => d.DependsOnName).IsRequired();
        builder.Property(d => d.VersionRange).IsRequired();
        builder.Property(d => d.IsOptional).HasDefaultValue(false);
    }
}
