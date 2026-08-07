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
/// Direct tests of <see cref="WorkspaceRoleHandler"/> against the real
/// database (same Testcontainers Postgres <see cref="ForgeWebApplicationFactory"/>
/// boots for every other integration test) — the standard way to test a
/// custom <see cref="AuthorizationHandler{TRequirement}"/> in isolation:
/// build a real <see cref="AuthorizationHandlerContext"/> and call the
/// handler's public <see cref="IAuthorizationHandler.HandleAsync"/> entry
/// point directly, rather than routing through an HTTP endpoint that
/// doesn't exist until M5 Phase 3 wires <c>project:read</c>/
/// <c>project:write</c> onto real routes.
///
/// ⚠ Not run in this sandbox: no .NET SDK here. Verified when CI runs on
/// a GitHub-hosted runner.
/// </summary>
public sealed class WorkspaceRoleHandlerTests : IClassFixture<ForgeWebApplicationFactory>
{
    private readonly ForgeWebApplicationFactory _factory;

    public WorkspaceRoleHandlerTests(ForgeWebApplicationFactory factory)
    {
        _factory = factory;
    }

    private sealed record Fixture(Guid WorkspaceId, Guid ProjectId, Guid OwnerUserId, Guid ViewerUserId, Guid OutsiderUserId);

    private async Task<Fixture> SeedAsync(ForgeDbContext db)
    {
        var workspace = new Workspace { Slug = $"ws-{Guid.NewGuid():N}", Name = "Test Workspace", CreatedAt = DateTimeOffset.UtcNow };
        var owner = new User { IdentitySubjectId = Guid.NewGuid().ToString(), Email = $"owner-{Guid.NewGuid():N}@example.com", DisplayName = "Owner", CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow };
        var viewer = new User { IdentitySubjectId = Guid.NewGuid().ToString(), Email = $"viewer-{Guid.NewGuid():N}@example.com", DisplayName = "Viewer", CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow };
        var outsider = new User { IdentitySubjectId = Guid.NewGuid().ToString(), Email = $"outsider-{Guid.NewGuid():N}@example.com", DisplayName = "Outsider", CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow };
        db.Workspaces.Add(workspace);
        db.Users.AddRange(owner, viewer, outsider);
        await db.SaveChangesAsync(CancellationToken.None);

        db.WorkspaceMembers.AddRange(
            new WorkspaceMember { WorkspaceId = workspace.Id, UserId = owner.Id, Role = WorkspaceRole.Owner, JoinedAt = DateTimeOffset.UtcNow },
            new WorkspaceMember { WorkspaceId = workspace.Id, UserId = viewer.Id, Role = WorkspaceRole.Viewer, JoinedAt = DateTimeOffset.UtcNow });

        var project = new Project
        {
            WorkspaceId = workspace.Id,
            Slug = "p",
            Title = "P",
            EngineVersion = "0.1.0",
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow,
        };
        db.Projects.Add(project);
        await db.SaveChangesAsync(CancellationToken.None);

        return new Fixture(workspace.Id, project.Id, owner.Id, viewer.Id, outsider.Id);
    }

    private static async Task<bool> EvaluateAsync(ForgeDbContext db, Guid resourceId, string routeParam, WorkspaceResourceKind kind, string minimumRole, Guid userId)
    {
        var currentUser = new CurrentUser { IsAuthenticated = true, UserId = userId, IdentitySubjectId = Guid.NewGuid() };

        var services = new ServiceCollection();
        services.AddSingleton<ICurrentUser>(currentUser);
        await using var provider = services.BuildServiceProvider();

        var httpContext = new DefaultHttpContext { RequestServices = provider };
        httpContext.Request.RouteValues[routeParam] = resourceId.ToString();

        var requirement = new WorkspaceRoleRequirement(minimumRole, kind, routeParam);
        var authContext = new AuthorizationHandlerContext([requirement], new System.Security.Claims.ClaimsPrincipal(), httpContext);

        var handler = new WorkspaceRoleHandler(db);
        await ((IAuthorizationHandler)handler).HandleAsync(authContext);

        return authContext.HasSucceeded;
    }

    [Fact]
    public async Task Owner_Passes_ProjectWrite()
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ForgeDbContext>();
        var fixture = await SeedAsync(db);

        var succeeded = await EvaluateAsync(db, fixture.ProjectId, "projectId", WorkspaceResourceKind.Project, WorkspaceRole.Editor, fixture.OwnerUserId);

        Assert.True(succeeded);
    }

    [Fact]
    public async Task Viewer_Fails_ProjectWrite_But_Passes_ProjectRead()
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ForgeDbContext>();
        var fixture = await SeedAsync(db);

        var canWrite = await EvaluateAsync(db, fixture.ProjectId, "projectId", WorkspaceResourceKind.Project, WorkspaceRole.Editor, fixture.ViewerUserId);
        var canRead = await EvaluateAsync(db, fixture.ProjectId, "projectId", WorkspaceResourceKind.Project, WorkspaceRole.Viewer, fixture.ViewerUserId);

        Assert.False(canWrite);
        Assert.True(canRead);
    }

    [Fact]
    public async Task Non_Member_Fails_Even_ProjectRead()
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ForgeDbContext>();
        var fixture = await SeedAsync(db);

        var succeeded = await EvaluateAsync(db, fixture.ProjectId, "projectId", WorkspaceResourceKind.Project, WorkspaceRole.Viewer, fixture.OutsiderUserId);

        Assert.False(succeeded);
    }

    [Fact]
    public async Task Nonexistent_Project_Fails_Closed_Rather_Than_Throwing()
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ForgeDbContext>();
        var fixture = await SeedAsync(db);

        var succeeded = await EvaluateAsync(db, Guid.NewGuid(), "projectId", WorkspaceResourceKind.Project, WorkspaceRole.Viewer, fixture.OwnerUserId);

        Assert.False(succeeded);
    }
}
