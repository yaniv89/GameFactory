using Forge.Domain.Entities;
using Forge.Domain.Versioning;
using Forge.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Forge.Api.Features.Registry.Publishing;

public sealed record DependencyAuditResult(bool Passed, IReadOnlyList<string> Errors);

/// <summary>
/// docs/SPEC.md Section 10.4 gate 3: "transitive deps resolve, no yanked
/// versions, no cycles, integrity hashes match." Deliberately not a reuse
/// of <see cref="IDependencyResolver"/> — that class resolves a
/// <em>project's</em> dependencies for a lockfile (pins win, a yanked
/// version is an acceptable fallback with a warning, an unsatisfiable
/// range throws). This gate is stricter and asks a different question —
/// "is it even safe to publish this version at all" — where a yanked-only
/// match or a self-referential dependency chain is a hard failure, not a
/// warning a caller can shrug off.
///
/// Integrity ("hashes match") isn't checked here — it's enforced by
/// computing the bundle's SHA256 server-side in <see cref="PublishVersionEndpoint"/>
/// rather than trusting a client-supplied hash, so there is never a
/// claimed hash to verify against an actual one in the first place.
/// </summary>
public sealed class PackageDependencyAuditor(ForgeDbContext db)
{
    public async Task<DependencyAuditResult> AuditAsync(
        string publishingPackageName, IReadOnlyDictionary<string, string> declaredDependencies, CancellationToken ct)
    {
        var errors = new List<string>();

        foreach (var (name, range) in declaredDependencies)
        {
            if (!SemVerRange.TryParse(range, out var parsedRange) || parsedRange is null)
            {
                errors.Add($"'{range}' declared for '{name}' is not a valid version range.");
                continue;
            }

            var candidateVersions = await db.PackageVersions
                .Where(v => v.Package!.Name == name && v.ScanStatus == PackageScanStatus.Passed && v.YankedAt == null)
                .Select(v => v.Version)
                .ToListAsync(ct);

            var satisfied = candidateVersions.Any(c => SemVer.TryParse(c, out var v) && v is not null && parsedRange.IsSatisfiedBy(v));
            if (!satisfied)
            {
                errors.Add($"No published, non-yanked, passed version of '{name}' satisfies '{range}'.");
            }
        }

        errors.AddRange(await FindCyclesAsync(publishingPackageName, declaredDependencies.Keys, ct));

        return new DependencyAuditResult(errors.Count == 0, errors);
    }

    /// <summary>
    /// Breadth-first walk of the existing registry's dependency graph,
    /// starting from what the package being published would depend on —
    /// if that walk ever reaches the publishing package's own name, some
    /// combination of already-published versions would let it depend on
    /// itself transitively. Checked against every passed, non-yanked
    /// version of each visited package rather than one specific resolved
    /// version (which isn't known yet — that's what installing a project
    /// actually resolves, not what publishing audits) — a deliberately
    /// conservative approximation: it can flag a cycle that a specific
    /// version pin would never actually realize, never the reverse.
    /// </summary>
    private async Task<List<string>> FindCyclesAsync(string publishingPackageName, IEnumerable<string> directDependencyNames, CancellationToken ct)
    {
        var errors = new List<string>();
        var visited = new HashSet<string>();
        var queue = new Queue<string>(directDependencyNames);

        while (queue.Count > 0)
        {
            var current = queue.Dequeue();
            if (current == publishingPackageName)
            {
                errors.Add($"Cyclic dependency: '{publishingPackageName}' would transitively depend on itself.");
                continue;
            }
            if (!visited.Add(current)) continue;

            var transitiveNames = await db.PackageDependencies
                .Where(d => d.Version!.Package!.Name == current && d.Version.ScanStatus == PackageScanStatus.Passed && d.Version.YankedAt == null)
                .Select(d => d.DependsOnName)
                .Distinct()
                .ToListAsync(ct);

            foreach (var name in transitiveNames)
            {
                queue.Enqueue(name);
            }
        }

        return errors;
    }
}
