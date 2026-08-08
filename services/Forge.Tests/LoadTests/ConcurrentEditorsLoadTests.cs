using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Forge.Api.Features.Projects;
using Forge.Domain.Entities;
using Forge.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using Xunit;

namespace Forge.Tests.LoadTests;

/// <summary>
/// docs/SPEC.md Section 18.4's two "concurrent editors" rows, CLAUDE.md
/// Section 8's M5 exit criterion ("load test sustains 200 concurrent
/// editors with zero lost writes"):
///
/// | Metric | Target | Hard fail |
/// |---|---|---|
/// | Concurrent collaborative editors, one project, one hub instance | 20 | 8 |
/// | Concurrent editors platform-wide, zero lost writes | 200 | 100 |
///
/// The "one hub instance" framing is real-time SignalR/Yjs collaboration,
/// which is M7 scope and doesn't exist yet. This suite proves the same
/// underlying property — many simultaneous editors, zero silently lost
/// work — at the layer that exists today: the HTTP commit-revision API
/// under Postgres Serializable isolation (<see cref="RevisionCommitService"/>).
/// A well-behaved client retrying on 409/429 is exactly what
/// docs/SPEC.md Section 13.3 already specifies for that API, so this is
/// the honest M5-era proxy for the SPEC row, not a substitute for the
/// real M7 collaboration load test that row will eventually need.
///
/// ⚠ What this proves vs. what it doesn't: this runs against a single
/// GitHub Actions runner's Testcontainers Postgres/Redis, all in one
/// process with in-memory HTTP transport (no real network, no separate
/// API replicas). It is real evidence of correctness under genuine
/// concurrent load — no lost writes, no unhandled 500s — and it is where
/// the DB-connection-count row of the same table gets its first actual
/// measured number instead of a placeholder. It is not a substitute for
/// a production-representative load test against deployed infrastructure
/// (same class of gap CLAUDE.md's M1 exit criterion already documents
/// for the reference-device benchmark — see docs/proposals/0001 Section
/// 6.2 for that precedent).
///
/// ⚠ Not run in this sandbox: no .NET SDK here. Verified when CI runs on
/// a GitHub-hosted runner, in its own job (see .github/workflows/ci.yml)
/// so a slow load-test run never blocks the fast unit-test feedback loop.
/// </summary>
[Trait("Category", "Load")]
public sealed class ConcurrentEditorsLoadTests : IClassFixture<ForgeWebApplicationFactory>
{
    private readonly ForgeWebApplicationFactory _factory;

    public ConcurrentEditorsLoadTests(ForgeWebApplicationFactory factory)
    {
        _factory = factory;
    }

    [Fact]
    public async Task Twenty_Concurrent_Editors_On_One_Project_Lose_No_Writes()
    {
        const int editorCount = 20;
        const int maxAttemptsPerEditor = 40;

        var owner = await AuthTestHelper.SignupAndAuthenticateAsync(_factory);
        var createResponse = await owner.Client.PostAsJsonAsync(
            $"/api/v1/workspaces/{owner.WorkspaceId}/projects",
            new { slug = "contention-fixture", title = "Contention Fixture", description = (string?)null, engineVersion = "0.1.0", genreTemplate = (string?)null });
        createResponse.EnsureSuccessStatusCode();
        var project = (await createResponse.Content.ReadFromJsonAsync<ProjectDetailResponse>())!;

        var initialDoc = JsonSerializer.SerializeToElement(new { scenes = Array.Empty<object>(), installedModules = new { } });
        var initialCommit = await owner.Client.PostAsJsonAsync(
            $"/api/v1/projects/{project.Id}/revisions",
            new { expectedHeadRevision = (long?)null, label = (string?)null, isCheckpoint = false, document = initialDoc });
        initialCommit.EnsureSuccessStatusCode();

        var editors = new List<AuthenticatedTestUser> { owner };
        for (var i = 1; i < editorCount; i++)
        {
            editors.Add(await AuthTestHelper.SignupAndAuthenticateAsync(_factory));
        }

        // The owner is already a member (SignupEndpoint seeds that row).
        // The other 19 need one too — there is no invite/add-member
        // endpoint yet (out of M5 scope), so this reaches into the
        // database directly, the same shortcut StripeWebhookEndpointTests
        // and BillingEndpointsTests already take for setup state no HTTP
        // endpoint exists to produce yet.
        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ForgeDbContext>();
            foreach (var editor in editors.Skip(1))
            {
                db.WorkspaceMembers.Add(new WorkspaceMember
                {
                    WorkspaceId = owner.WorkspaceId,
                    UserId = editor.UserId,
                    Role = WorkspaceRole.Editor,
                    JoinedAt = DateTimeOffset.UtcNow,
                });
            }
            await db.SaveChangesAsync();
        }

        var edits = await Task.WhenAll(editors.Select((editor, index) =>
            CommitOwnMarkerWithRetryAsync(editor.Client, project.Id, $"editor-{index}-marker", maxAttemptsPerEditor)));

