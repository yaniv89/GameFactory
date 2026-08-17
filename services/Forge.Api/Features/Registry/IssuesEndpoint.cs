using Forge.Api.Authorization;
using Forge.Api.Features.Registry.Publishing;
using Forge.Api.RateLimiting;
using Forge.Domain.Entities;
using Forge.Infrastructure.Persistence;
using Forge.Infrastructure.Storage;
using Microsoft.EntityFrameworkCore;

namespace Forge.Api.Features.Registry;

/// <summary>
/// docs/SPEC.md Section 16.2's minimal issue tracker (the
/// SupportResponsivenessHours ranking signal's own data source):
/// <c>POST /api/v1/packages/{name}/issues</c> (file an issue, any
/// authenticated user) and <c>POST /api/v1/packages/{name}/issues/{issueId}/reply</c>
/// (author-only reply, resolved server-side from
/// <see cref="Entities.Package.AuthorUserId"/> against the token subject
/// — never a client-supplied claim, CLAUDE.md Section 1.1 guardrail 4).
/// <c>GET .../issues</c> lives in <see cref="PackageDetailAndVersionsEndpoint"/>
/// instead, for the same "one class owns the GET catch-all" reason that
/// class's own doc comment already gives for reviews.
///
/// This class also owns the one <c>POST</c> registration on this
/// template. <see cref="Publishing.PublishVersionEndpoint"/> used to
/// register its own <c>MapPost</c> here; a second one for issues would
/// be an ambiguous match at request time — the same problem
/// <see cref="ReviewsEndpoint"/>'s own doc comment already documents for
/// <c>PUT</c>/<see cref="Forge.Api.Features.Marketplace.SetListingEndpoint"/>
/// — so
/// <see cref="DispatchPost"/> reads the trailing segment(s) first and
/// routes to whichever handler actually owns it, deserializing the body
/// only after that decision is made.
/// </summary>
public static class IssuesEndpoint
{
    public static IEndpointRouteBuilder MapIssues(this IEndpointRouteBuilder app)
    {
        app.MapPost("/api/v1/packages/{*path}", DispatchPost)
            .RequireAuthorization(ForgeAuthorizationExtensions.BearerPolicy)
            .WithRateLimit("api", RateLimitKeyStrategy.User, RateLimitPolicies.Api)
            .WithName("PostPackageSubresource")
            .Produces<PublishVersionResponse>(StatusCodes.Status201Created)
            .Produces<IssueResponse>(StatusCodes.Status201Created)
            .Produces<IssueReplyResponse>(StatusCodes.Status201Created)
            .ProducesValidationProblem()
            .ProducesProblem(StatusCodes.Status403Forbidden)
            .ProducesProblem(StatusCodes.Status404NotFound)
            .ProducesProblem(StatusCodes.Status409Conflict)
            .ProducesProblem(StatusCodes.Status422UnprocessableEntity)
            .ProducesProblem(StatusCodes.Status413PayloadTooLarge);
        return app;
    }

    private static async Task<IResult> DispatchPost(
        string path, HttpContext context, ForgeDbContext db, ICurrentUser currentUser, IPackageBundleStorage bundleStorage, CancellationToken ct)
    {
        var segments = path.Split('/', StringSplitOptions.RemoveEmptyEntries);
        if (segments.Length == 0) return TypedResults.NotFound();

        // "{name}/issues/{issueId}/reply" — checked before the plain
        // last-segment switch below, since its own last segment ("reply")
        // isn't one of the other two branches at all.
        if (segments.Length >= 3 && segments[^1] == "reply" && segments[^3] == "issues")
        {
            return await HandleReply(
                segments[^2], path,
                await context.Request.ReadFromJsonAsync<CreateIssueReplyRequest>(ct) ?? new CreateIssueReplyRequest(""),
                db, currentUser, ct);
        }

        return segments[^1] switch
        {
            "versions" => await PublishVersionEndpoint.Handle(
                path,
                await context.Request.ReadFromJsonAsync<PublishVersionRequest>(ct)
                    ?? new PublishVersionRequest("", "", "", null, null, "", "", "", default, "", null),
                db, currentUser, bundleStorage, ct),
            "issues" => await HandleCreateIssue(
                path, await context.Request.ReadFromJsonAsync<CreateIssueRequest>(ct) ?? new CreateIssueRequest("", null), db, currentUser, ct),
            _ => TypedResults.NotFound(),
        };
    }

