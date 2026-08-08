using System.Net;
using System.Net.Http.Json;
using Forge.Api.Features.Billing;
using Forge.Domain.Entities;
using Forge.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace Forge.Tests.Features.Billing;

/// <summary>
/// Drives the checkout/portal/status endpoints' own logic — authorization,
/// validation, plan-to-price mapping, the no-subscription-yet 404 — over
/// real HTTP against <see cref="FakeStripeBillingClient"/>. What this
/// deliberately does NOT prove: that a real Stripe Checkout/Portal
/// session gets created, since no real Stripe test-mode API key exists in
/// this environment (see <see cref="ForgeWebApplicationFactory"/>'s own
/// remarks). <see cref="StripeWebhookEndpointTests"/> covers the piece
/// that actually writes plan/subscription state.
///
/// ⚠ Not run in this sandbox: no .NET SDK here. Verified when CI runs on
/// a GitHub-hosted runner.
/// </summary>
public sealed class BillingEndpointsTests : IClassFixture<ForgeWebApplicationFactory>
{
    private readonly ForgeWebApplicationFactory _factory;

    public BillingEndpointsTests(ForgeWebApplicationFactory factory)
    {
        _factory = factory;
    }

    [Fact]
    public async Task Checkout_Session_Records_The_Request_And_Returns_A_Url()
    {
        var owner = await AuthTestHelper.SignupAndAuthenticateAsync(_factory);

        var response = await owner.Client.PostAsJsonAsync(
            $"/api/v1/workspaces/{owner.WorkspaceId}/billing/checkout-session",
            new { plan = WorkspacePlan.Pro });

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<CheckoutSessionResponse>();
        Assert.False(string.IsNullOrEmpty(body!.Url));

        var recorded = Assert.Single(_factory.BillingClient.CheckoutRequests, r => r.WorkspaceId == owner.WorkspaceId);
        Assert.Equal(WorkspacePlan.Pro, recorded.Plan);
        Assert.Equal(owner.Email, recorded.CustomerEmail);
        Assert.Null(recorded.ExistingStripeCustomerId); // No prior subscription for this brand-new workspace.
    }

    [Fact]
    public async Task Checkout_Session_With_Invalid_Plan_Is_A_Validation_Problem()
    {
        var owner = await AuthTestHelper.SignupAndAuthenticateAsync(_factory);

        var response = await owner.Client.PostAsJsonAsync(
            $"/api/v1/workspaces/{owner.WorkspaceId}/billing/checkout-session",
            new { plan = "ultra" });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Checkout_Session_On_An_Already_Paid_Workspace_Is_Rejected()
    {
        var owner = await AuthTestHelper.SignupAndAuthenticateAsync(_factory);
        await SetWorkspacePlanAsync(owner.WorkspaceId, WorkspacePlan.Pro);

        var response = await owner.Client.PostAsJsonAsync(
            $"/api/v1/workspaces/{owner.WorkspaceId}/billing/checkout-session",
            new { plan = WorkspacePlan.Studio });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Portal_Session_With_No_Billing_History_Is_404()
    {
        var owner = await AuthTestHelper.SignupAndAuthenticateAsync(_factory);

        var response = await owner.Client.PostAsync($"/api/v1/workspaces/{owner.WorkspaceId}/billing/portal-session", null);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task Portal_Session_With_Existing_Subscription_Records_The_Request()
    {
        var owner = await AuthTestHelper.SignupAndAuthenticateAsync(_factory);
        var stripeCustomerId = $"cus_{Guid.NewGuid():N}";
        await SeedSubscriptionAsync(owner.WorkspaceId, stripeCustomerId, WorkspacePlan.Pro, SubscriptionStatus.Active);

        var response = await owner.Client.PostAsync($"/api/v1/workspaces/{owner.WorkspaceId}/billing/portal-session", null);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<PortalSessionResponse>();
        Assert.False(string.IsNullOrEmpty(body!.Url));

        var recorded = Assert.Single(_factory.BillingClient.PortalRequests, r => r.StripeCustomerId == stripeCustomerId);
        Assert.Contains("/billing", recorded.ReturnUrl);
    }

    [Fact]
    public async Task Get_Billing_Status_Reflects_The_Active_Subscription()
    {
        var owner = await AuthTestHelper.SignupAndAuthenticateAsync(_factory);
        await SeedSubscriptionAsync(owner.WorkspaceId, $"cus_{Guid.NewGuid():N}", WorkspacePlan.Studio, SubscriptionStatus.Active);
        await SetWorkspacePlanAsync(owner.WorkspaceId, WorkspacePlan.Studio);

        var response = await owner.Client.GetAsync($"/api/v1/workspaces/{owner.WorkspaceId}/billing");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var status = await response.Content.ReadFromJsonAsync<BillingStatusResponse>();
        Assert.Equal(WorkspacePlan.Studio, status!.Plan);
        Assert.Equal(SubscriptionStatus.Active, status.SubscriptionStatus);
    }

    [Fact]
    public async Task An_Editor_Cannot_Reach_Billing_Only_Admin_And_Owner_Can()
    {
        var owner = await AuthTestHelper.SignupAndAuthenticateAsync(_factory);
        var editor = await AuthTestHelper.SignupAndAuthenticateAsync(_factory);
        await AddWorkspaceMemberAsync(owner.WorkspaceId, editor.UserId, WorkspaceRole.Editor);

        var response = await editor.Client.GetAsync($"/api/v1/workspaces/{owner.WorkspaceId}/billing");

        // Cross-tenant-shaped 404, not 403 (docs/SPEC.md Section 4.5) —
        // same reasoning as the project/workspace role gate: a 403 would
        // itself confirm the workspace exists and that billing lives
        // behind a role wall higher than Editor.
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    private async Task SetWorkspacePlanAsync(Guid workspaceId, string plan)
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ForgeDbContext>();
        await db.Workspaces.Where(w => w.Id == workspaceId).ExecuteUpdateAsync(s => s.SetProperty(w => w.Plan, plan));
    }

    private async Task SeedSubscriptionAsync(Guid workspaceId, string stripeCustomerId, string plan, string status)
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ForgeDbContext>();
        db.Subscriptions.Add(new Subscription
        {
            WorkspaceId = workspaceId,
            StripeCustomerId = stripeCustomerId,
            StripeSubscriptionId = $"sub_{Guid.NewGuid():N}",
            Plan = plan,
            Status = status,
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow,
        });
        await db.SaveChangesAsync();
    }

    private async Task AddWorkspaceMemberAsync(Guid workspaceId, Guid userId, string role)
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ForgeDbContext>();
        db.WorkspaceMembers.Add(new WorkspaceMember { WorkspaceId = workspaceId, UserId = userId, Role = role, JoinedAt = DateTimeOffset.UtcNow });
        await db.SaveChangesAsync();
    }
}
