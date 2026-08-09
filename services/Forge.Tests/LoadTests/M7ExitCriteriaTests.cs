using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Forge.Api.Features.Marketplace;
using Forge.Api.Features.Projects;
using Forge.Api.Features.Registry.Publishing;
using Forge.Domain.Entities;
using Forge.Functions.Scan;
using Forge.Functions.Scan.SmokeGate;
using Forge.Infrastructure.Identity;
using Forge.Infrastructure.Persistence;
using Forge.Infrastructure.Storage;
using Microsoft.AspNetCore.Http.Connections;
using Microsoft.AspNetCore.SignalR.Client;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace Forge.Tests.LoadTests;

/// <summary>
/// CLAUDE.md Section 8's M7 exit criterion, in two halves: "two people
/// co-edit the same tilemap layer for 30 minutes with no lost work" and
/// "a paid module is published, bought, installed, and paid out."
///
/// The collaboration half is Category=Load (this class's own remarks on
/// <see cref="Two_Editors_Exchange_A_Sustained_Run_Of_Updates_With_Zero_Lost_Messages"/>
/// explain why, and why 30 real minutes isn't what actually runs). The
/// marketplace half isn't — it's a deep real-service integration test,
/// not a high-volume one, the same category
/// <c>Forge.Tests.Features.Scan.ScanOrchestratorTests</c> already runs
/// in the fast job.
///
/// ⚠ Not run in this sandbox: no .NET SDK here. Verified when CI runs on
/// a GitHub-hosted runner.
/// </summary>
public sealed class M7ExitCriteriaTests : IClassFixture<ForgeWebApplicationFactory>
{
    private readonly ForgeWebApplicationFactory _factory;

    public M7ExitCriteriaTests(ForgeWebApplicationFactory factory)
    {
        _factory = factory;
    }

