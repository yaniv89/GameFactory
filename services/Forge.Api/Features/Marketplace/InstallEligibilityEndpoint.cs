using Forge.Domain.Entities;
using Forge.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Forge.Api.Features.Marketplace;

/// <summary>
/// <c>GET /api/v1/projects/{projectId}/marketplace-installable/{*packageName}</c>
/// — the check the editor's marketplace Install button runs before adding
/// a package to a project's own module list (the "install a purchased/free
/// marketplace package" feature this endpoint is the backend half of).
///
/// Deliberately read-only: it never mutates <c>installedModules</c> itself
/// — that write happens client-side through the editor's existing
/// <c>installModule</c> command (the same undo/sync/save path every other
/// module install already goes through, first-party or not), keeping this
/// endpoint a plain authorize-and-resolve step rather than a second,
/// parallel way to mutate a project's document outside its own CRDT/
/// command-log system.
///
/// Route-value-based <c>project:write</c> authorization, the same bar
/// <see cref="PurchaseCheckoutSessionEndpoint"/>'s own doc comment names
/// for installing a paid module ("an editing action") — cross-tenant
/// project access 404s, never 403s (docs/SPEC.md Section 4.5), handled
/// generically by the policy before <see cref="Handle"/> ever runs.
///
/// The free-or-licensed gate reuses the exact query
/// <see cref="PurchaseCheckoutSessionEndpoint"/>'s own <c>alreadyLicensed</c>
/// check already runs, un-negated: a license is scoped to the project's
/// own workspace, never trusted from a client-supplied field (CLAUDE.md
/// Section 1.1 guardrail 4) — resolved here from the project's real,
/// server-side <see cref="Project.WorkspaceId"/>, not anything the caller
/// asserts.
///
/// Only a version with <see cref="PackageScanStatus.Passed"/> is ever
/// returned — the same bar gate 4's sandboxed smoke run (and, for
/// unverified authors, gate 5's human review) already sets for what's
/// trustworthy to run at all (docs/SPEC.md Section 10.4). A package with
/// no such version yet is correctly "not installable," not a 404 — the
/// package and its listing are both real, it just has nothing safe to
/// install.
/// </summary>
public static class InstallEligibilityEndpoint
{
    public static IEndpointRouteBuilder MapInstallEligibility(this IEndpointRouteBuilder app)
    {
        app.MapGet("/api/v1/projects/{projectId:guid}/marketplace-installable/{*packageName}", Handle)
            .RequireAuthorization("project:write")
            .WithName("GetMarketplaceInstallEligibility")
            .Produces<MarketplaceInstallableResponse>()
            .ProducesValidationProblem()
            .ProducesProblem(StatusCodes.Status404NotFound);
        return app;
    }

    private static async Task<IResult> Handle(Guid projectId, string packageName, ForgeDbContext db, CancellationToken ct)
    {
        var project = await db.Projects.SingleOrDefaultAsync(p => p.Id == projectId && p.DeletedAt == null, ct);
        if (project is null) return TypedResults.NotFound();

        var package = await db.Packages.SingleOrDefaultAsync(p => p.Name == packageName, ct);
        if (package is null) return TypedResults.NotFound();

        var listing = await db.Listings.SingleOrDefaultAsync(l => l.PackageId == package.Id, ct);
        if (listing is null || !listing.IsListed)
        {
            return TypedResults.ValidationProblem(new Dictionary<string, string[]>
            {
                ["packageName"] = ["This package is not currently available to install."],
            });
        }

        if (listing.PricingModel != ListingPricingModel.Free)
        {
            var hasLicense = await db.Licenses.AnyAsync(
                l => l.PackageId == package.Id && l.WorkspaceId == project.WorkspaceId && l.RevokedAt == null, ct);
            if (!hasLicense)
            {
                return TypedResults.Problem(
                    title: "Purchase required",
                    detail: "This project's workspace doesn't hold a license for this package yet — buy it from the marketplace first.",
                    statusCode: StatusCodes.Status403Forbidden);
            }
        }

        var version = await db.PackageVersions
            .Where(v => v.PackageId == package.Id && v.YankedAt == null && v.ScanStatus == PackageScanStatus.Passed)
            .OrderByDescending(v => v.PublishedAt)
            .FirstOrDefaultAsync(ct);
        if (version is null)
        {
            return TypedResults.ValidationProblem(new Dictionary<string, string[]>
            {
                ["packageName"] = ["This package has no published version that has cleared review yet — nothing safe to install."],
            });
        }

        return TypedResults.Ok(new MarketplaceInstallableResponse(
            package.Name, version.Version, version.Manifest, version.BundleUrl, Convert.ToHexString(version.BundleSha256)));
    }
}
