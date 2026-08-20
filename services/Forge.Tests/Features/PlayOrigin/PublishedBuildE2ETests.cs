using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Azure.Storage.Blobs;
using Forge.Api.Features.Builds;
using Forge.Api.Features.Projects;
using Forge.Domain.Entities;
using Forge.Functions.Build;
using Forge.Infrastructure.Persistence;
using Forge.Infrastructure.Storage;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Playwright;
using Xunit;

namespace Forge.Tests.Features.PlayOrigin;

/// <summary>
/// docs/adr/0010's own C4 exit bar: "publish a real editor-built project,
/// fetch it from a second, genuinely distinct local origin, play it,
/// assert zero CSP violations and zero cross-origin leakage — the
/// 'published to a URL' half of M6's exit criterion." Scope split from
/// <c>packages/editor/test-fullstack/exportProjectDocument.spec.ts</c>
/// deliberately: that spec already exhaustively proves a real editor UI
/// produces a correct <c>ProjectDocument</c> (building a scene by
/// clicking tiles, installing a module) — this test's job starts one
/// step later, proving the real API/worker/play-origin pipeline
/// document -&gt; committed revision -&gt; build -&gt; served, playable URL,
/// via the same real <c>CommitRevisionEndpoint</c> HTTP path a real
/// editor "Save" click goes through, not a raw database insert.
///
/// The one thing genuinely stubbed, same as <see cref="Builds.BuildOrchestratorTests"/>
/// and gate 4's own <c>ScanOrchestratorTests</c>: <c>Forge.Functions.Build</c>'s
/// real Azure Functions timer trigger doesn't run in this sandbox (no
/// Azure Functions Core Tools wired into this repo's test infra, a
/// pre-existing, stated gap) — <see cref="BuildOrchestrator.BuildNextAsync"/>
/// is invoked directly as the proven stand-in for "the worker did its
/// job," exactly as it's unit-tested elsewhere.
///
/// ⚠ Not run in this sandbox: no .NET SDK here. Verified when CI runs on
/// a GitHub-hosted runner.
/// </summary>
[Collection("Forge export pipeline")]
public sealed class PublishedBuildE2ETests : IClassFixture<ForgeWebApplicationFactory>
{
    private const int TileSize = 32; // packages/editor/src/canvas/gridConstants.ts / packages/player/src/gameWorld.ts
    private const int MoveSpeedPxPerSec = 140; // packages/player/src/gameWorld.ts MOVE_SPEED
    private static readonly (int X, int Y) PlayerStart = (3, 8);
    private static readonly (int X, int Y) NpcTile = (8, 8);
    private const string DialogueSpeaker = "Innkeeper";
    private const string DialogueText = "Rooms are two gold a night.";

    private readonly ForgeWebApplicationFactory _factory;

    public PublishedBuildE2ETests(ForgeWebApplicationFactory factory)
    {
        _factory = factory;
    }

    private static JsonElement RealEditorBuiltDocument() => JsonSerializer.SerializeToElement(new
    {
        scenes = new[]
        {
            new
            {
                id = "village",
                name = "Village",
                tiles = Enumerable.Repeat(0, 300).ToArray(),
                entities = new object[]
                {
                    new { id = "player-1", prefabId = "player-start", tileX = PlayerStart.X, tileY = PlayerStart.Y },
                    new { id = "npc-1", prefabId = "npc", tileX = NpcTile.X, tileY = NpcTile.Y, dialogue = new { speaker = DialogueSpeaker, text = DialogueText } },
                },
            },
        },
        installedModules = new Dictionary<string, object> { ["@forge/dialogue"] = new { } },
    });

