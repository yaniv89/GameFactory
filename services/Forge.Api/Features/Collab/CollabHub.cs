using Forge.Api.Authorization;
using Forge.Domain.Entities;
using Forge.Infrastructure.Persistence;
using Forge.Infrastructure.Realtime;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using OpenIddict.Abstractions;

namespace Forge.Api.Features.Collab;

/// <summary>
/// docs/SPEC.md Section 13.2's <c>WS /hubs/collab?projectId={id}</c> —
/// presence today (M7 Phase 1); Yjs CRDT update relay joins it in M7
/// Phase 2, over the same group/connection plumbing this class already
/// sets up.
///
/// Authorization here deliberately does NOT go through the same
/// <c>WorkspaceRoleRequirement</c>/route-value machinery
/// <c>ForgeAuthorizationExtensions</c> registers for ordinary HTTP
/// endpoints: that machinery resolves its resource id from
/// <c>HttpContext.GetRouteValue</c>, and this hub's <c>projectId</c>
/// arrives as a query-string parameter on the SignalR negotiate request
/// instead (the SPEC's own URL shape), which route values don't see. The
/// class-level <see cref="AuthorizeAttribute"/> only proves the caller is
/// *some* authenticated user; <see cref="OnConnectedAsync"/> then does
/// the same real per-resource check <c>WorkspaceRoleHandler</c> does —
/// resolve the domain user from the token's own <c>sub</c> claim, never
/// a client-supplied id (CLAUDE.md Section 1.1 guardrail 4), then check
/// that user's real workspace-membership row for the project's actual
/// workspace (never a client-supplied role or workspace id, same
/// guardrail) — inlined rather than reusing <c>ICurrentUser</c>, for the
/// exact reason <c>WorkspaceRoleHandler</c>'s own doc comment gives:
/// <c>CurrentUserMiddleware</c> populates that scoped service once per
/// ordinary HTTP request, but each SignalR hub invocation runs in its
/// own DI scope that middleware never touches, so it would always read
/// as unauthenticated here.
///
/// An unauthorized connection is aborted, not refused with a distinct
/// error — docs/SPEC.md Section 4.5's "cross-tenant access returns 404,
/// never 403" applied to a protocol with no such status codes: a caller
/// who guesses another workspace's project id learns only that the
/// connection didn't stay up, identical to what an invalid project id
/// looks like, never which case it was.
/// </summary>
[Authorize(Policy = ForgeAuthorizationExtensions.BearerPolicy)]
public sealed class CollabHub(ForgeDbContext db, IPresenceStore presence) : Hub
{
    private const string ProjectIdItemKey = "projectId";

    private static readonly IReadOnlyDictionary<string, int> RoleRank = new Dictionary<string, int>
    {
        [WorkspaceRole.Viewer] = 0,
        [WorkspaceRole.Editor] = 1,
        [WorkspaceRole.Admin] = 2,
        [WorkspaceRole.Owner] = 3,
    };

    internal static string GroupName(Guid projectId) => $"project:{projectId}";

    public override async Task OnConnectedAsync()
    {
        var ct = Context.ConnectionAborted;
        var httpContext = Context.GetHttpContext();
        var projectIdRaw = httpContext?.Request.Query["projectId"].ToString();
        if (!Guid.TryParse(projectIdRaw, out var projectId))
        {
            Context.Abort();
            return;
        }

        var subjectClaim = Context.User?.FindFirst(OpenIddictConstants.Claims.Subject)?.Value;
        if (subjectClaim is null)
        {
            Context.Abort();
            return;
        }

        var user = await db.DomainUsers
            .Where(u => u.IdentitySubjectId == subjectClaim && u.DeletedAt == null)
            .Select(u => new { u.Id, u.DisplayName })
            .SingleOrDefaultAsync(ct);
        if (user is null)
        {
            Context.Abort();
            return;
        }

        var workspaceId = await db.Projects
            .Where(p => p.Id == projectId && p.DeletedAt == null)
            .Select(p => (Guid?)p.WorkspaceId)
            .SingleOrDefaultAsync(ct);
        if (workspaceId is null)
        {
            Context.Abort();
            return;
        }

        var role = await db.WorkspaceMembers
            .Where(m => m.WorkspaceId == workspaceId && m.UserId == user.Id)
            .Select(m => m.Role)
            .SingleOrDefaultAsync(ct);
        if (role is null || !RoleRank.TryGetValue(role, out var rank) || rank < RoleRank[WorkspaceRole.Viewer])
        {
            Context.Abort();
            return;
        }

        Context.Items[ProjectIdItemKey] = projectId;

        var group = GroupName(projectId);
        await Groups.AddToGroupAsync(Context.ConnectionId, group, ct);

        var roster = await presence.JoinAsync(projectId, Context.ConnectionId, user.Id, user.DisplayName, ct);
        await Clients.Caller.SendAsync("presence:roster", roster, cancellationToken: ct);
        await Clients.OthersInGroup(group).SendAsync(
            "presence:joined",
            new PresenceEntry(Context.ConnectionId, user.Id, user.DisplayName),
            cancellationToken: ct);

        await base.OnConnectedAsync();
    }

    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        if (Context.Items.TryGetValue(ProjectIdItemKey, out var projectIdObj) && projectIdObj is Guid projectId)
        {
            var ct = CancellationToken.None; // the connection is already gone; cleanup must still run
            await presence.LeaveAsync(projectId, Context.ConnectionId, ct);
            await Clients.Group(GroupName(projectId)).SendAsync("presence:left", Context.ConnectionId, cancellationToken: ct);
        }

        await base.OnDisconnectedAsync(exception);
    }
}
