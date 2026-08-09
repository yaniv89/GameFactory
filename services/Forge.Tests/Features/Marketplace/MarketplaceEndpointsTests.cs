using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Forge.Api.Features.Marketplace;
using Forge.Domain.Entities;
using Forge.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace Forge.Tests.Features.Marketplace;

/// <summary>
/// M7 Phase 4: Connect account linking, listing price management, purchase
/// Checkout Session creation, license listing, author earnings, and the
/// webhook-driven completion that actually grants a license. M7 Phase 5
/// adds real payout history and a PendingPayoutCents that actually
/// subtracts what Stripe has already paid out — over real HTTP against
/// <see cref="FakeStripeMarketplaceClient"/> (no real Stripe test-mode
/// API key exists in this environment, same posture as
/// <see cref="Features.Billing.BillingEndpointsTests"/>). Signature
/// verification for the webhook test is real HMAC-SHA256, the same
/// approach <see cref="Features.Billing.StripeWebhookEndpointTests"/>
/// already uses.
///
/// ⚠ Not run in this sandbox: no .NET SDK here. Verified when CI runs on
/// a GitHub-hosted runner.
/// </summary>
public sealed class MarketplaceEndpointsTests : IClassFixture<ForgeWebApplicationFactory>
{
    private const string WebhookSecret = "local-dev-placeholder-not-a-real-stripe-webhook-secret";

    private readonly ForgeWebApplicationFactory _factory;

    public MarketplaceEndpointsTests(ForgeWebApplicationFactory factory)
    {
        _factory = factory;
    }

    [Fact]
    public async Task Connect_Account_Creates_A_New_Stripe_Account_And_Persists_It()
    {
        var author = await AuthTestHelper.SignupAndAuthenticateAsync(_factory);

        var response = await author.Client.PostAsync("/api/v1/authors/me/connect-account", null);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<ConnectAccountLinkResponse>();
        Assert.False(string.IsNullOrEmpty(body!.OnboardingUrl));

        var recorded = Assert.Single(_factory.MarketplaceClient.ConnectRequests, r => r.Email == author.Email);
        Assert.Null(recorded.ExistingStripeAccountId);

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ForgeDbContext>();
        var user = await db.DomainUsers.SingleAsync(u => u.Id == author.UserId);
        Assert.False(string.IsNullOrEmpty(user.StripeAccount));
    }

    [Fact]
    public async Task Connect_Account_Reuses_An_Existing_Stripe_Account()
    {
        var author = await AuthTestHelper.SignupAndAuthenticateAsync(_factory);
        var existingAccountId = $"acct_{Guid.NewGuid():N}";
        await SetStripeAccountAsync(author.UserId, existingAccountId);

        var response = await author.Client.PostAsync("/api/v1/authors/me/connect-account", null);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var recorded = Assert.Single(_factory.MarketplaceClient.ConnectRequests, r => r.Email == author.Email);
        Assert.Equal(existingAccountId, recorded.ExistingStripeAccountId);

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ForgeDbContext>();
        var user = await db.DomainUsers.SingleAsync(u => u.Id == author.UserId);
        Assert.Equal(existingAccountId, user.StripeAccount);
    }

    [Fact]
    public async Task Set_Listing_Updates_Price_For_The_Owning_Author()
    {
        var author = await AuthTestHelper.SignupAndAuthenticateAsync(_factory);
        var (_, packageName) = await SeedPackageWithListingAsync(author.UserId, ListingPricingModel.Free, 0);

        var response = await author.Client.PutAsJsonAsync(
            $"/api/v1/packages/{packageName}/listing",
            new SetListingRequest(ListingPricingModel.OneTime, 500));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<ListingResponse>();
        Assert.Equal(ListingPricingModel.OneTime, body!.PricingModel);
        Assert.Equal(500, body.PriceCents);

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ForgeDbContext>();
        var listing = await db.Listings.SingleAsync(l => l.Package!.Name == packageName);
        Assert.Equal(ListingPricingModel.OneTime, listing.PricingModel);
        Assert.Equal(500, listing.PriceCents);
    }

