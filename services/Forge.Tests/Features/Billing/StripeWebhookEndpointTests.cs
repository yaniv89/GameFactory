using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Forge.Domain.Entities;
using Forge.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace Forge.Tests.Features.Billing;

/// <summary>
/// The one piece of Stripe integration this environment CAN prove for
/// real without a live API key: webhook signature verification is a pure
/// HMAC-SHA256 computation (Stripe's own documented, long-stable scheme —
/// <c>t={unix timestamp},v1=HMAC-SHA256(secret, "{timestamp}.{payload}")</c>),
/// so these tests compute a genuinely valid signature themselves rather
/// than mocking anything, then assert on real database state after the
/// endpoint processes the event.
///
/// ⚠ Not run in this sandbox: no .NET SDK here. Verified when CI runs on
/// a GitHub-hosted runner.
/// </summary>
public sealed class StripeWebhookEndpointTests : IClassFixture<ForgeWebApplicationFactory>
{
    // Matches services/Forge.Api/appsettings.json's Stripe placeholder
    // section — ForgeWebApplicationFactory deliberately doesn't override
    // these (see its own remarks: they're deterministic and known), so
    // this really is what the test host resolves.
    private const string WebhookSecret = "whsec_placeholder";
    private const string StudioPriceId = "price_placeholder_studio";

    private readonly ForgeWebApplicationFactory _factory;

    public StripeWebhookEndpointTests(ForgeWebApplicationFactory factory)
    {
        _factory = factory;
    }

    [Fact]
    public async Task Checkout_Completed_Creates_A_Subscription_And_Opens_The_Plan_Gate()
    {
        var workspaceId = await SeedWorkspaceAsync();
        var subscriptionId = $"sub_{Guid.NewGuid():N}";
        var customerId = $"cus_{Guid.NewGuid():N}";

        var payload = BuildEventPayload("checkout.session.completed", new
        {
            id = $"cs_{Guid.NewGuid():N}",
            @object = "checkout.session",
            customer = customerId,
            subscription = subscriptionId,
            metadata = new { workspaceId = workspaceId.ToString(), plan = "pro" },
        });

        var response = await PostWebhookAsync(payload);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ForgeDbContext>();
        var subscription = await db.Subscriptions.SingleAsync(s => s.StripeSubscriptionId == subscriptionId);
        Assert.Equal(workspaceId, subscription.WorkspaceId);
        Assert.Equal(customerId, subscription.StripeCustomerId);
        Assert.Equal(WorkspacePlan.Pro, subscription.Plan);
        Assert.Equal(SubscriptionStatus.Active, subscription.Status);

        var workspace = await db.Workspaces.SingleAsync(w => w.Id == workspaceId);
        Assert.Equal(WorkspacePlan.Pro, workspace.Plan);
    }

    [Fact]
    public async Task Subscription_Updated_Changes_Period_And_Plan()
    {
        var workspaceId = await SeedWorkspaceAsync();
        var subscriptionId = await SeedSubscriptionRowAsync(workspaceId, WorkspacePlan.Pro, SubscriptionStatus.Active);
        var periodEnd = DateTimeOffset.UtcNow.AddDays(30);

        var payload = BuildEventPayload("customer.subscription.updated", new
        {
            id = subscriptionId,
            @object = "subscription",
            status = "active",
            cancel_at_period_end = true,
            current_period_end = periodEnd.ToUnixTimeSeconds(),
            items = new
            {
                @object = "list",
                data = new[] { new { price = new { id = StudioPriceId } } },
            },
        });

        var response = await PostWebhookAsync(payload);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ForgeDbContext>();
        var subscription = await db.Subscriptions.SingleAsync(s => s.StripeSubscriptionId == subscriptionId);
        Assert.True(subscription.CancelAtPeriodEnd);
        Assert.Equal(periodEnd.ToUnixTimeSeconds(), subscription.CurrentPeriodEnd!.Value.ToUnixTimeSeconds());
        Assert.Equal(WorkspacePlan.Studio, subscription.Plan); // Upgraded via the price change.

        var workspace = await db.Workspaces.SingleAsync(w => w.Id == workspaceId);
        Assert.Equal(WorkspacePlan.Studio, workspace.Plan);
    }

