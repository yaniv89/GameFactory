using System.Security.Claims;
using Forge.Api.Authorization;
using Forge.Domain.Entities;
using Forge.Infrastructure.Persistence;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace Forge.Tests.Authorization;

/// <summary>
/// Direct tests of <see cref="PlanGateHandler"/>, same idiom as
/// <see cref="WorkspaceRoleHandlerTests"/> — a real
/// <see cref="AuthorizationHandlerContext"/> against the real database.
/// Unlike <see cref="WorkspaceRoleHandler"/>, this handler never reads the
/// caller's identity (plan is a workspace property, not a caller
/// property), so the principal here is just an empty placeholder.
///
/// ⚠ Not run in this sandbox: no .NET SDK here. Verified when CI runs on
/// a GitHub-hosted runner.
/// </summary>
public sealed class PlanGateHandlerTests : IClassFixture<ForgeWebApplicationFactory>
{
    private readonly ForgeWebApplicationFactory _factory;

    public PlanGateHandlerTests(ForgeWebApplicationFactory factory)
    {
        _factory = factory;
    }

    private static async Task<bool> EvaluateAsync(ForgeDbContext db, Guid workspaceId)
    {
        var httpContext = new DefaultHttpContext();
        httpContext.Request.RouteValues["workspaceId"] = workspaceId.ToString();

        var requirement = new PlanGateRequirement(WorkspaceResourceKind.Workspace, "workspaceId");
        var authContext = new AuthorizationHandlerContext([requirement], new ClaimsPrincipal(), httpContext);

        var handler = new PlanGateHandler(db);
        await ((IAuthorizationHandler)handler).HandleAsync(authContext);

        return authContext.HasSucceeded;
    }

    [Theory]
    [InlineData(WorkspacePlan.Free, false)]
    [InlineData(WorkspacePlan.Pro, true)]
    [InlineData(WorkspacePlan.Studio, true)]
    public async Task Gate_Passes_Only_For_Paid_Plans(string plan, bool expectedSucceeded)
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ForgeDbContext>();

        var workspace = new Workspace { Slug = $"ws-{Guid.NewGuid():N}", Name = "Test Workspace", Plan = plan, CreatedAt = DateTimeOffset.UtcNow };
        db.Workspaces.Add(workspace);
        await db.SaveChangesAsync();

        var succeeded = await EvaluateAsync(db, workspace.Id);

        Assert.Equal(expectedSucceeded, succeeded);
    }

    [Fact]
    public async Task Nonexistent_Workspace_Fails_Closed_Rather_Than_Throwing()
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ForgeDbContext>();

        var succeeded = await EvaluateAsync(db, Guid.NewGuid());

        Assert.False(succeeded);
    }
}
