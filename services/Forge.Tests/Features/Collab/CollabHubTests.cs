using System.Net.Http.Json;
using Forge.Api.Features.Projects;
using Forge.Domain.Entities;
using Forge.Infrastructure.Persistence;
using Forge.Infrastructure.Realtime;
using Microsoft.AspNetCore.Http.Connections;
using Microsoft.AspNetCore.SignalR.Client;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace Forge.Tests.Features.Collab;

/// <summary>
/// Drives a real <see cref="HubConnection"/> against the real
/// <c>CollabHub</c> over <see cref="ForgeWebApplicationFactory"/>'s
/// TestServer — nothing mocked, same posture as every other integration
/// test in this project. LongPolling, not the default WebSockets
/// transport: TestServer's in-memory handler pipeline (no real socket)
/// doesn't support a genuine WebSocket upgrade, and LongPolling exercises
/// the same hub connection lifecycle (OnConnectedAsync/OnDisconnectedAsync,
/// groups, Clients.Group) through the same HTTP-pipeline-backed transport
/// SignalR's own test suite uses for this exact reason.
///
/// ⚠ Not run in this sandbox: no .NET SDK here. Verified when CI runs on
/// a GitHub-hosted runner.
/// </summary>
public sealed class CollabHubTests : IClassFixture<ForgeWebApplicationFactory>
{
    private readonly ForgeWebApplicationFactory _factory;

    public CollabHubTests(ForgeWebApplicationFactory factory)
    {
        _factory = factory;
    }

