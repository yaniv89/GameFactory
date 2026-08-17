using System.Security.Cryptography;
using System.Text.Json;
using Azure.Storage.Blobs;
using Forge.Domain.Entities;
using Forge.Functions.Build;
using Forge.Infrastructure.Persistence;
using Forge.Infrastructure.Storage;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace Forge.Tests.Features.Builds;

/// <summary>
/// The end-to-end proof for docs/adr/0010 Decision 4: seeds a real
/// <c>Queued</c> <see cref="Domain.Entities.Build"/> against a real
/// committed <see cref="ProjectRevision"/>, uploads the real result to
/// the real Azurite-backed <see cref="IBuildBundleStorage"/>, and drives
/// the whole claim -> build -> upload -> mark cycle through
/// <see cref="BuildOrchestrator"/> exactly as the eventual Azure
/// Functions Worker trigger will — the same relationship
/// <see cref="Features.Scan.ScanOrchestratorTests"/> has to gate 4's own
/// trigger. Every other test in this directory covers one piece in
/// isolation (<see cref="BuildRunnerTests"/> the subprocess,
/// <see cref="BuildsEndpointsTests"/> the API surface); this one proves
/// the pieces actually fit together.
///
/// ⚠ Not run in this sandbox: no .NET SDK here. Verified when CI runs on
/// a GitHub-hosted runner.
/// </summary>
public sealed class BuildOrchestratorTests : IClassFixture<ForgeWebApplicationFactory>
{
    private readonly ForgeWebApplicationFactory _factory;

    public BuildOrchestratorTests(ForgeWebApplicationFactory factory)
    {
        _factory = factory;
    }

    private static JsonElement ValidDocument() => JsonSerializer.SerializeToElement(new
    {
        scenes = new[]
        {
            new { id = "village", name = "Village", entities = Array.Empty<object>(), tiles = Enumerable.Repeat(0, 300).ToArray() },
        },
        installedModules = new { },
    });

    private static JsonElement InvalidDocument() =>
        JsonSerializer.SerializeToElement(new { scenes = Array.Empty<object>(), installedModules = new { } });

    private async Task<(ForgeDbContext Db, Guid ProjectId, long RevisionId)> SeedProjectWithCommittedRevisionAsync(ForgeDbContext db, JsonElement document)
    {
        var workspace = new Workspace { Slug = $"ws-{Guid.NewGuid():N}", Name = "Build Orchestrator Fixture", CreatedAt = DateTimeOffset.UtcNow };
        var project = new Project
        {
            WorkspaceId = workspace.Id,
            Workspace = workspace,
            Slug = $"proj-{Guid.NewGuid():N}",
            Title = "Buildable Project",
            EngineVersion = "0.1.0",
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow,
        };
        var docJson = JsonSerializer.Serialize(document);
        var revision = new ProjectRevision
        {
            ProjectId = project.Id,
            Project = project,
            Doc = document,
            DocHash = SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(docJson)),
            SizeBytes = System.Text.Encoding.UTF8.GetByteCount(docJson),
            CreatedAt = DateTimeOffset.UtcNow,
        };
        db.Workspaces.Add(workspace);
        db.Projects.Add(project);
        db.ProjectRevisions.Add(revision);
        await db.SaveChangesAsync();
        project.HeadRevision = revision.Id;
        await db.SaveChangesAsync();

