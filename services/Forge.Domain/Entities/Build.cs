namespace Forge.Domain.Entities;

/// <summary>docs/adr/0010 Decision 2. Queued -&gt; Building -&gt; Ready | Failed. A Failed build can be requeued only by a fresh POST (a new row), never resurrected in place — same "the log only ever grows" shape as <see cref="ProjectRevision"/>.</summary>
public static class BuildStatus
{
    public const string Queued = "queued";
    public const string Building = "building";
    public const string Ready = "ready";
    public const string Failed = "failed";
}

/// <summary>
/// One server-side build of a project's committed revision into a
/// playable, self-contained game (docs/adr/0010) — the "published to a
/// URL" half of M6's exit criterion, alongside the already-shipped
/// <c>forge export</c> "exported to file://" half (docs/adr/0009).
///
/// Deliberately trimmed from docs/SPEC.md Section 6.2's
/// <c>published_builds</c>: no <c>channel</c> (every build publishes to
/// `live`, multi-channel publishing is unimplemented future work) and no
/// <c>lockfile</c> (nothing to lock — <see cref="RevisionId"/>'s own
/// <c>ProjectRevision.Doc</c> already pins exact, resolved module
/// versions, docs/adr/0009 Decision 3).
/// </summary>
public sealed class Build
{
    public Guid Id { get; set; }

    public Guid ProjectId { get; set; }

    /// <summary>The committed <see cref="ProjectRevision"/> this build was produced from — the actual build input. Never the live, uncommitted editor document.</summary>
    public long RevisionId { get; set; }

    /// <summary>One of <see cref="BuildStatus"/>'s constants.</summary>
    public required string Status { get; set; }

    /// <summary>Set once <see cref="Status"/> reaches <see cref="BuildStatus.Ready"/>. The Blob Storage path <c>Forge.Play</c> (docs/adr/0010 Decision 5) reads <c>index.html</c> from.</summary>
    public string? BundleBlobPath { get; set; }

    public byte[]? BundleSha256 { get; set; }

    public long? SizeBytes { get; set; }

    /// <summary>Base64 sha256 of the built <c>index.html</c>'s inline <c>&lt;script type="module"&gt;</c> block — the play-origin CSP's <c>script-src 'sha256-...'</c> hash source (docs/adr/0010 Decision 4/6). Set only on <see cref="BuildStatus.Ready"/>.</summary>
    public string? InlineScriptSha256Base64 { get; set; }

    /// <summary>Base64 sha256 of the built <c>index.html</c>'s inline <c>&lt;style&gt;</c> block — the play-origin CSP's <c>style-src 'sha256-...'</c> hash source (docs/adr/0010 Decision 4/6, resolved the same way as the script hash, no `unsafe-inline` exception). Set only on <see cref="BuildStatus.Ready"/>.</summary>
    public string? InlineStyleSha256Base64 { get; set; }

    /// <summary>Set only on <see cref="BuildStatus.Failed"/> — the real error (a license-check failure, a subprocess crash) surfaced verbatim by the worker, never a raw stack trace (CLAUDE.md Section 1.1 guardrail 5's spirit).</summary>
    public string? ErrorMessage { get; set; }

    /// <summary>Null if the requesting user's account was later deleted — same nullability reasoning as <see cref="ProjectRevision.AuthorId"/>.</summary>
    public Guid? RequestedByUserId { get; set; }

    public DateTimeOffset CreatedAt { get; set; }

    public DateTimeOffset? CompletedAt { get; set; }

    public Project? Project { get; set; }

    public ProjectRevision? Revision { get; set; }

    public User? RequestedBy { get; set; }
}