    [Theory]
    [InlineData(ListingPricingModel.Free, 500)]
    [InlineData(ListingPricingModel.OneTime, 0)]
    public async Task Set_Listing_Rejects_A_Price_Pricing_Model_Mismatch(string pricingModel, int priceCents)
    {
        var author = await AuthTestHelper.SignupAndAuthenticateAsync(_factory);
        var (_, packageName) = await SeedPackageWithListingAsync(author.UserId, ListingPricingModel.Free, 0);

        var response = await author.Client.PutAsJsonAsync(
            $"/api/v1/packages/{packageName}/listing",
            new SetListingRequest(pricingModel, priceCents));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Set_Listing_Rejects_An_Unknown_Pricing_Model()
    {
        var author = await AuthTestHelper.SignupAndAuthenticateAsync(_factory);
        var (_, packageName) = await SeedPackageWithListingAsync(author.UserId, ListingPricingModel.Free, 0);

        var response = await author.Client.PutAsJsonAsync(
            $"/api/v1/packages/{packageName}/listing",
            new SetListingRequest("crypto", 500));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Set_Listing_From_Someone_Other_Than_The_Author_Is_404()
    {
        var author = await AuthTestHelper.SignupAndAuthenticateAsync(_factory);
        var stranger = await AuthTestHelper.SignupAndAuthenticateAsync(_factory);
        var (_, packageName) = await SeedPackageWithListingAsync(author.UserId, ListingPricingModel.Free, 0);

        var response = await stranger.Client.PutAsJsonAsync(
            $"/api/v1/packages/{packageName}/listing",
            new SetListingRequest(ListingPricingModel.OneTime, 500));

        // Cross-tenant-shaped 404, not 403 (docs/SPEC.md Section 4.5) —
        // same reasoning as every other authorship/role gate in this repo.
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task Purchase_Checkout_Session_Happy_Path_Creates_A_Pending_Purchase()
    {
        var author = await AuthTestHelper.SignupAndAuthenticateAsync(_factory);
        await SetStripeAccountAsync(author.UserId, $"acct_{Guid.NewGuid():N}");
        var (packageId, packageName) = await SeedPackageWithListingAsync(author.UserId, ListingPricingModel.OneTime, 500);

        var buyer = await AuthTestHelper.SignupAndAuthenticateAsync(_factory); // Owner of their own workspace — Editor+.

        var response = await buyer.Client.PostAsJsonAsync(
            "/api/v1/checkout/sessions",
            new CreatePurchaseCheckoutSessionRequest(buyer.WorkspaceId, packageName));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<PurchaseCheckoutSessionResponse>();
        Assert.False(string.IsNullOrEmpty(body!.Url));

        var recorded = Assert.Single(_factory.MarketplaceClient.CheckoutRequests, r => r.PackageId == packageId);
        Assert.Equal(100, recorded.ApplicationFeeCents); // 20% platform cut of 500.
        Assert.Equal(buyer.WorkspaceId, recorded.WorkspaceId);

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ForgeDbContext>();
        var purchase = await db.Purchases.SingleAsync(p => p.PackageId == packageId && p.WorkspaceId == buyer.WorkspaceId);
        Assert.Equal(PurchaseStatus.Pending, purchase.Status);
        Assert.Equal(500, purchase.AmountCents);
        Assert.Equal(400, purchase.AuthorShareCents); // 80% revenue share of 500.
    }

    [Fact]
    public async Task Purchase_Checkout_Rejects_A_Free_Package()
    {
        var author = await AuthTestHelper.SignupAndAuthenticateAsync(_factory);
        var (_, packageName) = await SeedPackageWithListingAsync(author.UserId, ListingPricingModel.Free, 0);
        var buyer = await AuthTestHelper.SignupAndAuthenticateAsync(_factory);

        var response = await buyer.Client.PostAsJsonAsync(
            "/api/v1/checkout/sessions",
            new CreatePurchaseCheckoutSessionRequest(buyer.WorkspaceId, packageName));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Purchase_Checkout_Rejects_When_The_Author_Has_No_Payout_Setup()
    {
        var author = await AuthTestHelper.SignupAndAuthenticateAsync(_factory);
        var (_, packageName) = await SeedPackageWithListingAsync(author.UserId, ListingPricingModel.OneTime, 500);
        var buyer = await AuthTestHelper.SignupAndAuthenticateAsync(_factory);

        var response = await buyer.Client.PostAsJsonAsync(
            "/api/v1/checkout/sessions",
            new CreatePurchaseCheckoutSessionRequest(buyer.WorkspaceId, packageName));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Purchase_Checkout_Rejects_A_Workspace_That_Already_Owns_A_License()
    {
        var author = await AuthTestHelper.SignupAndAuthenticateAsync(_factory);
        await SetStripeAccountAsync(author.UserId, $"acct_{Guid.NewGuid():N}");
        var (packageId, packageName) = await SeedPackageWithListingAsync(author.UserId, ListingPricingModel.OneTime, 500);
        var buyer = await AuthTestHelper.SignupAndAuthenticateAsync(_factory);
        await SeedLicenseAsync(packageId, buyer.WorkspaceId);

        var response = await buyer.Client.PostAsJsonAsync(
            "/api/v1/checkout/sessions",
            new CreatePurchaseCheckoutSessionRequest(buyer.WorkspaceId, packageName));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Purchase_Checkout_Requires_Editor_Or_Above_A_Viewer_Gets_404()
    {
        var author = await AuthTestHelper.SignupAndAuthenticateAsync(_factory);
        await SetStripeAccountAsync(author.UserId, $"acct_{Guid.NewGuid():N}");
        var (_, packageName) = await SeedPackageWithListingAsync(author.UserId, ListingPricingModel.OneTime, 500);

        var owner = await AuthTestHelper.SignupAndAuthenticateAsync(_factory);
        var viewer = await AuthTestHelper.SignupAndAuthenticateAsync(_factory);
        await AddWorkspaceMemberAsync(owner.WorkspaceId, viewer.UserId, WorkspaceRole.Viewer);

        var response = await viewer.Client.PostAsJsonAsync(
            "/api/v1/checkout/sessions",
            new CreatePurchaseCheckoutSessionRequest(owner.WorkspaceId, packageName));

        // Masks "you can buy for your own workspace but not this one" the
        // same as "this workspace doesn't exist" (docs/SPEC.md Section 4.5).
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task Licenses_Endpoint_Lists_Active_Licenses_For_The_Workspace()
    {
        var author = await AuthTestHelper.SignupAndAuthenticateAsync(_factory);
        var (packageId, packageName) = await SeedPackageWithListingAsync(author.UserId, ListingPricingModel.OneTime, 500);
        var buyer = await AuthTestHelper.SignupAndAuthenticateAsync(_factory);
        await SeedLicenseAsync(packageId, buyer.WorkspaceId);

        var response = await buyer.Client.GetAsync($"/api/v1/workspaces/{buyer.WorkspaceId}/licenses");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var licenses = await response.Content.ReadFromJsonAsync<List<LicenseResponse>>();
        var license = Assert.Single(licenses!);
        Assert.Equal(packageName, license.PackageName);
        Assert.Equal(LicenseGrantedVia.Purchase, license.GrantedVia);
    }

    [Fact]
    public async Task Earnings_Endpoint_Sums_Succeeded_Purchases_For_The_Author()
    {
        var author = await AuthTestHelper.SignupAndAuthenticateAsync(_factory);
        var (packageId, _) = await SeedPackageWithListingAsync(author.UserId, ListingPricingModel.OneTime, 500);
        var buyer = await AuthTestHelper.SignupAndAuthenticateAsync(_factory);
        await SeedPurchaseAsync(packageId, buyer.WorkspaceId, buyer.UserId, PurchaseStatus.Succeeded, amountCents: 500, authorShareCents: 400);
        await SeedPurchaseAsync(packageId, buyer.WorkspaceId, buyer.UserId, PurchaseStatus.Pending, amountCents: 500, authorShareCents: 400);

        var response = await author.Client.GetAsync("/api/v1/authors/me/earnings");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<AuthorEarningsResponse>();
        Assert.Equal(400, body!.TotalEarnedCents); // Only the succeeded purchase counts.
        Assert.Equal(1, body.SucceededSaleCount);
        Assert.Equal(400, body.PendingPayoutCents); // No linked Stripe account — nothing could have been paid out yet.
    }

    [Fact]
    public async Task Earnings_Endpoint_Subtracts_Paid_Payouts_From_Pending()
    {
        var author = await AuthTestHelper.SignupAndAuthenticateAsync(_factory);
        var stripeAccount = $"acct_{Guid.NewGuid():N}";
        await SetStripeAccountAsync(author.UserId, stripeAccount);
        var (packageId, _) = await SeedPackageWithListingAsync(author.UserId, ListingPricingModel.OneTime, 500);
        var buyer = await AuthTestHelper.SignupAndAuthenticateAsync(_factory);
        await SeedPurchaseAsync(packageId, buyer.WorkspaceId, buyer.UserId, PurchaseStatus.Succeeded, amountCents: 500, authorShareCents: 1000);

        _factory.MarketplaceClient.SeedPayouts(
            stripeAccount,
            new Infrastructure.Billing.PayoutRecord("po_paid", 400, "usd", "paid", DateTimeOffset.UtcNow.AddDays(-3)),
            new Infrastructure.Billing.PayoutRecord("po_in_transit", 200, "usd", "in_transit", DateTimeOffset.UtcNow));

        var response = await author.Client.GetAsync("/api/v1/authors/me/earnings");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<AuthorEarningsResponse>();
        Assert.Equal(1000, body!.TotalEarnedCents);
        Assert.Equal(600, body.PendingPayoutCents); // 1000 earned minus the 400 that's actually paid; in_transit doesn't count yet.
    }

    [Fact]
    public async Task Payouts_Endpoint_Returns_The_Authors_Real_Payout_History()
    {
        var author = await AuthTestHelper.SignupAndAuthenticateAsync(_factory);
        var stripeAccount = $"acct_{Guid.NewGuid():N}";
        await SetStripeAccountAsync(author.UserId, stripeAccount);
        var arrival = DateTimeOffset.UtcNow.AddDays(-1);
        _factory.MarketplaceClient.SeedPayouts(stripeAccount, new Infrastructure.Billing.PayoutRecord("po_1", 400, "usd", "paid", arrival));

        var response = await author.Client.GetAsync("/api/v1/authors/me/payouts");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var payouts = await response.Content.ReadFromJsonAsync<List<PayoutHistoryEntryResponse>>();
        var payout = Assert.Single(payouts!);
        Assert.Equal("po_1", payout.StripePayoutId);
        Assert.Equal(400, payout.AmountCents);
        Assert.Equal("paid", payout.Status);
    }

    [Fact]
    public async Task Payouts_Endpoint_Is_Empty_For_An_Author_With_No_Linked_Stripe_Account()
    {
        var author = await AuthTestHelper.SignupAndAuthenticateAsync(_factory);

        var response = await author.Client.GetAsync("/api/v1/authors/me/payouts");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var payouts = await response.Content.ReadFromJsonAsync<List<PayoutHistoryEntryResponse>>();
        Assert.Empty(payouts!);
    }

    [Fact]
    public async Task Webhook_Checkout_Completed_Grants_A_License_And_Marks_The_Purchase_Succeeded()
    {
        var author = await AuthTestHelper.SignupAndAuthenticateAsync(_factory);
        await SetStripeAccountAsync(author.UserId, $"acct_{Guid.NewGuid():N}");
        var (packageId, packageName) = await SeedPackageWithListingAsync(author.UserId, ListingPricingModel.OneTime, 500);
        var buyer = await AuthTestHelper.SignupAndAuthenticateAsync(_factory);

        var checkoutResponse = await buyer.Client.PostAsJsonAsync(
            "/api/v1/checkout/sessions",
            new CreatePurchaseCheckoutSessionRequest(buyer.WorkspaceId, packageName));
        Assert.Equal(HttpStatusCode.OK, checkoutResponse.StatusCode);
        Assert.Single(_factory.MarketplaceClient.CheckoutRequests, r => r.PackageId == packageId);
        var paymentIntentId = (await GetPurchaseAsync(packageId, buyer.WorkspaceId)).StripePaymentIntent;

        var payload = BuildEventPayload("checkout.session.completed", new
        {
            id = $"cs_{Guid.NewGuid():N}",
            @object = "checkout.session",
            payment_intent = paymentIntentId,
            metadata = new { workspaceId = buyer.WorkspaceId.ToString(), packageId = packageId.ToString() },
        });

        var webhookResponse = await PostWebhookAsync(payload);
        Assert.Equal(HttpStatusCode.OK, webhookResponse.StatusCode);

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ForgeDbContext>();
        var purchase = await db.Purchases.SingleAsync(p => p.PackageId == packageId && p.WorkspaceId == buyer.WorkspaceId);
        Assert.Equal(PurchaseStatus.Succeeded, purchase.Status);

        var license = await db.Licenses.SingleAsync(l => l.PackageId == packageId && l.WorkspaceId == buyer.WorkspaceId);
        Assert.Equal(LicenseGrantedVia.Purchase, license.GrantedVia);
        Assert.Equal(purchase.Id, license.PurchaseId);
        Assert.Null(license.ExpiresAt);
    }

    [Fact]
    public async Task Webhook_Checkout_Completed_Is_Idempotent_Against_Redelivery()
    {
        var author = await AuthTestHelper.SignupAndAuthenticateAsync(_factory);
        await SetStripeAccountAsync(author.UserId, $"acct_{Guid.NewGuid():N}");
        var (packageId, packageName) = await SeedPackageWithListingAsync(author.UserId, ListingPricingModel.OneTime, 500);
        var buyer = await AuthTestHelper.SignupAndAuthenticateAsync(_factory);

        await buyer.Client.PostAsJsonAsync(
            "/api/v1/checkout/sessions",
            new CreatePurchaseCheckoutSessionRequest(buyer.WorkspaceId, packageName));
        var purchase = await GetPurchaseAsync(packageId, buyer.WorkspaceId);

        var payload = BuildEventPayload("checkout.session.completed", new
        {
            id = $"cs_{Guid.NewGuid():N}",
            @object = "checkout.session",
            payment_intent = purchase.StripePaymentIntent,
            metadata = new { workspaceId = buyer.WorkspaceId.ToString(), packageId = packageId.ToString() },
        });

        Assert.Equal(HttpStatusCode.OK, (await PostWebhookAsync(payload)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await PostWebhookAsync(payload)).StatusCode); // Redelivery.

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ForgeDbContext>();
        var licenseCount = await db.Licenses.CountAsync(l => l.PackageId == packageId && l.WorkspaceId == buyer.WorkspaceId);
        Assert.Equal(1, licenseCount); // Not two, despite two identical events.
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

    private async Task<Purchase> GetPurchaseAsync(Guid packageId, Guid workspaceId)
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ForgeDbContext>();
        return await db.Purchases.SingleAsync(p => p.PackageId == packageId && p.WorkspaceId == workspaceId);
    }

    private async Task SetStripeAccountAsync(Guid userId, string stripeAccount)
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ForgeDbContext>();
        await db.DomainUsers.Where(u => u.Id == userId).ExecuteUpdateAsync(s => s.SetProperty(u => u.StripeAccount, stripeAccount));
    }

    private async Task<(Guid PackageId, string PackageName)> SeedPackageWithListingAsync(Guid authorUserId, string pricingModel, int priceCents)
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ForgeDbContext>();
        var name = $"@author/pkg-{Guid.NewGuid():N}";
        var package = new Package
        {
            Name = name,
            Kind = PackageKind.Module,
            AuthorUserId = authorUserId,
            DisplayName = "Test Package",
            Summary = "A test package.",
            LicenseSpdx = "MIT",
            CreatedAt = DateTimeOffset.UtcNow,
        };
        db.Packages.Add(package);
        await db.SaveChangesAsync();

        db.Listings.Add(new Listing { PackageId = package.Id, PricingModel = pricingModel, PriceCents = priceCents });
        await db.SaveChangesAsync();

        return (package.Id, name);
    }

    private async Task SeedLicenseAsync(Guid packageId, Guid workspaceId)
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ForgeDbContext>();
        db.Licenses.Add(new License
        {
            PackageId = packageId,
            WorkspaceId = workspaceId,
            GrantedVia = LicenseGrantedVia.Purchase,
            GrantedAt = DateTimeOffset.UtcNow,
        });
        await db.SaveChangesAsync();
    }

    private async Task SeedPurchaseAsync(Guid packageId, Guid workspaceId, Guid buyerUserId, string status, int amountCents, int authorShareCents)
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ForgeDbContext>();
        db.Purchases.Add(new Purchase
        {
            WorkspaceId = workspaceId,
            BuyerUserId = buyerUserId,
            PackageId = packageId,
            AmountCents = amountCents,
            Currency = "USD",
            AuthorShareCents = authorShareCents,
            StripePaymentIntent = $"pi_{Guid.NewGuid():N}",
            Status = status,
            CreatedAt = DateTimeOffset.UtcNow,
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
