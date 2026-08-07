using Forge.Api.Authorization;
using Forge.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Forge.Api.Features.Auth;

public sealed record WorkspaceSummary(Guid WorkspaceId, string Slug, string Name, string Plan, string Role);

public sealed record MeResponse(Guid UserId, string Email, string DisplayName, DateTimeOffset? EmailVerifiedAt, IReadOnlyList<WorkspaceSummary> Workspaces);

public sealed record UpdateMeRequest(string? DisplayName, string? AvatarUrl);

/// <summary>docs/SPEC.md Section 13.2: profile + workspace list + plan, resolved from the token subject — never a route/query parameter.</summary>
public static class MeEndpoint
{
    public static IEndpointRouteBuilder MapMe(this IEndpointRouteBuilder app)
    {
        app.MapGet("/api/v1/me", HandleGet)
            .RequireAuthorization(ForgeAuthorizationExtensions.BearerPolicy)
            .WithName("GetMe")
            .Produces<MeResponse>();

        app.MapPatch("/api/v1/me", HandlePatch)
            .RequireAuthorization(ForgeAuthorizationExtensions.BearerPolicy)
            .WithName("UpdateMe")
            .Produces<MeResponse>()
            .ProducesValidationProblem();

        return app;
    }

    private static async Task<IResult> HandleGet(ICurrentUser currentUser, ForgeDbContext db, CancellationToken ct)
    {
        var response = await LoadMeAsync(db, currentUser.UserId, ct);
        return response is null ? TypedResults.Unauthorized() : TypedResults.Ok(response);
    }

    private static async Task<IResult> HandlePatch(UpdateMeRequest req, ICurrentUser currentUser, ForgeDbContext db, CancellationToken ct)
    {
        var user = await db.DomainUsers.SingleOrDefaultAsync(u => u.Id == currentUser.UserId && u.DeletedAt == null, ct);
        if (user is null) return TypedResults.Unauthorized();

        if (!string.IsNullOrWhiteSpace(req.DisplayName))
        {
            user.DisplayName = req.DisplayName;
        }
        if (req.AvatarUrl is not null)
        {
            user.AvatarUrl = req.AvatarUrl;
        }
        user.UpdatedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(ct);

        return TypedResults.Ok(await LoadMeAsync(db, currentUser.UserId, ct));
    }

    private static async Task<MeResponse?> LoadMeAsync(ForgeDbContext db, Guid userId, CancellationToken ct)
    {
        var user = await db.DomainUsers.SingleOrDefaultAsync(u => u.Id == userId && u.DeletedAt == null, ct);
        if (user is null) return null;

        var workspaces = await db.WorkspaceMembers
            .Where(m => m.UserId == userId)
            .Join(db.Workspaces, m => m.WorkspaceId, w => w.Id, (m, w) => new WorkspaceSummary(w.Id, w.Slug, w.Name, w.Plan, m.Role))
            .ToListAsync(ct);

        return new MeResponse(user.Id, user.Email, user.DisplayName, user.EmailVerifiedAt, workspaces);
    }
}