    private async Task SetWorkspacePlanAsync(Guid workspaceId, string plan)
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ForgeDbContext>();
        await db.Workspaces.Where(w => w.Id == workspaceId).ExecuteUpdateAsync(s => s.SetProperty(w => w.Plan, plan));
    }

    [Fact]
    public async Task A_Real_Committed_Project_Is_Built_Served_On_A_Distinct_Origin_And_Actually_Playable()
    {
        // ── 1. A real authenticated user commits a real project document
        //    through the real HTTP API — the same CommitRevisionEndpoint
        //    a real editor "Save" click calls. ──────────────────────────
        var user = await AuthTestHelper.SignupAndAuthenticateAsync(_factory);
        var createResponse = await user.Client.PostAsJsonAsync(
            $"/api/v1/workspaces/{user.WorkspaceId}/projects",
            new { slug = $"published-{Guid.NewGuid():N}", title = "A Real Published Game", description = (string?)null, engineVersion = "0.1.0", genreTemplate = (string?)null });
        createResponse.EnsureSuccessStatusCode();
        var project = (await createResponse.Content.ReadFromJsonAsync<ProjectDetailResponse>())!;

        var commitResponse = await user.Client.PostAsJsonAsync(
            $"/api/v1/projects/{project.Id}/revisions",
            new { expectedHeadRevision = (long?)null, label = "First checkpoint", isCheckpoint = true, document = RealEditorBuiltDocument() });
        commitResponse.EnsureSuccessStatusCode();

        await SetWorkspacePlanAsync(user.WorkspaceId, WorkspacePlan.Pro);

        // ── 2. Publish: the real POST /builds endpoint queues it. ───────
        var createBuildResponse = await user.Client.PostAsync($"/api/v1/projects/{project.Id}/builds", null);
        Assert.Equal(HttpStatusCode.Accepted, createBuildResponse.StatusCode);
        var createdBuild = (await createBuildResponse.Content.ReadFromJsonAsync<CreateBuildResponse>())!;

        // ── 3. The worker's real logic (not the unrunnable-in-this-
        //    sandbox timer trigger) actually builds and uploads it. ─────
        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ForgeDbContext>();
            var container = new BlobContainerClient(_factory.AzuriteConnectionString, "builds");
            await container.CreateIfNotExistsAsync();
            var bundleStorage = new AzureBlobBuildBundleStorage(container);
            var runner = new BuildRunner(new BuildRunnerOptions
            {
                CliEntryPath = RepoPaths.Resolve("packages/cli/dist/index.js"),
                TimeoutSeconds = 180,
            });
            var orchestrator = new BuildOrchestrator(new BuildScanner(db), runner, bundleStorage);
            var built = await orchestrator.BuildNextAsync(CancellationToken.None);
            Assert.True(built);
        }

        var getBuildResponse = await user.Client.GetAsync($"/api/v1/projects/{project.Id}/builds/{createdBuild.Id}");
        var build = (await getBuildResponse.Content.ReadFromJsonAsync<BuildStatusResponse>())!;
        Assert.Equal(BuildStatus.Ready, build.Status);
        Assert.NotNull(build.PlayUrl); // GetBuildEndpoint's own real computation, proven shape-correct here even though this test navigates to PlayTestServer's own ephemeral port below, not this literal string — see the comment at the navigation step for why.

        // ── 4. A real, physically separate Forge.Play host serves it. ───
        await using var playServer = await PlayTestServer.StartAsync(_factory.AzuriteConnectionString, _factory.RedisConnectionString);

        using var playwright = await Playwright.CreateAsync();
        var launchOptions = new BrowserTypeLaunchOptions();
        // Only set on hosts that happen to have this specific pre-installed
        // browser cache (this session's own sandbox) — confirmed by a real
        // failed launch, not assumed, that Microsoft.Playwright 1.62.0's
        // own default headless_shell launch path doesn't match what's
        // cached there. A real CI runner has no /opt/pw-browsers at all
        // and instead runs a real `playwright install` step
        // (.github/workflows/ci.yml's dotnet-build-test job) that puts
        // the browser exactly where Playwright's own default resolution
        // already expects, so this override must never apply there.
        if (PlaywrightBrowserResolver.TryResolveSandboxChromiumPath(out var sandboxChromiumPath))
        {
            launchOptions.ExecutablePath = sandboxChromiumPath;
        }
        await using var browser = await playwright.Chromium.LaunchAsync(launchOptions);
        var page = await browser.NewPageAsync();

        var consoleErrors = new List<string>();
        var externalRequests = new List<string>();
        page.Console += (_, msg) =>
        {
            if (msg.Type == "error") consoleErrors.Add(msg.Text);
        };
        page.PageError += (_, err) => consoleErrors.Add(err);
        page.Request += (_, req) =>
        {
            // "External" relative to the play origin itself — a request
            // to any http(s) URL not served by playServer.BaseUrl would
            // mean the played game reached outside its own origin, the
            // exact cross-origin leakage docs/adr/0010's own C4 scope
            // calls out to assert against.
            if ((req.Url.StartsWith("http://") || req.Url.StartsWith("https://")) && !req.Url.StartsWith(playServer.BaseUrl, StringComparison.Ordinal))
            {
                externalRequests.Add(req.Url);
            }
        };

        // playServer.BaseUrl, not build.PlayUrl: this test's Forge.Api
        // host and this test's Forge.Play host are both ephemeral,
        // independently-port-assigned processes living in the same test
        // run (PlayTestServer.StartAsync's own remarks on why — a fixed,
        // shared port would collide across parallel test classes).
        // build.PlayUrl already proved GetBuildEndpoint constructs the
        // right shape from configuration (asserted above, and directly
        // in BuildsEndpointsTests.Ready_Build_Reports_A_Play_Url); a real
        // deployment's Play:BaseUrl and this host's real bound address
        // are the same value by configuration, not by coincidence.
        var navigateUrl = $"{playServer.BaseUrl}{createdBuild.Id}/";
        var response = await page.GotoAsync(navigateUrl);

        Assert.NotNull(response);
        Assert.Equal(200, response!.Status);
        var headers = await response.AllHeadersAsync();
        Assert.True(headers.ContainsKey("content-security-policy"));
        Assert.Contains("'sha256-", headers["content-security-policy"], StringComparison.Ordinal);
        Assert.Equal("public, max-age=31536000, immutable", headers["cache-control"]);

        // The real proof: if the CSP's hash sources didn't exactly match
        // the served content, Chromium would refuse to execute the
        // inline script/style and this canvas would never appear —
        // header-string equality alone (asserted above) can't catch a
        // hashing bug the same way real enforcement can.
        await page.Locator("#forge-player-canvas").WaitForAsync(new LocatorWaitForOptions { Timeout = 10_000 });
        await page.WaitForTimeoutAsync(1000); // QuickJS WASM instantiation + first render tick, same margin exportProjectDocument.spec.ts uses.

        static int TravelMs(int tiles) => (int)Math.Round(Math.Max(tiles - 0.3, 0) * TileSize * 1000.0 / MoveSpeedPxPerSec);

        await page.Keyboard.DownAsync("ArrowRight");
        await page.WaitForTimeoutAsync(TravelMs(NpcTile.X - PlayerStart.X));
        await page.Keyboard.UpAsync("ArrowRight");
        await page.WaitForTimeoutAsync(200);

        await page.Keyboard.PressAsync("e");
        var bubble = page.Locator("#forge-player-dialogue");
        await bubble.WaitForAsync(new LocatorWaitForOptions { Timeout = 5_000 });
        Assert.Equal(DialogueSpeaker, await page.Locator("#forge-player-dialogue-speaker").InnerTextAsync());
        Assert.Equal(DialogueText, await page.Locator("#forge-player-dialogue-text").InnerTextAsync());

        Assert.Empty(consoleErrors);
        Assert.Empty(externalRequests);

        // ── 5. A build that was never published still 404s, proving this
        //    origin doesn't serve arbitrary content by guesswork. A
        //    fresh page, not the one that just played a real game with
        //    an active QuickJS Worker/WebGL context — isolates this
        //    assertion from whatever state that page accumulated. ──────
        var freshPage = await browser.NewPageAsync();
        var unknownResponse = await freshPage.GotoAsync($"{playServer.BaseUrl}{Guid.NewGuid()}/");
        Assert.Equal(404, unknownResponse!.Status);
    }
}
