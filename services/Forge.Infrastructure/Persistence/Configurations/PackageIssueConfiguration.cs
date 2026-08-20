using Forge.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Forge.Infrastructure.Persistence.Configurations;

public sealed class PackageIssueConfiguration : IEntityTypeConfiguration<PackageIssue>
{
    public void Configure(EntityTypeBuilder<PackageIssue> builder)
    {
        builder.ToTable("package_issues");
        builder.HasKey(i => i.Id);

        builder.Property(i => i.Title).IsRequired();
        builder.Property(i => i.CreatedAt).IsRequired();

        // Backs ListIssuesEndpoint's "newest first" ordering and the
        // responsiveness signal's own "issues opened in the last 90 days"
        // window query — both filter to one PackageId and want CreatedAt
        // order, the same shape ix_reviews_package_created already uses.
        builder.HasIndex(i => new { i.PackageId, i.CreatedAt })
            .HasDatabaseName("ix_package_issues_package_created")
            .IsDescending(false, true);

        builder.HasOne(i => i.Package)
            .WithMany(p => p.Issues)
            .HasForeignKey(i => i.PackageId)
            .OnDelete(DeleteBehavior.Cascade);

        // SetNull, matching Review.UserId's own FK exactly — a filed
        // issue outlives the reporting account.
        builder.HasOne(i => i.Reporter)
            .WithMany()
            .HasForeignKey(i => i.ReporterUserId)
            .OnDelete(DeleteBehavior.SetNull);
    }
}

public sealed class PackageIssueReplyConfiguration : IEntityTypeConfiguration<PackageIssueReply>
{
    public void Configure(EntityTypeBuilder<PackageIssueReply> builder)
    {
        builder.ToTable("package_issue_replies");
        builder.HasKey(r => r.Id);

        builder.Property(r => r.Body).IsRequired();
        builder.Property(r => r.CreatedAt).IsRequired();

        // Backs "the earliest reply on this issue" — ListPackagesEndpoint's
        // own responsiveness query orders by CreatedAt per IssueId to find
        // it, the same per-parent-plus-timestamp shape every other
        // "first/latest child row" query in this codebase already uses.
        builder.HasIndex(r => new { r.IssueId, r.CreatedAt })
            .HasDatabaseName("ix_package_issue_replies_issue_created");

        builder.HasOne(r => r.Issue)
            .WithMany(i => i.Replies)
            .HasForeignKey(r => r.IssueId)
            .OnDelete(DeleteBehavior.Cascade);

        // SetNull, matching Review.UserId's own FK exactly — a reply
        // outlives the author's account.
        builder.HasOne(r => r.Author)
            .WithMany()
            .HasForeignKey(r => r.AuthorUserId)
            .OnDelete(DeleteBehavior.SetNull);
    }
}
