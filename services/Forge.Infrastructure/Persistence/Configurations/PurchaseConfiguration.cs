using Forge.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Forge.Infrastructure.Persistence.Configurations;

public sealed class PurchaseConfiguration : IEntityTypeConfiguration<Purchase>
{
    public void Configure(EntityTypeBuilder<Purchase> builder)
    {
        builder.ToTable("purchases");
        builder.HasKey(p => p.Id);
        builder.Property(p => p.Id).HasDefaultValueSql("gen_random_uuid()");

        builder.Property(p => p.AmountCents).IsRequired();
        builder.Property(p => p.Currency).HasColumnType("char(3)").IsRequired();
        builder.Property(p => p.AuthorShareCents).IsRequired();
        builder.Property(p => p.StripePaymentIntent).IsRequired();
        builder.HasIndex(p => p.StripePaymentIntent).IsUnique();
        builder.Property(p => p.Status).IsRequired();
        builder.Property(p => p.CreatedAt).IsRequired();

        // Backs GET /api/v1/workspaces/{ws}/licenses' purchase-history
        // view and an author's earnings query (M7 Phase 5) — both filter
        // by one side of this relationship and want newest-first.
        builder.HasIndex(p => new { p.WorkspaceId, p.CreatedAt });
        builder.HasIndex(p => new { p.PackageId, p.CreatedAt });

        builder.HasOne(p => p.Workspace)
            .WithMany()
            .HasForeignKey(p => p.WorkspaceId)
            .OnDelete(DeleteBehavior.Restrict);

        builder.HasOne(p => p.Buyer)
            .WithMany()
            .HasForeignKey(p => p.BuyerUserId)
            .OnDelete(DeleteBehavior.Restrict);

        builder.HasOne(p => p.Package)
            .WithMany()
            .HasForeignKey(p => p.PackageId)
            .OnDelete(DeleteBehavior.Restrict);
    }
}
