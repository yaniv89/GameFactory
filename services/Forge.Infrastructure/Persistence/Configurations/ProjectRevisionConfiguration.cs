using Forge.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Forge.Infrastructure.Persistence.Configurations;

public sealed class ProjectRevisionConfiguration : IEntityTypeConfiguration<ProjectRevision>
{
    public void Configure(EntityTypeBuilder<ProjectRevision> builder)
    {
        builder.ToTable("project_revisions");
        builder.HasKey(r => r.Id);

        builder.Property(r => r.Doc).HasColumnType("jsonb").IsRequired();
        builder.Property(r => r.DocHash).HasColumnType("bytea").IsRequired();
        builder.Property(r => r.SizeBytes).IsRequired();
        builder.Property(r => r.IsCheckpoint).HasDefaultValue(false);
        builder.Property(r => r.CreatedAt).IsRequired();

        builder.HasIndex(r => new { r.ProjectId, r.CreatedAt })
            .HasDatabaseName("ix_revisions_project_created")
            .IsDescending(false, true);

        builder.HasOne<ProjectRevision>()
            .WithMany()
            .HasForeignKey(r => r.ParentId)
            .OnDelete(DeleteBehavior.Restrict);

        builder.HasOne(r => r.Author)
            .WithMany()
            .HasForeignKey(r => r.AuthorId)
            .OnDelete(DeleteBehavior.SetNull);
    }
}
