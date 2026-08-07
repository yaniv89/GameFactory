using Forge.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Forge.Infrastructure.Persistence.Configurations;

public sealed class ProjectConfiguration : IEntityTypeConfiguration<Project>
{
    public void Configure(EntityTypeBuilder<Project> builder)
    {
        builder.ToTable("projects");
        builder.HasKey(p => p.Id);
        builder.Property(p => p.Id).HasDefaultValueSql("gen_random_uuid()");

        builder.Property(p => p.Slug).IsRequired();
        builder.Property(p => p.Title).IsRequired();
        builder.Property(p => p.GenreTemplate).HasDefaultValue("topdown-rpg").IsRequired();
        builder.Property(p => p.EngineVersion).IsRequired();
        builder.Property(p => p.Visibility).HasDefaultValue("private").IsRequired();
        builder.Property(p => p.CreatedAt).IsRequired();
        builder.Property(p => p.UpdatedAt).IsRequired();

        builder.HasIndex(p => new { p.WorkspaceId, p.Slug }).IsUnique();

        // The FK to project_revisions is added after that table exists,
        // same two-step the raw DDL uses (Section 6.2's own comment: "FK
        // applied after project_revisions exists") — EF's migration
        // generator sequences this automatically from the two
        // relationships below, no manual ordering needed here.
        builder.HasOne<ProjectRevision>()
            .WithMany()
            .HasForeignKey(p => p.HeadRevision)
            .OnDelete(DeleteBehavior.Restrict);

        builder.HasMany(p => p.Revisions)
            .WithOne(r => r.Project)
            .HasForeignKey(r => r.ProjectId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}
