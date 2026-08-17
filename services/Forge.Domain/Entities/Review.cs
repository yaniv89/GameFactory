namespace Forge.Domain.Entities;

/// <summary>
/// docs/SPEC.md Section 16.2's ratings/reviews subsystem —
/// <see cref="Marketplace.ListingQualitySignals.BayesianRating"/>'s own
/// doc comment named this as one of three signals with "no data source
/// anywhere in this platform." One review per (<see cref="PackageId"/>,
/// <see cref="UserId"/>): a person updates their own rating in place
/// (<see cref="UpdatedAt"/>) rather than posting a new row every time
/// they change their mind — the same "edit in place, not append a new
/// row" shape <see cref="Purchase"/>'s own <c>Status</c> transitions
/// already use, for the same reason (there is exactly one current truth
/// per (package, reviewer), not a log of every opinion someone ever had).
/// </summary>
public sealed class Review
{
    public Guid Id { get; set; }

    public Guid PackageId { get; set; }

    /// <summary>Null if the reviewing user's account was later deleted — same nullability reasoning as <see cref="ProjectRevision.AuthorId"/>/<see cref="Build.RequestedByUserId"/>: the review itself (and its rating's contribution to <see cref="Marketplace.ListingQualitySignals.BayesianRating"/>) outlives the account.</summary>
    public Guid? UserId { get; set; }

    /// <summary>1-5. Enforced at the database (`ck_reviews_rating`) and in the endpoint's own validation — never trusted from client input alone.</summary>
    public int Rating { get; set; }

    /// <summary>
    /// Optional free text. Never rendered as HTML by anything in this
    /// repo (CLAUDE.md Section 1.1 guardrail 3) — there is no reviews UI
    /// yet (F1 is the backend half only), and whenever one exists it goes
    /// through the same plain-text/`@forge/richtext` discipline
    /// (docs/adr/0011) every other user-authored string in this codebase
    /// already does, not a new exception.
    /// </summary>
    public string? Body { get; set; }

    public DateTimeOffset CreatedAt { get; set; }

    public DateTimeOffset? UpdatedAt { get; set; }

    public Package? Package { get; set; }

    public User? User { get; set; }
}