    [Fact]
    public async Task Subscription_Deleted_Cancels_It_And_Closes_The_Plan_Gate()
    {
        var workspaceId = await SeedWorkspaceAsync();
        var subscriptionId = await SeedSubscriptionRowAsync(workspaceId, WorkspacePlan.Pro, SubscriptionStatus.Active);
        await SetWorkspacePlanAsync(workspaceId, WorkspacePlan.Pro);

        var payload = BuildEventPayload("customer.subscription.deleted", new { id = subscriptionId, @object = "subscription" });

        var response = await PostWebhookAsync(payload);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ForgeDbContext>();
        var subscription = await db.Subscriptions.SingleAsync(s => s.StripeSubscriptionId == subscriptionId);
        Assert.Equal(SubscriptionStatus.Canceled, subscription.Status);

        var workspace = await db.Workspaces.SingleAsync(w => w.Id == workspaceId);
        Assert.Equal(WorkspacePlan.Free, workspace.Plan);
    }

    [Fact]
    public async Task An_Invalid_Signature_Is_Rejected()
    {
        var payload = BuildEventPayload("checkout.session.completed", new { id = "cs_x", @object = "checkout.session" });
        var client = _factory.CreateClient();
        var request = new HttpRequestMessage(HttpMethod.Post, "/api/v1/webhooks/stripe")
        {
            Content = new StringContent(payload, Encoding.UTF8, "application/json"),
        };
        request.Headers.Add("Stripe-Signature", "t=1,v1=0000000000000000000000000000000000000000000000000000000000000000");

        var response = await client.SendAsync(request);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    private async Task<HttpResponseMessage> PostWebhookAsync(string payload)
    {
        var client = _factory.CreateClient();
        var request = new HttpRequestMessage(HttpMethod.Post, "/api/v1/webhooks/stripe")
        {
            Content = new StringContent(payload, Encoding.UTF8, "application/json"),
        };
        request.Headers.Add("Stripe-Signature", ComputeSignatureHeader(payload, WebhookSecret, DateTimeOffset.UtcNow));
        return await client.SendAsync(request);
    }

    private static string BuildEventPayload(string type, object dataObject)
    {
        var envelope = new
        {
            id = $"evt_{Guid.NewGuid():N}",
            @object = "event",
            api_version = "2020-08-27",
            created = DateTimeOffset.UtcNow.ToUnixTimeSeconds(),
            type,
            data = new { @object = dataObject },
        };
        return JsonSerializer.Serialize(envelope);
    }

    private static string ComputeSignatureHeader(string payload, string secret, DateTimeOffset timestamp)
    {
        var timestampUnix = timestamp.ToUnixTimeSeconds();
        var signedPayload = $"{timestampUnix}.{payload}";
        using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(secret));
        var hash = hmac.ComputeHash(Encoding.UTF8.GetBytes(signedPayload));
        var signatureHex = Convert.ToHexString(hash).ToLowerInvariant();
        return $"t={timestampUnix},v1={signatureHex}";
    }

    private async Task<Guid> SeedWorkspaceAsync()
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ForgeDbContext>();
        var workspace = new Workspace { Slug = $"ws-{Guid.NewGuid():N}", Name = "Test Workspace", CreatedAt = DateTimeOffset.UtcNow };
        db.Workspaces.Add(workspace);
        await db.SaveChangesAsync();
        return workspace.Id;
    }

    private async Task<string> SeedSubscriptionRowAsync(Guid workspaceId, string plan, string status)
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ForgeDbContext>();
        var subscriptionId = $"sub_{Guid.NewGuid():N}";
        db.Subscriptions.Add(new Subscription
        {
            WorkspaceId = workspaceId,
            StripeCustomerId = $"cus_{Guid.NewGuid():N}",
            StripeSubscriptionId = subscriptionId,
            Plan = plan,
            Status = status,
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow,
        });
        await db.SaveChangesAsync();
        return subscriptionId;
    }

    private async Task SetWorkspacePlanAsync(Guid workspaceId, string plan)
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ForgeDbContext>();
        await db.Workspaces.Where(w => w.Id == workspaceId).ExecuteUpdateAsync(s => s.SetProperty(w => w.Plan, plan));
    }
}