    private static async Task<IResult> HandleCreateIssue(string path, CreateIssueRequest req, ForgeDbContext db, ICurrentUser currentUser, CancellationToken ct)
    {
        var name = ExtractPackageName(path, "issues");
        if (name is null) return TypedResults.NotFound();

        if (string.IsNullOrWhiteSpace(req.Title))
        {
            return TypedResults.ValidationProblem(new Dictionary<string, string[]> { ["title"] = ["Must not be empty."] });
        }

        var packageId = await db.Packages.Where(p => p.Name == name).Select(p => (Guid?)p.Id).SingleOrDefaultAsync(ct);
        if (packageId is null) return TypedResults.NotFound();

        var issue = new PackageIssue
        {
            Id = Guid.NewGuid(),
            PackageId = packageId.Value,
            ReporterUserId = currentUser.UserId,
            Title = req.Title.Trim(),
            Body = req.Body,
            CreatedAt = DateTimeOffset.UtcNow,
        };
        db.PackageIssues.Add(issue);
        await db.SaveChangesAsync(ct);

        return TypedResults.Ok(new IssueResponse(issue.Id, issue.ReporterUserId, issue.Title, issue.Body, issue.CreatedAt, FirstReplyAt: null));
    }

    private static async Task<IResult> HandleReply(string issueIdSegment, string path, CreateIssueReplyRequest req, ForgeDbContext db, ICurrentUser currentUser, CancellationToken ct)
    {
        var name = ExtractPackageName(path, "reply", trailingSegmentsToStrip: 3);
        if (name is null || !Guid.TryParse(issueIdSegment, out var issueId)) return TypedResults.NotFound();

        if (string.IsNullOrWhiteSpace(req.Body))
        {
            return TypedResults.ValidationProblem(new Dictionary<string, string[]> { ["body"] = ["Must not be empty."] });
        }

        var package = await db.Packages.Where(p => p.Name == name).Select(p => new { p.Id, p.AuthorUserId }).SingleOrDefaultAsync(ct);
        if (package is null) return TypedResults.NotFound();

        // Author-only — resolved from the package's own AuthorUserId
        // against the token subject, never a client-supplied claim
        // (CLAUDE.md Section 1.1 guardrail 4). A non-author gets a real,
        // attributed 403: this is a permission gap, not a missing issue.
        if (package.AuthorUserId != currentUser.UserId)
        {
            return TypedResults.Problem(
                title: "Only this package's author can reply",
                detail: "Replying to a support issue is limited to the package's own author.",
                statusCode: StatusCodes.Status403Forbidden);
        }

        var issueExists = await db.PackageIssues.AnyAsync(i => i.Id == issueId && i.PackageId == package.Id, ct);
        if (!issueExists) return TypedResults.NotFound();

        var reply = new PackageIssueReply
        {
            Id = Guid.NewGuid(),
            IssueId = issueId,
            AuthorUserId = currentUser.UserId,
            Body = req.Body.Trim(),
            CreatedAt = DateTimeOffset.UtcNow,
        };
        db.PackageIssueReplies.Add(reply);
        await db.SaveChangesAsync(ct);

        return TypedResults.Ok(new IssueReplyResponse(reply.Id, reply.IssueId, reply.AuthorUserId, reply.Body, reply.CreatedAt));
    }

    /// <summary>Same segment-splitting shape <see cref="ReviewsEndpoint"/>'s own copy uses — a scoped name is exactly 2 segments, an unscoped one exactly 1, and the path must end in the expected trailing shape for this handler to be the right one at all. <paramref name="trailingSegmentsToStrip"/> covers the multi-segment "issues/{id}/reply" shape; the default 1 covers the plain "issues" shape.</summary>
    private static string? ExtractPackageName(string path, string trailingSegment, int trailingSegmentsToStrip = 1)
    {
        var segments = path.Split('/', StringSplitOptions.RemoveEmptyEntries);
        if (segments.Length <= trailingSegmentsToStrip || segments[^1] != trailingSegment) return null;
        var nameSegmentCount = segments.Length - trailingSegmentsToStrip;
        if (nameSegmentCount is not (1 or 2)) return null;
        return string.Join('/', segments[..nameSegmentCount]);
    }
}
