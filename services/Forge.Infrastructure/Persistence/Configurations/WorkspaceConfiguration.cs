using Forge.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Forge.Infrastructure.Persistence.Configurations;

public sealed class WorkspaceConfiguration : IEntityTypeConfiguration<Workspace>
{
    public void Configure(EntityTypeBuilder<Workspace> builder)
    {
        builder.ToTable("workspaces");
        builder.HasKey(w => w.Id);
        builder.Property(w => w.Id).HasDefaultValueSql("gen_random_uuid()");

        builder.Property(w => w.Slug).IsRequired();
        builder.HasIndex(w => w.Slug).IsUnique();

        builder.Property(w => w.Name).IsRequired();
        builder.Property(w => w.Plan).HasDefaultValue("free").IsRequired();
        builder.Property(w => w.SeatLimit).HasDefaultValue(1);
        builder.Property(w => w.StorageQuotaMb).HasDefaultValue(500);
        builder.Property(w => w.CreatedAt).IsRequired();

        builder.HasMany(w => w.Members)
            .WithOne(m => m.Workspace)
            .HasForeignKey(m => m.WorkspaceId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.HasMany(w => w.Projects)
            .WithOne(p => p.Workspace)
            .HasForeignKey(p => p.WorkspaceId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}
