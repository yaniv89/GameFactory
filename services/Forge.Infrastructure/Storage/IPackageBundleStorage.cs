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
}

/// <summary>Thrown by <see cref="IPackageBundleStorage.UploadAsync"/> when the target path already has content.</summary>
public sealed class BundleAlreadyExistsException(string packageName, string version)
    : Exception($"A bundle for '{packageName}'@'{version}' already exists.");
