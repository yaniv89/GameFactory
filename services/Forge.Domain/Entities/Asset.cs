namespace Forge.Domain.Entities;

/// <summary>
/// docs/adr/0012 Decision 2/4. Pending -&gt; Processing -&gt; Ready | Failed,
/// set by <c>Forge.Functions.Assets</c> (E3) after the only decode this
/// pipeline ever does. <see cref="Processing"/> is the same "claim mutual
/// exclusion across ticks, not just within one SQL statement" mechanism
/// <see cref="BuildStatus.Building"/> already is for <see cref="Build"/>:
/// without it, a second worker's next timer tick would see this row still
/// sitting at <see cref="Pending"/> and reprocess it while the first
/// worker's claim is still in flight. A Failed asset can only be replaced
/// by a fresh upload (a new row), never resurrected in place — same "the
/// log only ever grows" shape as <see cref="Build"/>/<see cref="BuildStatus"/>.
/// </summary>
public static class AssetStatus
{
    public const string Pending = "pending";
    public const string Processing = "processing";
    public const string Ready = "ready";
    public const string Failed = "failed";
}

/// <summary>
/// One uploaded, workspace-scoped image asset (docs/adr/0012) — the "3.
/// Project-uploaded asset" tier of SPEC 11.4's Art Pack asset resolution
/// order, once E4 wires it in.
///
/// Deliberately trimmed from docs/SPEC.md Section 6.2's <c>assets</c>:
/// no <c>kind</c> column (v1 accepts exactly one kind, image — see
/// docs/adr/0012 Decision 1; re-added the day a second kind ships, not
/// before) and no <c>derived_from</c> (nothing here is derived from
/// another <see cref="Asset"/> row — <see cref="ProcessedBlobPath"/> is
/// this same row's own re-encoded output, not a separate asset).
/// </summary>
public sealed class Asset
{
    public Guid Id { get; set; }

    public Guid WorkspaceId { get; set; }

    /// <summary>Null = shared across the workspace's projects (SPEC 6.2's own <c>assets.project_id</c> nullability, unchanged).</summary>
    public Guid? ProjectId { get; set; }

    public required string OriginalName { get; set; }

    /// <summary>Client-declared at upload, checked against docs/adr/0012 Decision 1's allowlist (image/png, image/jpeg, image/webp) — but never trusted as ground truth for what the bytes actually are, and never what gets served back (Decision 7: the decoded, actually-produced Content-Type is). Retained purely as a record of what was claimed.</summary>
    public required string DeclaredMimeType { get; set; }

    /// <summary>One of <see cref="AssetStatus"/>'s constants.</summary>
    public required string Status { get; set; }

    /// <summary>The original, undecoded bytes' path in the private <c>assets-quarantine</c> container (docs/adr/0012 Decision 6) — <c>Forge.Api</c> writes it at upload and never reads it back as an image; <c>Forge.Functions.Assets</c> is the only reader.</summary>
    public required string QuarantineBlobPath { get; set; }

    /// <summary>Set once <see cref="Status"/> reaches <see cref="AssetStatus.Ready"/> — the path in the public <c>assets</c> container to the bytes <c>Forge.Functions.Assets</c> itself re-encoded from decoded pixel data (docs/adr/0012 Decision 4/6). Never the uploaded bytes, never a copy or pass-through of them.</summary>
    public string? ProcessedBlobPath { get; set; }

    /// <summary>SHA-256 of the original, undecoded bytes — an opaque dedupe key over uploaded content, never a claim about what those bytes decode to. Backs the <c>(workspace_id, sha256)</c> unique index (SPEC 6.2, carried forward unchanged).</summary>
    public required byte[] Sha256 { get; set; }

    /// <summary>The uploaded size, in bytes — what counts against <see cref="Workspace.StorageQuotaMb"/> (docs/adr/0012 Decision 5), deliberately not whatever size the re-encoded variant ends up being.</summary>
    public long SizeBytes { get; set; }

    /// <summary>Set only on <see cref="AssetStatus.Ready"/>, from the real image <c>Forge.Functions.Assets</c> decoded — never the client-declared or guessed dimensions.</summary>
    public int? Width { get; set; }

    public int? Height { get; set; }

    /// <summary>Set only on <see cref="AssetStatus.Failed"/> — a creator-facing reason ("this file isn't a valid PNG/JPEG/WebP image," "image dimensions exceed the 4096x4096 limit"), never a raw exception message (CLAUDE.md Section 1.1 guardrail 5 / Section 5.5's copy rules).</summary>
    public string? ErrorMessage { get; set; }

    /// <summary>Null if the requesting user's account was later deleted — same nullability reasoning as <see cref="ProjectRevision.AuthorId"/>/<see cref="Build.RequestedByUserId"/>.</summary>
    public Guid? RequestedByUserId { get; set; }

    public DateTimeOffset CreatedAt { get; set; }

    public DateTimeOffset? CompletedAt { get; set; }

    public DateTimeOffset? DeletedAt { get; set; }

    public Workspace? Workspace { get; set; }

    public Project? Project { get; set; }

    public User? RequestedBy { get; set; }
}
