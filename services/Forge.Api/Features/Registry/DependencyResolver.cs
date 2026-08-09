using Forge.Domain.Versioning;
using Forge.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;

namespace Forge.Api.Features.Registry;

/// <summary>
/// docs/SPEC.md Section 13.4: resolves a project's declared dependency
/// ranges into a concrete, integrity-checked lockfile — a breadth-first
/// walk of the transitive dependency graph, following the sample
/// implementation in the spec directly (visited-set cycle guard, "first
/// resolution wins with a warning on conflict" diamond-dependency policy,
/// candidate versions restricted to <see cref="PackageScanStatus.Passed"/>
/// so nothing still in Section 10.4's publish pipeline is resolvable).
/// </summary>
public interface IDependencyResolver
{
    Task<ResolveResponse> ResolveAsync(ResolveRequest req, CancellationToken ct);
}

public sealed class DependencyResolver(ForgeDbContext db, IMemoryCache cache) : IDependencyResolver
{
    public async Task<ResolveResponse> ResolveAsync(ResolveRequest req, CancellationToken ct)
    {
        var resolved = new Dictionary<string, ResolvedPackage>();
        var warnings = new List<ResolutionWarning>();
        var queue = new Queue<(string Name, string Range, string RequestedBy)>();
        foreach (var (name, range) in req.Dependencies)
        {
            queue.Enqueue((name, range, "<root>"));
        }

        var visited = new HashSet<string>();
        while (queue.Count > 0)
        {
            var (name, range, requestedBy) = queue.Dequeue();

            var visitKey = $"{name}@{range}<-{requestedBy}";
            if (!visited.Add(visitKey)) continue;

            if (!SemVerRange.TryParse(range, out var parsedRange) || parsedRange is null)
            {
                throw new InvalidRangeException(name, range);
            }

            var candidates = await GetCandidateVersionsAsync(name, ct);
            if (candidates.Count == 0)
            {
                throw new PackageNotFoundException(name);
            }

            PackageVersionDto? pick = null;
            if (req.Pinned?.TryGetValue(name, out var pinnedVersion) == true)
            {
                pick = candidates.FirstOrDefault(c => c.Version == pinnedVersion);
                if (pick is null)
                {
                    warnings.Add(new ResolutionWarning(name, "pin-unavailable", $"Pinned version {pinnedVersion} is not available."));
                }
            }

            pick ??= MaxSatisfying(candidates.Where(c => c.YankedAt is null), parsedRange);

            if (pick is null)
            {
                var yankedMatch = MaxSatisfying(candidates, parsedRange);
                if (yankedMatch is not null)
                {
                    warnings.Add(new ResolutionWarning(name, "yanked", $"Only yanked versions satisfy '{range}'. Using {yankedMatch.Version}."));
                    pick = yankedMatch;
                }
                else
                {
                    throw new NoSatisfyingVersionException(name, range);
                }
            }

            if (!SemVerRange.TryParse(pick.EngineRange, out var engineRange) || engineRange is null || !SemVer.TryParse(req.EngineVersion, out var engineVersion) || engineVersion is null || !engineRange.IsSatisfiedBy(engineVersion))
            {
                warnings.Add(new ResolutionWarning(name, "engine-mismatch",
                    $"{name}@{pick.Version} targets engine {pick.EngineRange}, project is on {req.EngineVersion}."));
            }

            // Diamond dependency: the first resolution for a name wins.
            // Forge does not support multiple versions of the same
            // package in one project (ECS component names are global
            // strings — two versions of the same package would both
            // define the same component name and collide), so a later
            // conflicting request is flagged, not silently ignored and
            // not hard-failed either — the caller decides what to do
            // with an "unstable" warning.
            if (resolved.TryGetValue(name, out var already))
            {
                if (SemVer.TryParse(already.Version, out var alreadyVersion) && alreadyVersion is not null && !parsedRange.IsSatisfiedBy(alreadyVersion))
                {
                    warnings.Add(new ResolutionWarning(name, "version-conflict",
                        $"{requestedBy} needs '{range}' but {already.Version} is already resolved. Resolution may be unstable."));
                }
                continue;
            }

            resolved[name] = new ResolvedPackage(
                pick.Version,
                pick.BundleUrl,
                $"sha256-{Convert.ToBase64String(pick.BundleSha256)}",
                pick.Dependencies);

            foreach (var (depName, depRange) in pick.Dependencies)
            {
                queue.Enqueue((depName, depRange, $"{name}@{pick.Version}"));
            }
        }

        return new ResolveResponse(1, req.EngineVersion, resolved, warnings);
    }

    private static PackageVersionDto? MaxSatisfying(IEnumerable<PackageVersionDto> candidates, SemVerRange range)
    {
        PackageVersionDto? best = null;
        SemVer? bestVersion = null;
        foreach (var candidate in candidates)
        {
            if (!SemVer.TryParse(candidate.Version, out var version) || version is null) continue;
            if (!range.IsSatisfiedBy(version)) continue;
            if (bestVersion is null || version > bestVersion)
            {
                best = candidate;
                bestVersion = version;
            }
        }
        return best;
    }

    private async Task<List<PackageVersionDto>> GetCandidateVersionsAsync(string name, CancellationToken ct)
    {
        return (await cache.GetOrCreateAsync($"pkgver:{name}", async entry =>
        {
            entry.AbsoluteExpirationRelativeToNow = TimeSpan.FromMinutes(5);

            // Dictionary construction isn't translatable to SQL, so the
            // dependency rows are projected as a plain list here and
            // converted to a Dictionary afterward, in memory, once —
            // doing the ToDictionary() inside this .Select() throws at
            // query-translation time for every single request regardless
            // of scenario, confirmed by a real CI run where it took down
            // every resolver test uniformly, not just ones with
            // dependencies to convert.
            var rows = await db.PackageVersions
                .Where(v => v.Package!.Name == name && v.ScanStatus == Domain.Entities.PackageScanStatus.Passed)
                .Select(v => new
                {
                    v.Version,
                    v.EngineRange,
                    v.BundleUrl,
                    v.BundleSha256,
                    v.YankedAt,
                    Dependencies = v.Dependencies.Select(d => new { d.DependsOnName, d.VersionRange }).ToList(),
                })
                .ToListAsync(ct);

            return rows
                .Select(r => new PackageVersionDto(
                    r.Version,
                    r.EngineRange,
                    r.BundleUrl,
                    r.BundleSha256,
                    r.YankedAt,
                    r.Dependencies.ToDictionary(d => d.DependsOnName, d => d.VersionRange)))
                .ToList();
        }))!;
    }
}
