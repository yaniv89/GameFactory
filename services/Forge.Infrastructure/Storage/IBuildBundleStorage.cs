namespace Forge.Infrastructure.Storage;

/// <summary>
/// docs/adr/0010 Decision 4/5's <c>builds/{buildId}/</c> Blob Storage
/// layout: <c>Forge.Functions.Build</c> (this interface's only writer)
/// uploads a build's <c>index.html</c> plus a small <c>meta.json</c>
/// sidecar carrying the two per-build CSP hash sources; <c>Forge.Play</c>
/// (C4, not yet built) is the only reader, and needs no database
/// round trip to serve a request — both blobs together are everything it
/// needs. Separate from <see cref="IPackageBundleStorage"/> deliberately:
/// different container, different content shape, different lifecycle
/// (a package bundle is a marketplace artifact multiple projects can
/// depend on; a build bundle belongs to exactly one project's one
/// revision and is never shared).
/// </summary>
public interface IBuildBundleStorage
{
    /// <summary>
    /// Uploads a build's output to a content-addressed path
    /// (<c>builds/{buildId}/index.html</c>, <c>builds/{buildId}/meta.json</c>).
    /// Unlike <see cref="IPackageBundleStorage.UploadAsync"/> this is not
    /// create-only: a build id is a freshly generated <see cref="Guid"/>
    /// per <c>CreateBuildEndpoint</c> call (docs/adr/0010 Decision 3), so
    /// two uploads for the same id would only ever originate from the
    /// same worker retrying its own claimed row after a transient
    /// failure, not a genuine collision the way two packages publishing
    /// the same (name, version) could be.
    /// </summary>
    Task UploadAsync(Guid buildId, byte[] indexHtml, BuildBundleMetadata metadata, CancellationToken ct);

    /// <summary>Reads back <c>index.html</c>'s raw bytes — <c>Forge.Play</c>'s own read path (C4), and this interface's own round-trip proof in tests.</summary>
    Task<byte[]> DownloadIndexHtmlAsync(Guid buildId, CancellationToken ct);

    /// <summary>Reads back the <c>meta.json</c> sidecar — the play-origin CSP's two hash sources, without needing <c>index.html</c>'s full bytes just to build a response header.</summary>
    Task<BuildBundleMetadata> DownloadMetadataAsync(Guid buildId, CancellationToken ct);
}

/// <summary>
/// The play-origin CSP's per-build hash sources (docs/adr/0010 Decision
/// 4/6) — <c>script-src</c>/<c>style-src</c>'s <c>'sha256-...'</c> tokens,
/// computed once by <c>Forge.Functions.Build</c> from the built
/// <c>index.html</c>'s own inline <c>&lt;script&gt;</c>/<c>&lt;style&gt;</c>
/// blocks, stored so <c>Forge.Play</c> never needs to re-derive them (or
/// hold a database connection) to serve a request.
/// </summary>
public sealed record BuildBundleMetadata(string InlineScriptSha256Base64, string InlineStyleSha256Base64);

/// <summary>Thrown by <see cref="IBuildBundleStorage.DownloadIndexHtmlAsync"/>/<see cref="IBuildBundleStorage.DownloadMetadataAsync"/> when the target build has no uploaded content — a build id that was never marked <c>Ready</c>, or genuinely doesn't exist.</summary>
public sealed class BuildBundleNotFoundException(Guid buildId)
    : Exception($"No build bundle found for build '{buildId}'.");
