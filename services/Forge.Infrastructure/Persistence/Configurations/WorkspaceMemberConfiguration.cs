using Forge.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Forge.Infrastructure.Persistence.Configurations;

public sealed class WorkspaceMemberConfiguration : IEntityTypeConfiguration<WorkspaceMember>
{
    public void Configure(EntityTypeBuilder<WorkspaceMember> builder)
    {
        builder.ToTable("workspace_members");
        builder.HasKey(m => new { m.WorkspaceId, m.UserId });

        builder.Property(m => m.Role).IsRequired();
        builder.Property(m => m.JoinedAt).IsRequired();

        // Backs "list every workspace a user belongs to" (GET /api/v1/me),
        // the one query pattern on this table that doesn't already start
        // from workspace_id via the primary key.
        builder.HasIndex(m => m.UserId);

        builder.HasOne(m => m.User)
            .WithMany()
            .HasForeignKey(m => m.UserId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}
