namespace Forge.Domain.Entities;

/// <summary>
/// docs/adr/0016 Decision 6. The expansion call
/// (<see cref="ArtGenerationEndpointsExtensions"/>, synchronous) resolves
/// a newly-created row straight to <see cref="AwaitingConfirmation"/>,
/// <see cref="Declined"/> (Gemini's own safety filtering refused the
/// expansion), or <see cref="Failed"/> (a transient/harness failure —
/// distinct from <see cref="Declined"/> the same way
/// <c>SmokeGateHarnessException</c> is distinct from a real blocked
/// verdict elsewhere in this codebase: a Declined row reflects a real
/// content decision, a Failed one reflects the call itself not
/// completing). Confirming moves an <see cref="AwaitingConfirmation"/> row
/// to <see cref="Queued"/> — <c>Forge.Functions.ArtGen</c> (N3) claims
/// <see cref="Queued"/> rows and sets <see cref="Generating"/> while it
/// works, the identical Queued-&gt;-in-progress-&gt;terminal shape
/// <see cref="Build"/>/<see cref="Asset"/> already use for their own
/// worker claim query.
/// </summary>
public static class GenerationStatus
{
    public const string AwaitingConfirmation = "awaiting_confirmation";
    public const string Queued = "queued";
    public const string Generating = "generating";
    public const string Ready = "ready";
    public const string Failed = "failed";
    public const string Declined = "declined";
}

/// <summary>
/// docs/adr/0016 Decision 1: exactly these two in v1. Character sheets
/// and VFX/facing strips need a coherent multi-frame result from what
/// today is a single generation call — named, deferred follow-on work,
/// not silently attempted and hoped to work.
/// </summary>
public static class ArtGenCategory
{
    public const string Tile = "tile";
    public const string Prop = "prop";
}

/// <summary>
/// One creator's "describe it" art-generation request (docs/adr/0016) —
/// a workspace- and project-scoped record of a free-text prompt, its
/// server-expanded form, and (once confirmed) the async generation job
/// <c>Forge.Functions.ArtGen</c> claims and processes.
/// </summary>
public sealed class GenerationRequest
{
    public Guid Id { get; set; }

    public Guid WorkspaceId { get; set; }

    public Guid ProjectId { get; set; }

    /// <summary>The creator's own words, retained verbatim for audit — never itself sent to either Gemini call as anything but user content (docs/adr/0016 Decision 5's system-instruction/user-content separation).</summary>
    public required string UserPrompt { get; set; }

    /// <summary>One of <see cref="ArtGenCategory"/>'s constants — fixes which generation-convention system instruction the expansion call uses and which post-processing step (N4) the confirmed job runs.</summary>
    public required string Category { get; set; }

    /// <summary>One of <see cref="GenerationStatus"/>'s constants.</summary>
    public required string Status { get; set; }

    /// <summary>Set once the synchronous expansion call returns successfully — what the creator sees and confirms before any image-generation cost is spent (docs/adr/0016 Decision 2).</summary>
    public string? ExpandedPrompt { get; set; }

    /// <summary>Set on <see cref="GenerationStatus.Failed"/> or <see cref="GenerationStatus.Declined"/> — a creator-facing reason, never a raw exception or the provider's own internal error text (CLAUDE.md Section 1.1 guardrail 5 / Section 5.5).</summary>
    public string? ErrorMessage { get; set; }

    /// <summary>Null if the requesting user's account was later deleted — same nullability reasoning as <see cref="Build.RequestedByUserId"/>/<see cref="Asset.RequestedByUserId"/>.</summary>
    public Guid? RequestedByUserId { get; set; }

    public DateTimeOffset CreatedAt { get; set; }

    public DateTimeOffset? CompletedAt { get; set; }

    public Workspace? Workspace { get; set; }

    public Project? Project { get; set; }

    public User? RequestedBy { get; set; }

    public List<GenerationVariation> Variations { get; set; } = [];
}

/// <summary>
/// One generated-and-processed image variation belonging to a
/// <see cref="GenerationRequest"/> (docs/adr/0016 Decision 6) — written
/// only by <c>Forge.Functions.ArtGen</c> once N4's post-processing step
/// (chroma-key + crop-to-content for a <see cref="ArtGenCategory.Prop"/>,
/// resize/tile-fit for an <see cref="ArtGenCategory.Tile"/>) has already
/// run on the underlying image's decode-verified pixels (docs/adr/0012's
/// existing untrusted-decode pipeline, reused unmodified per docs/adr/0016
/// Decision 3) — <see cref="ProcessedBlobPath"/> is never a pass-through
/// of whatever bytes Gemini returned.
/// </summary>
public sealed class GenerationVariation
{
    public Guid Id { get; set; }

    public Guid GenerationRequestId { get; set; }

    /// <summary>Public, pack-ready PNG — the actual asset a confirmed selection becomes.</summary>
    public required string ProcessedBlobPath { get; set; }

    public int Width { get; set; }

    public int Height { get; set; }

    /// <summary>The creator's pick, if any. At most one variation per <see cref="GenerationRequest"/> is ever Selected — enforced at the endpoint that records a selection (N4/N5), not by a database constraint, since "at most one" over a nullable/boolean column needs a partial unique index keyed on a fixed sentinel value, not something worth adding until a real caller writes to this column.</summary>
    public bool Selected { get; set; }

    public DateTimeOffset CreatedAt { get; set; }

    public GenerationRequest? GenerationRequest { get; set; }
}
