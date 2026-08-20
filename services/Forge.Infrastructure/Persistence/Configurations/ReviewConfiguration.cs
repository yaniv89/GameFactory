using Forge.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Forge.Infrastructure.Persistence.Configurations;

public sealed class ReviewConfiguration : IEntityTypeConfiguration<Review>
{
    public void Configure(EntityTypeBuilder<Review> builder)
    {
        builder.ToTable("reviews", t => t.HasCheckConstraint("ck_reviews_rating", "rating BETWEEN 1 AND 5"));
        builder.HasKey(r => r.Id);

        builder.Property(r => r.Rating).IsRequired();
        builder.Property(r => r.CreatedAt).IsRequired();

        // One current review per (package, reviewer) — an upsert target,
        // not a uniqueness check the endpoint has to race against
        // (ReviewsEndpoint's own PUT reads this row first, then either
        // updates or inserts within one request).
        builder.HasIndex(r => new { r.PackageId, r.UserId })
            .HasDatabaseName("ux_reviews_package_user")
            .IsUnique();

        // Backs ListReviewsEndpoint's "newest first" ordering and
        // PackageRankingCalculator's own per-package aggregate query —
        // both filter to one PackageId and want CreatedAt order.
        builder.HasIndex(r => new { r.PackageId, r.CreatedAt })
            .HasDatabaseName("ix_reviews_package_created")
            .IsDescending(false, true);

        builder.HasOne(r => r.Package)
            .WithMany(p => p.Reviews)
            .HasForeignKey(r => r.PackageId)
            .OnDelete(DeleteBehavior.Cascade);

        // SetNull, matching ProjectRevision.AuthorId's own FK exactly: a
        // review is content the platform keeps (and still counts toward
        // BayesianRating) even if the reviewing account is later deleted
        // — the row outlives the FK, it doesn't cascade away with it.
        builder.HasOne(r => r.User)
            .WithMany()
            .HasForeignKey(r => r.UserId)
            .OnDelete(DeleteBehavior.SetNull);
    }
}
