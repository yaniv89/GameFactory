namespace Forge.Infrastructure.Storage;

/// <summary>
/// Where a published package version's bundle actually lives
/// (docs/SPEC.md Section 6.2's <c>package_versions.bundle_url</c>,
/// Section 10.4 step 6 "immutable publish"). The interface exists
/// separately from the Azure-specific implementation so publish-pipeline
/// tests can swap in a fake the same way <c>IStripeBillingClient</c>/
/// <c>FakeStripeBillingClient</c> already do — not because a second real
/// backend is ever planned (CLAUDE.md Section 2.1 pins Azure Blob
/// Storage, no abstraction-for-its-own-sake here).
/// </summary>
public interface IPackageBundleStorage
{
    /// <summary>
    /// Uploads a bundle to a content-addressed path
    /// (<c>packages/{name}/{version}/bundle.js</c>) and returns its
    /// public URL. Fails if that exact path already has content — the
    /// same immutability guarantee docs/SPEC.md Section 6.2's own comment
    /// states for <c>package_versions</c> rows, enforced at the storage
    /// layer too, not only by the database's unique index, since two
    /// concurrent publish attempts for the same never-before-seen
    /// (name, version) pair could otherwise both reach the storage write
    /// before either's database insert lands.
    /// </summary>
    Task<string> UploadAsync(string packageName, string version, byte[] content, string contentType, CancellationToken ct);

    /// <summary>
    /// Downloads a previously published bundle's raw content — gate 4's
    /// own read side (docs/SPEC.md Section 10.4, services/Forge.Functions.Scan's
    /// PendingVersionScanner), which needs the actual source text to run,
    /// not the <c>bundle_url</c> string <c>package_versions</c> stores.
    /// Takes <paramref name="packageName"/>/<paramref name="version"/>,
    /// the same identity <see cref="UploadAsync"/> was called with —
    /// re-derives the same content-addressed path rather than trusting a
    /// caller-supplied URL, consistent with CLAUDE.md Section 1.1
    /// guardrail 4's "never trust a client-supplied identifier" spirit
    /// even though the caller here is an internal service, not a client.
    /// </summary>
    Task<byte[]> DownloadAsync(string packageName, string version, CancellationToken ct);
}

/// <summary>Thrown by <see cref="IPackageBundleStorage.UploadAsync"/> when the target path already has content.</summary>
public sealed class BundleAlreadyExistsException(string packageName, string version)
    : Exception($"A bundle for '{packageName}'@'{version}' already exists.");

/// <summary>Thrown by <see cref="IPackageBundleStorage.DownloadAsync"/> when the target path has no content.</summary>
public sealed class BundleNotFoundException(string packageName, string version)
    : Exception($"No bundle found for '{packageName}'@'{version}'.");
