namespace Forge.Domain.Entities;

/// <summary>
/// A billing and access-control boundary (docs/SPEC.md Section 6.2). Every
/// authorization decision in the API resolves down to "does the current
/// user's token subject have a <see cref="WorkspaceMember"/> row on this
/// workspace" — never a client-supplied workspace ID taken on trust
/// (CLAUDE.md Section 1.1 guardrail 4).
/// </summary>
public sealed class Workspace
{
    public Guid Id { get; set; }

    public required string Slug { get; set; }

    public required string Name { get; set; }

    /// <summary>free | pro | studio — see docs/SPEC.md Section 23.2 for what each gates.</summary>
    public string Plan { get; set; } = "free";

    public int SeatLimit { get; set; } = 1;

    public int StorageQuotaMb { get; set; } = 500;

    public DateTimeOffset CreatedAt { get; set; }

    public DateTimeOffset? DeletedAt { get; set; }

    public ICollection<WorkspaceMember> Members { get; set; } = new List<WorkspaceMember>();

    public ICollection<Project> Projects { get; set; } = new List<Project>();
}

/// <summary>
/// The closed set of <see cref="Workspace.Plan"/> values. Denormalized
/// onto <see cref="Workspace"/> for cheap reads (avoids a join everywhere
/// a plan check is needed), but never the value plan-gate authorization
/// checks are updated from directly — the <see cref="Subscription"/> row,
/// itself written only by verified Stripe webhook events (docs/SPEC.md
/// Section 23.5), is what keeps this field in sync.
/// </summary>
public static class WorkspacePlan
{
    public const string Free = "free";
    public const string Pro = "pro";
    public const string Studio = "studio";

    /// <summary>Plans that pass a plan-gate check (docs/SPEC.md Section 23.2's export/publish wall).</summary>
    public static readonly IReadOnlySet<string> GatesOpen = new HashSet<string>([Pro, Studio]);
}