        for (var i = 0; i < edits.Length; i++)
        {
            Assert.True(edits[i], $"editor-{i}-marker never landed within {maxAttemptsPerEditor} retries — a write was lost or starved.");
        }

        var finalDocResponse = await owner.Client.GetAsync($"/api/v1/projects/{project.Id}/document");
        finalDocResponse.EnsureSuccessStatusCode();
        var finalDoc = await finalDocResponse.Content.ReadFromJsonAsync<ProjectDocumentResponse>();
        var sceneIds = finalDoc!.Document.GetProperty("scenes").EnumerateArray()
            .Select(s => s.GetProperty("id").GetString())
            .ToList();

        for (var i = 0; i < editorCount; i++)
        {
            Assert.Contains($"editor-{i}-marker", sceneIds);
        }
        Assert.Equal(editorCount, sceneIds.Distinct().Count());
    }

    /// <summary>
    /// A read-modify-write retry loop: read the current document, append
    /// this editor's own marker to it, commit with the head revision it
    /// just read as <c>expectedHeadRevision</c>. On 409 (someone else won
    /// the race) or 429 (this editor's own budget), re-read the now-current
    /// head and try again — the same behavior docs/SPEC.md Section 13.3
    /// asks a real client to implement. Any other status is a genuine
    /// failure, not a condition to retry past.
    /// </summary>
    private static async Task<bool> CommitOwnMarkerWithRetryAsync(HttpClient client, Guid projectId, string marker, int maxAttempts)
    {
        for (var attempt = 0; attempt < maxAttempts; attempt++)
        {
            var docResponse = await client.GetAsync($"/api/v1/projects/{projectId}/document");
            docResponse.EnsureSuccessStatusCode();
            var doc = (await docResponse.Content.ReadFromJsonAsync<ProjectDocumentResponse>())!;

            var sceneIds = doc.Document.GetProperty("scenes").EnumerateArray()
                .Select(s => s.GetProperty("id").GetString())
                .Append(marker);
            var newDoc = JsonSerializer.SerializeToElement(new
            {
                scenes = sceneIds.Select(id => new { id }).ToArray(),
                installedModules = new { },
            });

            var commitResponse = await client.PostAsJsonAsync(
                $"/api/v1/projects/{projectId}/revisions",
                new { expectedHeadRevision = doc.RevisionId, label = (string?)null, isCheckpoint = false, document = newDoc });

            if (commitResponse.StatusCode is HttpStatusCode.Created or HttpStatusCode.OK)
            {
                return true;
            }

            if (commitResponse.StatusCode == HttpStatusCode.Conflict)
            {
                await Task.Delay(Random.Shared.Next(5, 25));
                continue;
            }

            if (commitResponse.StatusCode == HttpStatusCode.TooManyRequests)
            {
                var retryAfterSeconds = commitResponse.Headers.RetryAfter?.Delta?.TotalSeconds ?? 1;
                await Task.Delay(TimeSpan.FromSeconds(retryAfterSeconds));
                continue;
            }

            var body = await commitResponse.Content.ReadAsStringAsync();
            throw new InvalidOperationException($"Unexpected status {(int)commitResponse.StatusCode} committing '{marker}': {body}");
        }

        return false;
    }

    [Fact]
    public async Task Two_Hundred_Concurrent_Editors_Platform_Wide_Complete_With_Zero_Lost_Writes()
    {
        var editorCount = int.TryParse(Environment.GetEnvironmentVariable("LOAD_TEST_EDITOR_COUNT"), out var configured)
            ? configured
            : 200;

        string connectionString;
        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ForgeDbContext>();
            connectionString = db.Database.GetConnectionString()!;
        }

        using var monitorCts = new CancellationTokenSource();
        var monitorTask = MonitorPeakConnectionsAsync(connectionString, monitorCts.Token);

        var results = await Task.WhenAll(Enumerable.Range(0, editorCount).Select(RunOneEditorAsync));

        monitorCts.Cancel();
        var peakConnections = await monitorTask;

        var failures = results
            .Select((r, i) => (Index: i, r.Success, r.FailureDetail))
            .Where(r => !r.Success)
            .ToList();
        if (failures.Count > 0)
        {
            var sample = string.Join("\n", failures.Take(5).Select(f => $"  editor {f.Index}: {f.FailureDetail}"));
            Assert.Fail($"{failures.Count} of {editorCount} editors did not complete cleanly. First {Math.Min(5, failures.Count)}:\n{sample}");
        }

        // The first real measurement for docs/SPEC.md Section 18.4's "DB
        // connections per API instance (pooled)" row (target <=20, hard
        // fail 40) — no pool-size cap is configured in AddForgeInfrastructure
        // yet (see its own doc comment), so this is Npgsql's default
        // pool ceiling (100), not a tuned production number. Asserting
        // it stays at or under that default catches a connection leak;
        // it does not by itself validate the <=20 target, which needs a
        // deliberately pool-capped run to check for real.
        Assert.True(peakConnections <= 100, $"Peak concurrent Postgres connections was {peakConnections}, above Npgsql's default pool ceiling of 100 — likely a connection leak, not just contention.");

        async Task<(bool Success, string? FailureDetail)> RunOneEditorAsync(int index)
        {
            try
            {
                var editor = await AuthTestHelper.SignupAndAuthenticateAsync(_factory);

                var createResponse = await editor.Client.PostAsJsonAsync(
                    $"/api/v1/workspaces/{editor.WorkspaceId}/projects",
                    new { slug = $"editor-{index}-project", title = $"Editor {index} Project", description = (string?)null, engineVersion = "0.1.0", genreTemplate = (string?)null });
                if (createResponse.StatusCode != HttpStatusCode.Created)
                {
                    return (false, $"CreateProject: {(int)createResponse.StatusCode} {await createResponse.Content.ReadAsStringAsync()}");
                }
                var project = (await createResponse.Content.ReadFromJsonAsync<ProjectDetailResponse>())!;

                // Retried, not a single shot: even though every editor here
                // owns a logically distinct project, 200 fully concurrent
                // Serializable transactions hitting the same two tables
                // (projects, project_revisions) can still produce a real
                // 40001 between transactions that share no actual row —
                // Postgres's Serializable Snapshot Isolation tracks
                // dependencies through shared index structures, not with
                // perfect per-row precision, and a real CI run at this
                // concurrency proved it happens in practice. Retrying on
                // 409 is exactly the client contract docs/SPEC.md Section
                // 13.3 already specifies; a first commit against a still-
                // untouched project has nothing to rebase, so this just
                // resends the identical request rather than re-deriving
                // expectedHeadRevision the way CommitOwnMarkerWithRetryAsync
                // does for genuine content contention.
                var doc = JsonSerializer.SerializeToElement(new { scenes = new[] { new { id = $"editor-{index}-scene" } }, installedModules = new { } });
                const int maxCommitAttempts = 30;
                HttpResponseMessage commitResponse;
                var commitAttempts = 0;
                while (true)
                {
                    commitAttempts++;
                    commitResponse = await editor.Client.PostAsJsonAsync(
                        $"/api/v1/projects/{project.Id}/revisions",
                        new { expectedHeadRevision = (long?)null, label = (string?)null, isCheckpoint = false, document = doc });
                    if (commitResponse.StatusCode == HttpStatusCode.Created) break;
                    if (commitResponse.StatusCode == HttpStatusCode.Conflict && commitAttempts < maxCommitAttempts)
                    {
                        // Exponential backoff, not a fixed tiny window: a
                        // real CI run at 200-way concurrency on a small,
                        // shared runner exhausted 10 fixed-5-25ms-jitter
                        // attempts outright, meaning contention on the
                        // shared table/index structures behind every
                        // editor's insert lasted longer than that gave it
                        // room to clear. Capped at 500ms so the worst case
                        // across 30 attempts stays well inside the job's
                        // own timeout, not because 500ms is a meaningful
                        // production number.
                        var capMs = Math.Min(500, 10 * (1 << Math.Min(commitAttempts, 6)));
                        await Task.Delay(Random.Shared.Next(capMs / 2, capMs));
                        continue;
                    }
                    return (false, $"CommitRevision after {commitAttempts} attempt(s): {(int)commitResponse.StatusCode} {await commitResponse.Content.ReadAsStringAsync()}");
                }

                // Prove it is durably readable back, not just accepted.
                var getResponse = await editor.Client.GetAsync($"/api/v1/projects/{project.Id}/document");
                if (getResponse.StatusCode != HttpStatusCode.OK)
                {
                    return (false, $"GetDocument: {(int)getResponse.StatusCode}");
                }
                var readBack = await getResponse.Content.ReadFromJsonAsync<ProjectDocumentResponse>();
                var sceneId = readBack!.Document.GetProperty("scenes").EnumerateArray().Single().GetProperty("id").GetString();
                if (sceneId != $"editor-{index}-scene")
                {
                    return (false, $"Read-back mismatch: got '{sceneId}'");
                }

                return (true, null);
            }
            catch (Exception ex)
            {
                return (false, ex.ToString());
            }
        }
    }

    private static async Task<int> MonitorPeakConnectionsAsync(string connectionString, CancellationToken ct)
    {
        var peak = 0;
        await using var monitorConnection = new NpgsqlConnection(connectionString);
        await monitorConnection.OpenAsync(ct);

        while (!ct.IsCancellationRequested)
        {
            try
            {
                await using var cmd = monitorConnection.CreateCommand();
                cmd.CommandText = "SELECT count(*) FROM pg_stat_activity WHERE datname = current_database()";
                var count = (long)(await cmd.ExecuteScalarAsync(ct))!;
                if (count > peak) peak = (int)count;
                await Task.Delay(100, ct);
            }
            catch (OperationCanceledException)
            {
                break;
            }
        }

        return peak;
    }
}
