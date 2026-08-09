using Forge.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Forge.Infrastructure.Persistence.Configurations;

public sealed class ListingConfiguration : IEntityTypeConfiguration<Listing>
{
    public void Configure(EntityTypeBuilder<Listing> builder)
    {
        builder.ToTable("listings", t => t.HasCheckConstraint(
            "ck_price",
            "(pricing_model = 'free' AND price_cents = 0) OR (pricing_model <> 'free' AND price_cents > 0)"));

        // The package id IS this row's own primary key (docs/SPEC.md
        // Section 6.2) — a listing is not a separate thing with its own
        // identity, it's the pricing half of a Package, one-to-one.
        builder.HasKey(l => l.PackageId);

        builder.Property(l => l.PricingModel).IsRequired();
        builder.Property(l => l.PriceCents).HasDefaultValue(0).IsRequired();
        builder.Property(l => l.Currency).HasColumnType("char(3)").HasDefaultValue("USD").IsRequired();
        builder.Property(l => l.RevenueShareBps).HasDefaultValue(8000).IsRequired();
        builder.Property(l => l.IsListed).HasDefaultValue(true).IsRequired();

        builder.HasOne(l => l.Package)
            .WithOne()
            .HasForeignKey<Listing>(l => l.PackageId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}