    private async Task<ProjectDetailResponse> CreateProjectAsync(AuthenticatedTestUser owner)
    {
        var response = await owner.Client.PostAsJsonAsync(
            $"/api/v1/workspaces/{owner.WorkspaceId}/projects",
            new { slug = $"collab-{Guid.NewGuid():N}", title = "Collab Fixture", description = (string?)null, engineVersion = "0.1.0", genreTemplate = (string?)null });
        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<ProjectDetailResponse>())!;
    }

    private async Task AddWorkspaceMemberAsync(Guid workspaceId, Guid userId, string role)
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ForgeDbContext>();
        db.WorkspaceMembers.Add(new WorkspaceMember { WorkspaceId = workspaceId, UserId = userId, Role = role, JoinedAt = DateTimeOffset.UtcNow });
        await db.SaveChangesAsync();
    }

    private HubConnection BuildConnection(AuthenticatedTestUser user, Guid projectId)
    {
        var accessToken = user.Client.DefaultRequestHeaders.Authorization!.Parameter!;
        return new HubConnectionBuilder()
            .WithUrl(new Uri(_factory.Server.BaseAddress, $"/hubs/collab?projectId={projectId}"), options =>
            {
                options.HttpMessageHandlerFactory = _ => _factory.Server.CreateHandler();
                options.Transports = HttpTransportType.LongPolling;
                options.AccessTokenProvider = () => Task.FromResult<string?>(accessToken);
            })
            .Build();
    }

    [Fact]
    public async Task Connecting_Without_Workspace_Membership_Is_Rejected()
    {
        var owner = await AuthTestHelper.SignupAndAuthenticateAsync(_factory);
        var outsider = await AuthTestHelper.SignupAndAuthenticateAsync(_factory);
        var project = await CreateProjectAsync(owner);

        await using var connection = BuildConnection(outsider, project.Id);
        var closedTcs = new TaskCompletionSource<Exception?>();
        connection.Closed += ex =>
        {
            closedTcs.TrySetResult(ex);
            return Task.CompletedTask;
        };

        // The server aborts the connection inside OnConnectedAsync, after
        // the transport-level handshake already succeeded — so this can
        // surface either as StartAsync throwing directly, or as a
        // successful StartAsync immediately followed by Closed firing.
        // Both mean the same real thing: the outsider never got a
        // working collaboration session on a project outside their
        // workspace (CLAUDE.md Section 1.1 guardrail 4).
        try
        {
            await connection.StartAsync();
            await closedTcs.Task.WaitAsync(TimeSpan.FromSeconds(10));
        }
        catch (Exception) when (connection.State != HubConnectionState.Connected)
        {
            // StartAsync itself failing is the other acceptable shape.
        }

        Assert.NotEqual(HubConnectionState.Connected, connection.State);
    }

    [Fact]
    public async Task Connecting_With_An_Invalid_Project_Id_Is_Rejected()
    {
        var user = await AuthTestHelper.SignupAndAuthenticateAsync(_factory);

        await using var connection = BuildConnection(user, Guid.NewGuid()); // real guid, no such project
        var closedTcs = new TaskCompletionSource<Exception?>();
        connection.Closed += ex =>
        {
            closedTcs.TrySetResult(ex);
            return Task.CompletedTask;
        };

        try
        {
            await connection.StartAsync();
            await closedTcs.Task.WaitAsync(TimeSpan.FromSeconds(10));
        }
        catch (Exception) when (connection.State != HubConnectionState.Connected)
        {
        }

        Assert.NotEqual(HubConnectionState.Connected, connection.State);
    }

    [Fact]
    public async Task Two_Workspace_Members_See_Each_Others_Presence()
    {
        var owner = await AuthTestHelper.SignupAndAuthenticateAsync(_factory);
        var editor = await AuthTestHelper.SignupAndAuthenticateAsync(_factory);
        var project = await CreateProjectAsync(owner);
        await AddWorkspaceMemberAsync(owner.WorkspaceId, editor.UserId, WorkspaceRole.Editor);

        await using var ownerConnection = BuildConnection(owner, project.Id);
        var ownerInitialRoster = new TaskCompletionSource<IReadOnlyList<PresenceEntry>>();
        ownerConnection.On<IReadOnlyList<PresenceEntry>>("presence:roster", roster => ownerInitialRoster.TrySetResult(roster));
        var ownerSawJoin = new TaskCompletionSource<PresenceEntry>();
        ownerConnection.On<PresenceEntry>("presence:joined", entry => ownerSawJoin.TrySetResult(entry));
        var ownerSawLeave = new TaskCompletionSource<string>();
        ownerConnection.On<string>("presence:left", connectionId => ownerSawLeave.TrySetResult(connectionId));

        await ownerConnection.StartAsync();
        var initialRoster = await ownerInitialRoster.Task.WaitAsync(TimeSpan.FromSeconds(10));
        Assert.Single(initialRoster, entry => entry.UserId == owner.UserId);

        var editorConnection = BuildConnection(editor, project.Id);
        var editorInitialRoster = new TaskCompletionSource<IReadOnlyList<PresenceEntry>>();
        editorConnection.On<IReadOnlyList<PresenceEntry>>("presence:roster", roster => editorInitialRoster.TrySetResult(roster));
        await editorConnection.StartAsync();

        var editorRoster = await editorInitialRoster.Task.WaitAsync(TimeSpan.FromSeconds(10));
        Assert.Equal(2, editorRoster.Count);
        Assert.Contains(editorRoster, entry => entry.UserId == owner.UserId);
        Assert.Contains(editorRoster, entry => entry.UserId == editor.UserId);

        var joined = await ownerSawJoin.Task.WaitAsync(TimeSpan.FromSeconds(10));
        Assert.Equal(editor.UserId, joined.UserId);

        // Captured before StopAsync(): HubConnection resets ConnectionId
        // to null once stopped, so reading it after disconnecting would
        // compare against null instead of the id CollabHub actually saw.
        var editorConnectionId = editorConnection.ConnectionId;
        await editorConnection.StopAsync();
        var leftConnectionId = await ownerSawLeave.Task.WaitAsync(TimeSpan.FromSeconds(10));
        Assert.Equal(editorConnectionId, leftConnectionId);
        await editorConnection.DisposeAsync();
    }
}
