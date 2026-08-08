using System.Text.Json;
using Forge.Api.Features.Projects;
using Forge.Domain.Entities;
using Forge.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace Forge.Tests.Features.Projects;

/// <summary>
/// Targets <see cref="RevisionCommitService.CommitAsync"/> directly,
/// below the HTTP layer, so contention between genuinely concurrent
/// Postgres Serializable transactions is deterministic to assert on
/// rather than incidental to whatever <see cref="Forge.Tests.LoadTests.ConcurrentEditorsLoadTests"/>
/// happens to trigger under HTTP-level timing.
///
/// A real CI run against this exact scenario (many concurrent commits
/// against the same project, same <c>expectedHeadRevision</c>) is what
/// first surfaced the bug this test guards: Postgres correctly rejects
/// the losing transactions with a 40001 serialization failure, but that
/// failure came back as an unhandled exception — a 500, not the intended
/// <see cref="CommitResultKind.Conflict"/> — because nothing caught it.
///
/// ⚠ Not run in this sandbox: no .NET SDK here. Verified when CI runs on
/// a GitHub-hosted runner.
/// </summary>
public sealed class RevisionCommitServiceTests : IClassFixture<ForgeWebApplicationFactory>
{
    private readonly ForgeWebApplicationFactory _factory;

    public RevisionCommitServiceTests(ForgeWebApplicationFactory factory)
    {
        _factory = factory;
    }

    [Fact]
    public async Task Concurrent_Commits_Against_The_Same_Head_Never_Throw_Exactly_One_Wins()
    {
        const int contenders = 15;

        Guid projectId;
        long initialRevisionId;
        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ForgeDbContext>();
            var workspace = new Workspace { Slug = $"ws-{Guid.NewGuid():N}", Name = "Test Workspace", CreatedAt = DateTimeOffset.UtcNow };
            db.Workspaces.Add(workspace);
            var project = new Project
            {
                WorkspaceId = workspace.Id,
                Slug = "contention",
                Title = "Contention",
                EngineVersion = "0.1.0",
                CreatedAt = DateTimeOffset.UtcNow,
                UpdatedAt = DateTimeOffset.UtcNow,
            };
            db.Projects.Add(project);
            await db.SaveChangesAsync();
            projectId = project.Id;

            var initialDoc = JsonSerializer.SerializeToElement(new { scenes = Array.Empty<object>(), installedModules = new { } });
            var initialResult = await RevisionCommitService.CommitAsync(db, projectId, null, null, null, false, initialDoc, CancellationToken.None);
            Assert.Equal(CommitResultKind.Committed, initialResult.Kind);
            initialRevisionId = initialResult.Revision!.Id;
        }

        // Every contender uses its own DbContext (its own real Postgres
        // connection/transaction) racing against the same expected head —
        // DbContext isn't safe to share across concurrent operations, and
        // sharing one here would also mean sharing one Postgres
        // transaction, which can't itself race against anything.
        var tasks = Enumerable.Range(0, contenders).Select(async i =>
        {
            using var scope = _factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<ForgeDbContext>();
            var doc = JsonSerializer.SerializeToElement(new { scenes = new[] { new { id = $"contender-{i}" } }, installedModules = new { } });
            return await RevisionCommitService.CommitAsync(db, projectId, null, initialRevisionId, null, false, doc, CancellationToken.None);
        });

        // Task.WhenAll rethrows if any contender's call threw — that
        // failure mode (an unhandled serialization-failure exception
        // instead of a Conflict result) is exactly what this test exists
        // to catch, so there is no per-task try/catch here.
        var results = await Task.WhenAll(tasks);

        Assert.Single(results, r => r.Kind == CommitResultKind.Committed);
        Assert.All(results.Where(r => r.Kind != CommitResultKind.Committed), r => Assert.Equal(CommitResultKind.Conflict, r.Kind));
    }
}
