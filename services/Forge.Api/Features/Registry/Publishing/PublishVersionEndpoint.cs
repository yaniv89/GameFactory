using System.Security.Cryptography;
using System.Text.Json;
using Forge.Api.Authorization;
using Forge.Api.RateLimiting;
using Forge.Domain.Entities;
using Forge.Infrastructure.Persistence;
using Forge.Infrastructure.Storage;
using Microsoft.EntityFrameworkCore;

namespace Forge.Api.Features.Registry.Publishing;

/// <summary>
/// docs/SPEC.md Section 13.2: <c>POST /api/v1/packages/{name}/versions</c>.
/// Runs gates 1–3 of Section 10.4's pipeline (manifest validation, static
/// analysis, dependency audit) synchronously and, on success, writes an
/// immutable version row and bundle with
/// <see cref="PackageScanStatus.Pending"/>, not <see cref="PackageScanStatus.Passed"/>.
/// Gate 4 (the sandboxed smoke run, M6 Phase 3) runs asynchronously
/// afterward — <c>Forge.Functions.Scan</c>'s <c>ScanPendingVersionsFunction</c>
/// picks up <c>Pending</c> versions on a queue trigger and promotes them
/// to <c>Passed</c> or <c>Flagged</c> — so <see cref="Registry.IDependencyResolver"/>
/// correctly refuses to resolve a version this endpoint just wrote (it
/// only considers <c>Passed</c> candidates) until that pipeline finishes.
/// Gate 5 (Section 10.4's reputation gate — automated pass for
/// established authors, manual review queue for new ones) doesn't exist
/// yet: every version takes the same path through gate 4 regardless of
/// the publishing author's history, until M7 Phase 3 adds the
/// Unverified/Verified/Partner trust tiers that gate needs. A stated
/// gap, not a silent one.
///
/// Mapped onto the same catch-all path shape
/// <see cref="PackageDetailAndVersionsEndpoint"/> uses for reads (scoped
/// package names contain a literal slash — see that file's own doc
/// comment for why a catch-all is required at all). This one doesn't
/// need that file's dispatch-by-content logic, though: POST only ever
/// means "publish a version of {name}", so the path is required to end
/// in a literal "versions" segment and nothing else is accepted.
/// </summary>
public static class PublishVersionEndpoint
{
    // docs/SPEC.md Section 8.1's entire always-shipped engine floor is
    // ~235 KB; a single module or Art Pack bundle should never approach
    // that. 5 MB is a generous resource-abuse guard, not a claim about
    // what a "good" bundle size is — Section 16.2's marketplace ranking
    // signal is a separate, later concern about rewarding smaller ones,
    // not this endpoint's job.
    private const int MaxBundleBytes = 5 * 1024 * 1024;

    public static IEndpointRouteBuilder MapPublishVersion(this IEndpointRouteBuilder app)
    {
        app.MapPost("/api/v1/packages/{*path}", Handle)
            .RequireAuthorization(ForgeAuthorizationExtensions.BearerPolicy)
            .WithRateLimit("api", RateLimitKeyStrategy.User, RateLimitPolicies.Api)
            .WithName("PublishPackageVersion")
            .Produces<PublishVersionResponse>(StatusCodes.Status201Created)
            .ProducesValidationProblem()
            .ProducesProblem(StatusCodes.Status403Forbidden)
            .ProducesProblem(StatusCodes.Status409Conflict)
            .ProducesProblem(StatusCodes.Status422UnprocessableEntity)
            .ProducesProblem(StatusCodes.Status413PayloadTooLarge);
        return app;
    }