        return (db, project.Id, revision.Id);
    }

    private async Task<Guid> SeedQueuedBuildAsync(ForgeDbContext db, Guid projectId, long revisionId)
    {
        var build = new Build { ProjectId = projectId, RevisionId = revisionId, Status = BuildStatus.Queued, CreatedAt = DateTimeOffset.UtcNow };
        db.Builds.Add(build);
        await db.SaveChangesAsync();
        return build.Id;
    }

    private IBuildBundleStorage CreateBundleStorage()
    {
        var container = new BlobContainerClient(_factory.AzuriteConnectionString, "builds");
        container.CreateIfNotExists();
        return new AzureBlobBuildBundleStorage(container);
    }

    private static BuildRunner CreateRunner(int timeoutSeconds = 60, string nodeExecutablePath = "node") => new(new BuildRunnerOptions
    {
        NodeExecutablePath = nodeExecutablePath,
        CliEntryPath = RepoPaths.Resolve("packages/cli/dist/index.js"),
        TimeoutSeconds = timeoutSeconds,
    });

    [Fact]
    public async Task A_Queued_Build_Of_A_Real_Revision_Ends_Up_Ready_With_A_Real_Uploaded_Bundle()
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ForgeDbContext>();
        var (_, projectId, revisionId) = await SeedProjectWithCommittedRevisionAsync(db, ValidDocument());
        var buildId = await SeedQueuedBuildAsync(db, projectId, revisionId);

        var bundleStorage = CreateBundleStorage();
        var orchestrator = new BuildOrchestrator(new BuildScanner(db), CreateRunner(), bundleStorage);

        var built = await orchestrator.BuildNextAsync(CancellationToken.None);
        Assert.True(built);

        using var verifyScope = _factory.Services.CreateScope();
        var verifyDb = verifyScope.ServiceProvider.GetRequiredService<ForgeDbContext>();
        var build = await verifyDb.Builds.SingleAsync(b => b.Id == buildId);

        Assert.Equal(BuildStatus.Ready, build.Status);
        Assert.Equal($"builds/{buildId}/index.html", build.BundleBlobPath);
        Assert.Equal(32, build.BundleSha256!.Length);
        Assert.True(build.SizeBytes > 0);
        Assert.NotNull(build.InlineScriptSha256Base64);
        Assert.NotNull(build.InlineStyleSha256Base64);
        Assert.NotNull(build.CompletedAt);
        Assert.Null(build.ErrorMessage);

        // The real round trip through blob storage, not just "the DB row
        // looks right" — a build the row claims is Ready but whose blob
        // never actually landed would be a real, user-visible failure
        // mode (Forge.Play, C4, would 404 forever) this test would catch.
        var downloadedHtml = await bundleStorage.DownloadIndexHtmlAsync(buildId, CancellationToken.None);
        Assert.Equal(SHA256.HashData(downloadedHtml), build.BundleSha256);

        var metadata = await bundleStorage.DownloadMetadataAsync(buildId, CancellationToken.None);
        Assert.Equal(build.InlineScriptSha256Base64, metadata.InlineScriptSha256Base64);
        Assert.Equal(build.InlineStyleSha256Base64, metadata.InlineStyleSha256Base64);
    }

    [Fact]
    public async Task Nothing_Queued_Returns_False_Rather_Than_Throwing()
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ForgeDbContext>();
        var orchestrator = new BuildOrchestrator(new BuildScanner(db), CreateRunner(), CreateBundleStorage());

        // Whatever other tests in this class have already queued and
        // consumed, draining to empty first makes this assertion
        // meaningful regardless of run order/parallelism within the
        // shared Postgres container other tests in this project also use.
        while (await orchestrator.BuildNextAsync(CancellationToken.None))
        {
        }

        Assert.False(await orchestrator.BuildNextAsync(CancellationToken.None));
    }

    [Fact]
    public async Task An_Invalid_Document_Ends_Up_Failed_With_A_Real_Attributable_Error_Not_A_Harness_Retry()
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ForgeDbContext>();
        var (_, projectId, revisionId) = await SeedProjectWithCommittedRevisionAsync(db, InvalidDocument());
        var buildId = await SeedQueuedBuildAsync(db, projectId, revisionId);

        var orchestrator = new BuildOrchestrator(new BuildScanner(db), CreateRunner(), CreateBundleStorage());

        var built = await orchestrator.BuildNextAsync(CancellationToken.None);
        Assert.True(built); // The orchestrator did work this tick — a Failed verdict is real progress, not "nothing to do."

        using var verifyScope = _factory.Services.CreateScope();
        var verifyDb = verifyScope.ServiceProvider.GetRequiredService<ForgeDbContext>();
        var build = await verifyDb.Builds.SingleAsync(b => b.Id == buildId);

        Assert.Equal(BuildStatus.Failed, build.Status);
        Assert.Contains("scene", build.ErrorMessage, StringComparison.OrdinalIgnoreCase);
        Assert.Null(build.BundleBlobPath);
        Assert.NotNull(build.CompletedAt);
    }

    [Fact]
    public async Task A_Harness_Failure_Requeues_The_Build_Rather_Than_Marking_It_Failed()
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ForgeDbContext>();
        var (_, projectId, revisionId) = await SeedProjectWithCommittedRevisionAsync(db, ValidDocument());
        var buildId = await SeedQueuedBuildAsync(db, projectId, revisionId);

        // A broken Node executable is a harness failure regardless of the
        // (perfectly valid) document — same distinction BuildRunnerTests
        // proves for BuildRunner directly, exercised here through the
        // full orchestrator so the requeue side effect gets proven too.
        var brokenRunner = CreateRunner(nodeExecutablePath: "definitely-not-a-real-node-binary-xyz");
        var orchestrator = new BuildOrchestrator(new BuildScanner(db), brokenRunner, CreateBundleStorage());

        await Assert.ThrowsAsync<BuildHarnessException>(() => orchestrator.BuildNextAsync(CancellationToken.None));

        using var verifyScope = _factory.Services.CreateScope();
        var verifyDb = verifyScope.ServiceProvider.GetRequiredService<ForgeDbContext>();
        var build = await verifyDb.Builds.SingleAsync(b => b.Id == buildId);

        // Back to Queued, not stuck Building and not falsely Failed — a
        // later tick (this worker instance or another) gets to retry it.
        Assert.Equal(BuildStatus.Queued, build.Status);
        Assert.Null(build.ErrorMessage);
        Assert.Null(build.CompletedAt);
    }
}