    private async Task<ProjectDetailResponse> CreateProjectAsync(AuthenticatedTestUser owner, Guid workspaceId)
    {
        var response = await owner.Client.PostAsJsonAsync(
            $"/api/v1/workspaces/{workspaceId}/projects",
            new { slug = $"exit-{Guid.NewGuid():N}", title = "Exit Criteria Fixture", description = (string?)null, engineVersion = "1.0.0", genreTemplate = (string?)null });
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

    /// <summary>
    /// A real 30-minute CI job is impractical (every PR would wait half
    /// an hour on this one gate) and wouldn't actually prove anything a
    /// shorter sustained run doesn't — SignalR's relay logic
    /// (<c>CollabHub.PublishUpdate</c>) doesn't behave differently at
    /// minute 3 versus minute 30, and this session's own M1 exit
    /// criterion already sets the precedent for documenting a real,
    /// present gap between "what CI verifies" and "the literal number in
    /// the spec" rather than silently claiming full compliance
    /// (docs/proposals/0001 Section 6.2). What this proves instead: a
    /// sustained, two-way, many-message exchange over one long-lived
    /// connection pair delivers every single message with nothing
    /// silently dropped, and both connections are still alive and
    /// healthy at the end — the actual failure mode "lost work" would
    /// look like at the transport layer. The CRDT merge correctness half
    /// of "no lost work" (concurrent edits to the same tile converging
    /// losslessly) is already proven separately and for real by
    /// packages/editor/src/collab/collabDoc.test.ts's Vitest suite
    /// (M7 Phase 2) against a real Y.Doc, which this class has no way to
    /// construct from .NET.
    /// </summary>
    [Trait("Category", "Load")]
    [Fact]
    public async Task Two_Editors_Exchange_A_Sustained_Run_Of_Updates_With_Zero_Lost_Messages()
    {
        const int updatesPerEditor = 200;

        var owner = await AuthTestHelper.SignupAndAuthenticateAsync(_factory);
        var editor = await AuthTestHelper.SignupAndAuthenticateAsync(_factory);
        var project = await CreateProjectAsync(owner, owner.WorkspaceId);
        await AddWorkspaceMemberAsync(owner.WorkspaceId, editor.UserId, WorkspaceRole.Editor);

        await using var ownerConnection = BuildConnection(owner, project.Id);
        await using var editorConnection = BuildConnection(editor, project.Id);

        var ownerReceived = new List<int>();
        var editorReceived = new List<int>();
        var ownerReceivedAll = new TaskCompletionSource();
        var editorReceivedAll = new TaskCompletionSource();

        ownerConnection.On<byte[]>("yjs:update", bytes =>
        {
            lock (ownerReceived)
            {
                ownerReceived.Add(BitConverter.ToInt32(bytes));
                if (ownerReceived.Count == updatesPerEditor) ownerReceivedAll.TrySetResult();
            }
        });
        editorConnection.On<byte[]>("yjs:update", bytes =>
        {
            lock (editorReceived)
            {
                editorReceived.Add(BitConverter.ToInt32(bytes));
                if (editorReceived.Count == updatesPerEditor) editorReceivedAll.TrySetResult();
            }
        });

        await ownerConnection.StartAsync();
        await editorConnection.StartAsync();

        // Both sides publish concurrently and continuously — the same
        // shape as two people simultaneously painting the same tilemap
        // layer, compressed from a real 30-minute session into as many
        // round trips as fit in this job's own time budget (see this
        // test's own remarks above).
        var ownerSend = Task.Run(async () =>
        {
            for (var i = 0; i < updatesPerEditor; i++)
            {
                await ownerConnection.InvokeAsync("PublishUpdate", BitConverter.GetBytes(i));
            }
        });
        var editorSend = Task.Run(async () =>
        {
            for (var i = 0; i < updatesPerEditor; i++)
            {
                await editorConnection.InvokeAsync("PublishUpdate", BitConverter.GetBytes(i));
            }
        });

        await Task.WhenAll(ownerSend, editorSend);
        await ownerReceivedAll.Task.WaitAsync(TimeSpan.FromMinutes(2));
        await editorReceivedAll.Task.WaitAsync(TimeSpan.FromMinutes(2));

        Assert.Equal(updatesPerEditor, ownerReceived.Count);
        Assert.Equal(updatesPerEditor, editorReceived.Count);
        Assert.Equal(Enumerable.Range(0, updatesPerEditor), ownerReceived.OrderBy(x => x));
        Assert.Equal(Enumerable.Range(0, updatesPerEditor), editorReceived.OrderBy(x => x));

        // Both connections must still be alive after the whole exchange
        // — a dropped/reconnected connection partway through a real
        // 30-minute session is exactly the "lost work" scenario this
        // proves against.
        Assert.Equal(HubConnectionState.Connected, ownerConnection.State);
        Assert.Equal(HubConnectionState.Connected, editorConnection.State);
    }

    private static string BundleBase64(string source = "(function () { __forge_registerModule({ setup: function () {} }); })();") =>
        Convert.ToBase64String(Encoding.UTF8.GetBytes(source));

    private static object PublishRequest(string name, string version) => new
    {
        kind = "module",
        displayName = "Exit Criteria Module",
        summary = "A real, benign module published for the M7 exit-criteria proof.",
        readmeMarkdown = (string?)null,
        homepageUrl = (string?)null,
        licenseSpdx = "MIT",
        version,
        engineRange = ">=1.0.0 <2.0.0",
        manifest = new { name, version, kind = "module", engine = ">=1.0.0 <2.0.0", displayName = "Exit Criteria Module", summary = "Fixture.", license = "MIT" },
        bundleBase64 = BundleBase64(),
        dependencies = (Dictionary<string, string>?)null,
    };

    private ScanOrchestrator BuildOrchestrator(ForgeDbContext db, IPackageBundleStorage bundleStorage) =>
        new(new PendingVersionScanner(db), bundleStorage, new SmokeRunGate(new SmokeGateOptions
        {
            CliBundlePath = RepoPaths.Resolve("packages/runtime-host/dist/smoke/cli.bundle.mjs"),
        }));

    private async Task<bool> IsResolvedAsync(Guid versionId)
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ForgeDbContext>();
        var status = await db.PackageVersions.Where(v => v.Id == versionId).Select(v => v.ScanStatus).SingleAsync();
        return status is PackageScanStatus.Passed or PackageScanStatus.Blocked or PackageScanStatus.Flagged;
    }

    /// <summary>Qualifies the given user for <see cref="Forge.Domain.Marketplace.AuthorTrustTier.Verified"/> so gate 5 auto-passes rather than routing to manual review — same tenure-since-first-published-version reasoning <c>ScanOrchestratorTests</c> already documents, just backdating a version this test itself just published through the real endpoint instead of directly inserting a fabricated one.</summary>
    private async Task QualifyAuthorAsVerifiedAsync(Guid domainUserId, Guid earlyVersionId)
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ForgeDbContext>();