    private static async Task<IResult> Handle(
        string path,
        PublishVersionRequest req,
        ForgeDbContext db,
        ICurrentUser currentUser,
        IPackageBundleStorage bundleStorage,
        CancellationToken ct)
    {
        var segments = path.Split('/', StringSplitOptions.RemoveEmptyEntries);
        if (segments.Length is not (2 or 3) || segments[^1] != "versions")
        {
            return TypedResults.NotFound();
        }
        var name = string.Join('/', segments[..^1]);

        var author = await db.DomainUsers.SingleOrDefaultAsync(u => u.Id == currentUser.UserId, ct);
        if (author is null || author.EmailVerifiedAt is null)
        {
            return TypedResults.Problem(
                title: "Email verification required",
                detail: "Verify your email address before publishing a package (docs/SPEC.md Section 16.3).",
                statusCode: StatusCodes.Status403Forbidden);
        }

        if (!PackageKind.All.Contains(req.Kind))
        {
            return TypedResults.ValidationProblem(new Dictionary<string, string[]>
            {
                ["kind"] = [$"Must be one of: {string.Join(", ", PackageKind.All)}."],
            });
        }

        var manifestErrors = ManifestValidator.Validate(req.Manifest, name, req.Version, req.Kind);
        if (manifestErrors.Count > 0)
        {
            return TypedResults.ValidationProblem(manifestErrors);
        }

        byte[] bundleBytes;
        try
        {
            bundleBytes = Convert.FromBase64String(req.BundleBase64);
        }
        catch (FormatException)
        {
            return TypedResults.ValidationProblem(new Dictionary<string, string[]> { ["bundleBase64"] = ["Not valid base64."] });
        }
        if (bundleBytes.Length == 0)
        {
            return TypedResults.ValidationProblem(new Dictionary<string, string[]> { ["bundleBase64"] = ["Bundle must not be empty."] });
        }
        if (bundleBytes.Length > MaxBundleBytes)
        {
            return TypedResults.Problem(
                title: "Bundle too large",
                detail: $"Bundle is {bundleBytes.Length} bytes. Limit is {MaxBundleBytes}.",
                statusCode: StatusCodes.Status413PayloadTooLarge);
        }

        var existingPackage = await db.Packages.SingleOrDefaultAsync(p => p.Name == name, ct);
        if (existingPackage is not null && existingPackage.AuthorUserId != currentUser.UserId)
        {
            // 403, not 404: package existence and authorship are already
            // public via GET /api/v1/packages/{name} (CLAUDE.md Section
            // 1.1 guardrail 4's cross-tenant-404 concern is about hiding
            // whether a *private* resource exists — this one never was).
            return TypedResults.Problem(
                title: "Not the package author",
                detail: $"'{name}' already exists and is owned by a different account.",
                statusCode: StatusCodes.Status403Forbidden);
        }
        if (existingPackage is not null)
        {
            var versionExists = await db.PackageVersions.AnyAsync(v => v.PackageId == existingPackage.Id && v.Version == req.Version, ct);
            if (versionExists)
            {
                return TypedResults.Problem(
                    title: "Version already published",
                    detail: $"'{name}'@'{req.Version}' already exists. Published versions are immutable (docs/SPEC.md Section 6.2).",
                    statusCode: StatusCodes.Status409Conflict);
            }
        }

        var bundleText = System.Text.Encoding.UTF8.GetString(bundleBytes);
        var allowedNetworkDomains = ExtractNetworkAllowlist(req.Manifest);
        var staticAnalysis = StaticAnalyzer.Analyze(bundleText, allowedNetworkDomains);
        if (staticAnalysis.Verdict == StaticAnalysisVerdict.Blocked)
        {
            return TypedResults.Problem(
                title: "Static analysis blocked this bundle",
                detail: "See the findings for the specific rule(s) triggered.",
                statusCode: StatusCodes.Status422UnprocessableEntity,
                extensions: new Dictionary<string, object?>
                {
                    ["findings"] = staticAnalysis.Findings.Select(f => new { f.Rule, Severity = f.Severity.ToString(), f.Detail }),
                });
        }

        var dependencies = req.Dependencies ?? [];
        var auditor = new PackageDependencyAuditor(db);
        var audit = await auditor.AuditAsync(name, dependencies, ct);
        if (!audit.Passed)
        {
            return TypedResults.Problem(
                title: "Dependency audit failed",
                detail: "See errors for the specific dependency issue(s).",
                statusCode: StatusCodes.Status422UnprocessableEntity,
                extensions: new Dictionary<string, object?> { ["errors"] = audit.Errors });
        }

        var package = existingPackage ?? new Package
        {
            Name = name,
            Kind = req.Kind,
            AuthorUserId = currentUser.UserId,
            DisplayName = req.DisplayName,
            Summary = req.Summary,
            ReadmeMarkdown = req.ReadmeMarkdown,
            HomepageUrl = req.HomepageUrl,
            LicenseSpdx = req.LicenseSpdx,
            CreatedAt = DateTimeOffset.UtcNow,
        };
        if (existingPackage is null)
        {
            db.Packages.Add(package);
            await db.SaveChangesAsync(ct); // package.Id must be real before the version row below.
        }

        string bundleUrl;
        try
        {
            bundleUrl = await bundleStorage.UploadAsync(name, req.Version, bundleBytes, "application/javascript", ct);
        }
        catch (BundleAlreadyExistsException)
        {
            // The database's (package_id, version) unique index is the
            // primary immutability guarantee, already checked above; this
            // is the storage layer's own half of it catching a genuine
            // concurrent-publish race (CLAUDE.md Section 1.5 guardrail
            // 21's spirit — do not assume one caller at a time).
            return TypedResults.Problem(
                title: "Version already published",
                detail: $"'{name}'@'{req.Version}' was published by a concurrent request.",
                statusCode: StatusCodes.Status409Conflict);
        }

        var version = new PackageVersion
        {
            PackageId = package.Id,
            Version = req.Version,
            EngineRange = req.EngineRange,
            Manifest = req.Manifest,
            BundleUrl = bundleUrl,
            BundleSha256 = SHA256.HashData(bundleBytes),
            SizeBytes = bundleBytes.Length,
            ScanStatus = PackageScanStatus.Pending, // Gate 4 (M6 Phase 3) still has to run before this can become Passed.
            PublishedAt = DateTimeOffset.UtcNow,
        };
        foreach (var (depName, range) in dependencies)
        {
            version.Dependencies.Add(new PackageDependency { DependsOnName = depName, VersionRange = range });
        }
        db.PackageVersions.Add(version);
        await db.SaveChangesAsync(ct);

        return TypedResults.Created(
            $"/api/v1/packages/{name}/versions/{req.Version}",
            new PublishVersionResponse(package.Id, version.Id, version.ScanStatus, staticAnalysis.Findings.Select(f => $"{f.Rule}: {f.Detail}").ToList()));
    }

    private static HashSet<string> ExtractNetworkAllowlist(JsonElement manifest)
    {
        var domains = new HashSet<string>();
        if (manifest.ValueKind == JsonValueKind.Object
            && manifest.TryGetProperty("networkAllowlist", out var allowlist)
            && allowlist.ValueKind == JsonValueKind.Array)
        {
            foreach (var entry in allowlist.EnumerateArray())
            {
                if (entry.ValueKind == JsonValueKind.String && entry.GetString() is { } domain)
                {
                    domains.Add(domain);
                }
            }
        }
        return domains;
    }
}
