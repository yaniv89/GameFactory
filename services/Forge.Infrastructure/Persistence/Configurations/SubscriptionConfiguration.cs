using Forge.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Forge.Infrastructure.Persistence.Configurations;

public sealed class SubscriptionConfiguration : IEntityTypeConfiguration<Subscription>
{
    public void Configure(EntityTypeBuilder<Subscription> builder)
    {
        builder.ToTable("subscriptions");
        builder.HasKey(s => s.Id);
        builder.Property(s => s.Id).HasDefaultValueSql("gen_random_uuid()");

        builder.Property(s => s.StripeCustomerId).IsRequired();
        builder.Property(s => s.StripeSubscriptionId);
        builder.HasIndex(s => s.StripeSubscriptionId).IsUnique();

        builder.Property(s => s.Plan).IsRequired();
        builder.Property(s => s.Status).IsRequired();
        builder.Property(s => s.CancelAtPeriodEnd).HasDefaultValue(false);
        builder.Property(s => s.CreatedAt).IsRequired();
        builder.Property(s => s.UpdatedAt).IsRequired();

        // Two distinct indexes on the same column, matching docs/SPEC.md
        // Section 6.2 exactly — both need explicit, distinct names or EF
        // Core collapses them into one.
        builder.HasIndex(s => s.WorkspaceId)
            .HasDatabaseName("ix_subscriptions_workspace");

        // A workspace may have at most one row whose status is
        // trialing/active/past_due at a time, enforced by the database,
        // not just application code — the webhook handler (Phase 5) still
        // has to upsert correctly, but this is the backstop against a race
        // producing two "current" subscriptions for one workspace.
        builder.HasIndex(s => s.WorkspaceId)
            .HasFilter("status IN ('trialing', 'active', 'past_due')")
            .IsUnique()
            .HasDatabaseName("ix_subscriptions_active_per_workspace");

        builder.HasOne(s => s.Workspace)
            .WithMany()
            .HasForeignKey(s => s.WorkspaceId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}
