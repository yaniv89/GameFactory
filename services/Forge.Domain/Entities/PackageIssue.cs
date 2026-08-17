namespace Forge.Domain.Entities;

/// <summary>
/// docs/SPEC.md Section 16.2's ratings/reviews subsystem — the third and
/// last signal <see cref="Marketplace.ListingQualitySignals.SupportResponsivenessHours"/>'s
/// own doc comment named as having "no data source anywhere in this
/// platform" (F1's own comment on that record; F1 itself only closed the
/// other two). A genuinely minimal issue tracker, stated bounds and all:
/// no attachments, no status/close workflow, no notifications, no editing
/// a filed issue or a reply after the fact — exactly enough to produce a
/// real "how long until the author responds" measurement and nothing
/// more. <see cref="PackageIssueReply"/> is the only other row this
/// subsystem writes.
/// </summary>
public sealed class PackageIssue
{
    public Guid Id { get; set; }

    public Guid PackageId { get; set; }

    /// <summary>Null if the reporting user's account was later deleted — same nullability reasoning as <see cref="Review.UserId"/>: the issue outlives the account.</summary>
    public Guid? ReporterUserId { get; set; }

    public required string Title { get; set; }

    /// <summary>Optional free text. Never rendered as HTML by anything in this repo (CLAUDE.md Section 1.1 guardrail 3) — no UI reads this yet (backend-only, matching F1's own scope split); whenever one exists it goes through the same `@forge/richtext` discipline (docs/adr/0011) every other user-authored string here already does.</summary>
    public string? Body { get; set; }

    public DateTimeOffset CreatedAt { get; set; }

    public Package? Package { get; set; }

    public User? Reporter { get; set; }

    /// <summary>Newest-last by <see cref="PackageIssueReply.CreatedAt"/>; the earliest one (if any) is what the responsiveness signal measures — see <c>ListPackagesEndpoint</c>'s own query for exactly how.</summary>
    public ICollection<PackageIssueReply> Replies { get; set; } = new List<PackageIssueReply>();
}

/// <summary>
/// One reply to a <see cref="PackageIssue"/> — author-only (enforced in
/// <c>IssuesEndpoint.HandleReply</c>, resolved server-side from
/// <see cref="Package.AuthorUserId"/> against the token subject, never a
/// client-supplied claim, CLAUDE.md Section 1.1 guardrail 4), which is
/// what makes "the earliest reply on an issue" the same thing as "the
/// author's first response" without a separate role check at read time.
/// Every reply is a real, persisted row — not just the first one per
/// issue — so nothing here silently discards a second or third reply's
/// content even though only the first one feeds the ranking signal.
/// </summary>
public sealed class PackageIssueReply
{
    public Guid Id { get; set; }

    public Guid IssueId { get; set; }

    /// <summary>Null if the author's account was later deleted — same nullability reasoning as <see cref="Review.UserId"/>.</summary>
    public Guid? AuthorUserId { get; set; }

    public required string Body { get; set; }

    public DateTimeOffset CreatedAt { get; set; }

    public PackageIssue? Issue { get; set; }

    public User? Author { get; set; }
}
