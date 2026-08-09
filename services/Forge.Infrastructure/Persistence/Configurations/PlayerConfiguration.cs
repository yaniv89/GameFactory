using Forge.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Forge.Infrastructure.Persistence.Configurations;

public sealed class PlayerConfiguration : IEntityTypeConfiguration<Player>
{
    public void Configure(EntityTypeBuilder<Player> builder)
    {
        builder.ToTable("players");
        builder.HasKey(p => p.Id);
        builder.Property(p => p.Id).HasDefaultValueSql("gen_random_uuid()");

        builder.Property(p => p.CreatedAt).IsRequired();

        // Deliberately no unique index on LinkedUserId: one Forge account
        // can link more than one anonymous identity (one per device this
        // person has played from) — see this entity's own doc comment.
        builder.HasIndex(p => p.LinkedUserId);

        builder.HasOne(p => p.LinkedUser)
            .WithMany()
            .HasForeignKey(p => p.LinkedUserId)
            .OnDelete(DeleteBehavior.SetNull);
    }
}
