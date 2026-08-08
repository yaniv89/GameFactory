using Forge.Api.RateLimiting;
using Forge.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Forge.Api.Features.Billing;

/// <summary>docs/SPEC.md Section 13.2: <c>GET /api/v1/workspaces/{ws}/billing</c> — current plan, status, renewal date, read-only, server-resolved.</summary>
public static class GetBillingStatusEndpoint
{
    public static IEndpointRouteBuilder MapGetBillingStatus(this IEndpointRouteBuilder app)
    {
        app.MapGet("/api/v1/workspaces/{workspaceId:guid}/billing", Handle)
            .RequireAuthorization("workspace:billing")
            .WithRateLimit("billing", RateLimitKeyStrategy.User, RateLimitPolicies.Api)
            .WithName("GetBillingStatus")
            .Produces<BillingStatusResponse>()
            .ProducesProblem(StatusCodes.Status404NotFound);
        return app;
    }

    private static async Task<IResult> Handle(Guid workspaceId, ForgeDbContext db, CancellationToken ct)
    {
        var workspace = await db.Workspaces.SingleOrDefaultAsync(w => w.Id == workspaceId && w.DeletedAt == null, ct);
        if (workspace is null) return TypedResults.NotFound();

        var subscription = await db.Subscriptions
            .Where(s => s.WorkspaceId == workspaceId)
            .OrderByDescending(s => s.CreatedAt)
            .FirstOrDefaultAsync(ct);

        return TypedResults.Ok(new BillingStatusResponse(
            workspace.Plan,
            subscription?.Status,
            subscription?.CurrentPeriodEnd,
            subscription?.CancelAtPeriodEnd ?? false));
    }
}