        var user = await db.DomainUsers.SingleAsync(u => u.Id == domainUserId);
        user.IdentityVerifiedAt = DateTimeOffset.UtcNow.AddDays(-120);

        var identitySubjectId = Guid.Parse(user.IdentitySubjectId);
        var identityUser = await db.Users.SingleAsync(u => u.Id == identitySubjectId);
        identityUser.TwoFactorEnabled = true;

        await db.PackageVersions
            .Where(v => v.Id == earlyVersionId)
            .ExecuteUpdateAsync(s => s
                .SetProperty(v => v.ScanStatus, PackageScanStatus.Passed)
                .SetProperty(v => v.PublishedAt, DateTimeOffset.UtcNow.AddDays(-120)));

        await db.SaveChangesAsync();
    }

    private async Task<HttpResponseMessage> PostWebhookAsync(string payload)
    {
        const string webhookSecret = "local-dev-placeholder-not-a-real-stripe-webhook-secret";
        var client = _factory.CreateClient();
        var request = new HttpRequestMessage(HttpMethod.Post, "/api/v1/webhooks/stripe")
        {
            Content = new StringContent(payload, Encoding.UTF8, "application/json"),
        };
        var timestamp = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        var signedPayload = $"{timestamp}.{payload}";
        using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(webhookSecret));
        var signatureHex = Convert.ToHexString(hmac.ComputeHash(Encoding.UTF8.GetBytes(signedPayload))).ToLowerInvariant();
        request.Headers.Add("Stripe-Signature", $"t={timestamp},v1={signatureHex}");
        return await client.SendAsync(request);
    }

    private static string BuildCheckoutCompletedPayload(string paymentIntentId, Guid workspaceId, Guid packageId)
    {
        var envelope = new
        {
            id = $"evt_{Guid.NewGuid():N}",
            @object = "event",
            api_version = "2020-08-27",
            created = DateTimeOffset.UtcNow.ToUnixTimeSeconds(),
            type = "checkout.session.completed",
            data = new
            {
                @object = new
                {
                    id = $"cs_{Guid.NewGuid():N}",
                    @object = "checkout.session",
                    payment_intent = paymentIntentId,
                    metadata = new { workspaceId = workspaceId.ToString(), packageId = packageId.ToString() },
                },
            },
        };
        return JsonSerializer.Serialize(envelope);
    }

    [Fact]
    public async Task A_Paid_Module_Is_Published_Bought_Installed_And_Paid_Out()
    {
        var name = $"@exit-criteria/module-{Guid.NewGuid():N}";
        var author = await AuthTestHelper.SignupAndAuthenticateAsync(_factory);

        // ── Published ──────────────────────────────────────────────
        // A first version, real HTTP publish, immediately backdated
        // in the database to give this author the 90+ day tenure gate
        // 5 requires — the actual version under test is the second one,
        // published fresh below and driven through the real pipeline.
        var firstPublish = await author.Client.PostAsJsonAsync($"/api/v1/packages/{name}/versions", PublishRequest(name, "0.1.0"));
        Assert.Equal(HttpStatusCode.Created, firstPublish.StatusCode);
        var firstPublished = (await firstPublish.Content.ReadFromJsonAsync<PublishVersionResponse>())!;
        await QualifyAuthorAsVerifiedAsync(author.UserId, firstPublished.VersionId);

        var publishResponse = await author.Client.PostAsJsonAsync($"/api/v1/packages/{name}/versions", PublishRequest(name, "1.0.0"));
        Assert.Equal(HttpStatusCode.Created, publishResponse.StatusCode);
        var published = (await publishResponse.Content.ReadFromJsonAsync<PublishVersionResponse>())!;
        Assert.Equal(PackageScanStatus.Pending, published.ScanStatus);

        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ForgeDbContext>();
            var bundleStorage = scope.ServiceProvider.GetRequiredService<IPackageBundleStorage>();
            var orchestrator = BuildOrchestrator(db, bundleStorage);
            bool scanned;
            do
            {
                scanned = await orchestrator.ScanNextAsync(CancellationToken.None);
            } while (scanned && !await IsResolvedAsync(published.VersionId));
        }

        Guid packageId;
        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ForgeDbContext>();
            var version = await db.PackageVersions.SingleAsync(v => v.Id == published.VersionId);
            Assert.Equal(PackageScanStatus.Passed, version.ScanStatus); // gate 4 AND gate 5, for real.
            packageId = version.PackageId;
        }

        // Author links payouts and prices the module.
        var connectResponse = await author.Client.PostAsync("/api/v1/authors/me/connect-account", null);
        Assert.Equal(HttpStatusCode.OK, connectResponse.StatusCode);
        var listingResponse = await author.Client.PutAsJsonAsync($"/api/v1/packages/{name}/listing", new SetListingRequest(ListingPricingModel.OneTime, 500));
        Assert.Equal(HttpStatusCode.OK, listingResponse.StatusCode);

        // ── Bought ──────────────────────────────────────────────────
        var buyer = await AuthTestHelper.SignupAndAuthenticateAsync(_factory);
        var checkoutResponse = await buyer.Client.PostAsJsonAsync(
            "/api/v1/checkout/sessions", new CreatePurchaseCheckoutSessionRequest(buyer.WorkspaceId, name));
        Assert.Equal(HttpStatusCode.OK, checkoutResponse.StatusCode);

        string paymentIntentId;
        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ForgeDbContext>();
            var purchase = await db.Purchases.SingleAsync(p => p.PackageId == packageId && p.WorkspaceId == buyer.WorkspaceId);
            Assert.Equal(PurchaseStatus.Pending, purchase.Status); // A session response is never proof of payment.
            paymentIntentId = purchase.StripePaymentIntent;
        }

        // Only the signature-verified webhook actually grants the license.
        var webhookPayload = BuildCheckoutCompletedPayload(paymentIntentId, buyer.WorkspaceId, packageId);
        var webhookResponse = await PostWebhookAsync(webhookPayload);
        Assert.Equal(HttpStatusCode.OK, webhookResponse.StatusCode);

        var licensesResponse = await buyer.Client.GetAsync($"/api/v1/workspaces/{buyer.WorkspaceId}/licenses");
        var licenses = await licensesResponse.Content.ReadFromJsonAsync<List<LicenseResponse>>();
        Assert.Contains(licenses!, l => l.PackageName == name && l.GrantedVia == LicenseGrantedVia.Purchase);

        // ── Installed ───────────────────────────────────────────────
        // The real mechanism the editor uses to record an installed
        // module (M3/M4): committing a project revision whose document
        // lists it in installedModules — proving the license is
        // actually usable end-to-end, not just recorded as granted.
        var project = await CreateProjectAsync(buyer, buyer.WorkspaceId);
        var installedDoc = JsonSerializer.SerializeToElement(new
        {
            scenes = Array.Empty<object>(),
            installedModules = new Dictionary<string, object> { [name] = new { version = "1.0.0" } },
        });
        var commitResponse = await buyer.Client.PostAsJsonAsync(
            $"/api/v1/projects/{project.Id}/revisions",
            new { expectedHeadRevision = (long?)null, label = (string?)null, isCheckpoint = false, document = installedDoc });
        Assert.Equal(HttpStatusCode.Created, commitResponse.StatusCode);

        var docResponse = await buyer.Client.GetAsync($"/api/v1/projects/{project.Id}/document");
        var doc = await docResponse.Content.ReadFromJsonAsync<ProjectDocumentResponse>();
        Assert.True(doc!.Document.GetProperty("installedModules").TryGetProperty(name, out _));

        // ── Paid out ────────────────────────────────────────────────
        string stripeAccount;
        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ForgeDbContext>();
            stripeAccount = (await db.DomainUsers.SingleAsync(u => u.Id == author.UserId)).StripeAccount!;
        }
        _factory.MarketplaceClient.SeedPayouts(
            stripeAccount, new Infrastructure.Billing.PayoutRecord("po_exit_criteria", 400, "usd", "paid", DateTimeOffset.UtcNow));

        var earningsResponse = await author.Client.GetAsync("/api/v1/authors/me/earnings");
        var earnings = await earningsResponse.Content.ReadFromJsonAsync<AuthorEarningsResponse>();
        Assert.Equal(400, earnings!.TotalEarnedCents); // 80% revenue share of the 500-cent price.
        Assert.Equal(0, earnings.PendingPayoutCents); // fully paid out.

        var payoutsResponse = await author.Client.GetAsync("/api/v1/authors/me/payouts");
        var payouts = await payoutsResponse.Content.ReadFromJsonAsync<List<PayoutHistoryEntryResponse>>();
        Assert.Contains(payouts!, p => p.StripePayoutId == "po_exit_criteria" && p.Status == "paid");
    }
}
