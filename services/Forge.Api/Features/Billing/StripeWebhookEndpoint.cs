using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Forge.Api.RateLimiting;
using Forge.Domain.Entities;
using Forge.Infrastructure.Billing;
using Forge.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Forge.Api.Features.Billing;

/// <summary>
/// docs/SPEC.md Section 13.2/23.5: <c>POST /api/v1/webhooks/stripe</c>.
/// The only place that ever writes <see cref="Subscription"/> or
/// <see cref="Workspace.Plan"/> — everything else in this feature only
/// reads them. Security is entirely the Stripe-Signature verification
/// below, not Bearer/cookie auth: Stripe calls this endpoint directly,
/// with no user session.
///
/// Verifies the signature and reads every field via <see cref="JsonDocument"/>
/// over the raw request body, deliberately not through Stripe.net's
/// <c>EventUtility.ConstructEvent</c>/typed <c>Event</c> model. That was
/// tried first: it requires successfully deserializing the entire payload
/// into Stripe.net's own object graph just to hand back
/// <c>Event.Type</c>, and a real CI run proved a hand-built test payload
/// good enough to carry every field this handler actually reads still
/// isn't necessarily good enough to satisfy the full typed model — it
/// threw a non-<c>StripeException</c> that surfaced as a 500, not the
/// intended 400. Signature verification itself is a self-contained,
/// stable, publicly documented HMAC-SHA256 scheme
/// (<c>t={timestamp},v1=HMAC-SHA256(secret,"{timestamp}.{payload}")</c>)
/// that doesn't need the SDK at all; implementing it directly removes any
/// dependency on Stripe.net's internal JSON handling for this endpoint.
/// </summary>
public static class StripeWebhookEndpoint
{
    /// <summary>Stripe's own reference implementations use this same 5-minute default tolerance against replay of an old, still-validly-signed payload.</summary>
    private const int SignatureToleranceSeconds = 300;

    public static IEndpointRouteBuilder MapStripeWebhook(this IEndpointRouteBuilder app)
    {
        app.MapPost("/api/v1/webhooks/stripe", Handle)
            .WithRateLimit("webhooks:stripe", RateLimitKeyStrategy.IpAddress, RateLimitPolicies.Token)
            .WithName("StripeWebhook")
            .Produces(StatusCodes.Status200OK)
            .ProducesProblem(StatusCodes.Status400BadRequest);
        return app;
    }

    private static async Task<IResult> Handle(
        HttpRequest request,
        ForgeDbContext db,
        StripeWebhookOptions webhookOptions,
        StripePriceOptions priceOptions,
        ILogger<ForgeDbContext> log,
        CancellationToken ct)
    {
        using var reader = new StreamReader(request.Body);
        var json = await reader.ReadToEndAsync(ct);

        if (!IsSignatureValid(json, request.Headers["Stripe-Signature"].ToString(), webhookOptions.Secret))
        {
            log.LogWarning("Rejected a Stripe webhook with an invalid or expired signature.");
            return TypedResults.Problem(title: "Invalid signature", statusCode: StatusCodes.Status400BadRequest);
        }

        using var doc = JsonDocument.Parse(json);
        var root = doc.RootElement;
        var eventType = GetString(root, "type");
        var dataObject = root.GetProperty("data").GetProperty("object");

        switch (eventType)
        {
            case "checkout.session.completed":
                await HandleCheckoutSessionCompletedAsync(dataObject, db, ct);
                break;

            case "customer.subscription.updated":
                await HandleSubscriptionUpdatedAsync(dataObject, priceOptions, db, ct);
                break;

            case "customer.subscription.deleted":
                await HandleSubscriptionDeletedAsync(dataObject, db, ct);
                break;

            case "invoice.payment_failed":
                // Acknowledged only. Stripe always sends an accompanying
                // customer.subscription.updated (status -> past_due) for
                // this transition — that event is the actual source of
                // truth here, so there's nothing independent for this
                // one to write without racing it.
                break;
        }

        return TypedResults.Ok();
    }

    /// <summary>
    /// Hand-rolled verification of Stripe's <c>Stripe-Signature</c> header:
    /// <c>t={timestamp},v1={hex hmac},v1={hex hmac}...</c> (Stripe sends
    /// multiple <c>v1</c> values during secret rotation — any match is
    /// sufficient). Rejects a payload whose timestamp has drifted more than
    /// <see cref="SignatureToleranceSeconds"/> from now, the same
    /// replay-tolerance Stripe's own libraries apply by default.
    /// </summary>
    private static bool IsSignatureValid(string payload, string signatureHeader, string secret)
    {
        long? timestamp = null;
        var signatures = new List<string>();

        foreach (var part in signatureHeader.Split(','))
        {
            var kv = part.Split('=', 2);
            if (kv.Length != 2) continue;
            if (kv[0] == "t" && long.TryParse(kv[1], out var t)) timestamp = t;
            else if (kv[0] == "v1") signatures.Add(kv[1]);
        }

        if (timestamp is not { } ts || signatures.Count == 0) return false;

        var age = Math.Abs(DateTimeOffset.UtcNow.ToUnixTimeSeconds() - ts);
        if (age > SignatureToleranceSeconds) return false;

        var signedPayload = $"{ts}.{payload}";
        using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(secret));
        var expected = Convert.ToHexString(hmac.ComputeHash(Encoding.UTF8.GetBytes(signedPayload))).ToLowerInvariant();

        return signatures.Any(sig => CryptographicOperations.FixedTimeEquals(
            Encoding.UTF8.GetBytes(sig), Encoding.UTF8.GetBytes(expected)));
    }

    /// <summary>
    /// Dispatches by metadata shape: a subscription checkout
    /// (<see cref="Features.Billing.CheckoutSessionEndpoint"/>) carries
    /// <c>workspaceId</c>+<c>plan</c>; a marketplace purchase checkout
    /// (<see cref="Features.Marketplace.PurchaseCheckoutSessionEndpoint"/>)
    /// carries <c>workspaceId</c>+<c>packageId</c> instead. Both post to
    /// this same webhook route — Stripe has no per-Checkout-Session
    /// callback URL — so the metadata written at session-creation time is
    /// the only signal distinguishing them.
    /// </summary>
    private static async Task HandleCheckoutSessionCompletedAsync(JsonElement session, ForgeDbContext db, CancellationToken ct)
    {
        string? workspaceIdRaw = null;
        string? plan = null;
        string? packageIdRaw = null;
        if (session.TryGetProperty("metadata", out var metadata) && metadata.ValueKind == JsonValueKind.Object)
        {
            workspaceIdRaw = GetString(metadata, "workspaceId");
            plan = GetString(metadata, "plan");
            packageIdRaw = GetString(metadata, "packageId");
        }

        if (packageIdRaw is not null)
        {
            await HandlePurchaseCheckoutSessionCompletedAsync(session, workspaceIdRaw, packageIdRaw, db, ct);
            return;
        }

        var customerId = GetString(session, "customer");
        var subscriptionId = GetString(session, "subscription");

        if (customerId is null || subscriptionId is null
            || !Guid.TryParse(workspaceIdRaw, out var workspaceId)
            || plan is not (WorkspacePlan.Pro or WorkspacePlan.Studio))
        {
            return;
        }

        var existing = await db.Subscriptions.SingleOrDefaultAsync(s => s.StripeSubscriptionId == subscriptionId, ct);
        if (existing is not null)
        {
            existing.Plan = plan;
            existing.StripeCustomerId = customerId;
            existing.UpdatedAt = DateTimeOffset.UtcNow;
        }
        else
        {
            db.Subscriptions.Add(new Subscription
            {
                WorkspaceId = workspaceId,
                StripeCustomerId = customerId,
                StripeSubscriptionId = subscriptionId,
                Plan = plan,
                Status = SubscriptionStatus.Active,
                CreatedAt = DateTimeOffset.UtcNow,
                UpdatedAt = DateTimeOffset.UtcNow,
            });
        }

        await db.SaveChangesAsync(ct);
        await SyncWorkspacePlanAsync(db, workspaceId, ct);
    }

    /// <summary>
    /// The only place a <see cref="License"/> is ever created from a
    /// purchase — <see cref="Features.Marketplace.PurchaseCheckoutSessionEndpoint"/>
    /// only ever writes a <see cref="PurchaseStatus.Pending"/>
    /// <see cref="Purchase"/> row, deliberately never a license, so a
    /// Checkout Session response is never mistaken for proof of payment
    /// (same posture the subscription flow already documents). Correlates
    /// by <c>StripePaymentIntent</c> — the payment intent id Stripe
    /// assigns to the Checkout Session is the same one
    /// <see cref="Infrastructure.Billing.StripeMarketplaceClient.CreatePurchaseCheckoutSessionAsync"/>
    /// returned and stored on the <see cref="Purchase"/> row at session
    /// creation. Idempotent against Stripe's documented at-least-once
    /// webhook redelivery: a purchase already <see cref="PurchaseStatus.Succeeded"/>
    /// is a no-op rather than a second license row (the
    /// <c>(PackageId, WorkspaceId)</c> unique index would reject a
    /// duplicate anyway, but checking first avoids surfacing that as an
    /// unhandled exception on a legitimate redelivery).
    /// </summary>
    private static async Task HandlePurchaseCheckoutSessionCompletedAsync(
        JsonElement session, string? workspaceIdRaw, string packageIdRaw, ForgeDbContext db, CancellationToken ct)
    {
        var paymentIntentId = GetString(session, "payment_intent");
        if (paymentIntentId is null
            || !Guid.TryParse(workspaceIdRaw, out var workspaceId)
            || !Guid.TryParse(packageIdRaw, out var packageId))
        {
            return;
        }

        var purchase = await db.Purchases.SingleOrDefaultAsync(p => p.StripePaymentIntent == paymentIntentId, ct);
        if (purchase is null || purchase.WorkspaceId != workspaceId || purchase.PackageId != packageId) return;
        if (purchase.Status == PurchaseStatus.Succeeded) return;

        purchase.Status = PurchaseStatus.Succeeded;

        db.Licenses.Add(new License
        {
            PackageId = purchase.PackageId,
            WorkspaceId = purchase.WorkspaceId,
            GrantedVia = LicenseGrantedVia.Purchase,
            PurchaseId = purchase.Id,
            GrantedAt = DateTimeOffset.UtcNow,
            ExpiresAt = null,
        });

        await db.SaveChangesAsync(ct);
    }

    private static async Task HandleSubscriptionUpdatedAsync(JsonElement subscriptionObj, StripePriceOptions priceOptions, ForgeDbContext db, CancellationToken ct)
    {
        var subscriptionId = GetString(subscriptionObj, "id");
        var status = GetString(subscriptionObj, "status");
        if (subscriptionId is null || status is null) return;

        // Out-of-order delivery — Stripe does not guarantee webhook event
        // order, and checkout.session.completed (the event that creates
        // this row) simply hasn't arrived yet. It will, and will pick up
        // this same subscription id; nothing unsafe about skipping here.
        var subscription = await db.Subscriptions.SingleOrDefaultAsync(s => s.StripeSubscriptionId == subscriptionId, ct);
        if (subscription is null) return;

        subscription.Status = status;
        subscription.CancelAtPeriodEnd = subscriptionObj.TryGetProperty("cancel_at_period_end", out var cancelAtPeriodEnd)
            && cancelAtPeriodEnd.ValueKind == JsonValueKind.True;

        if (subscriptionObj.TryGetProperty("current_period_end", out var currentPeriodEnd) && currentPeriodEnd.ValueKind == JsonValueKind.Number)
        {
            subscription.CurrentPeriodEnd = DateTimeOffset.FromUnixTimeSeconds(currentPeriodEnd.GetInt64());
        }

        // A plan change made through the Billing Portal shows up here as
        // a new price on the subscription's first line item.
        if (subscriptionObj.TryGetProperty("items", out var items)
            && items.TryGetProperty("data", out var itemsData)
            && itemsData.ValueKind == JsonValueKind.Array
            && itemsData.GetArrayLength() > 0
            && itemsData[0].TryGetProperty("price", out var price))
        {
            var priceId = GetString(price, "id");
            if (priceId == priceOptions.ProPriceId) subscription.Plan = WorkspacePlan.Pro;
            else if (priceId == priceOptions.StudioPriceId) subscription.Plan = WorkspacePlan.Studio;
        }

        subscription.UpdatedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(ct);
        await SyncWorkspacePlanAsync(db, subscription.WorkspaceId, ct);
    }

    private static async Task HandleSubscriptionDeletedAsync(JsonElement subscriptionObj, ForgeDbContext db, CancellationToken ct)
    {
        var subscriptionId = GetString(subscriptionObj, "id");
        if (subscriptionId is null) return;

        var subscription = await db.Subscriptions.SingleOrDefaultAsync(s => s.StripeSubscriptionId == subscriptionId, ct);
        if (subscription is null) return;

        subscription.Status = SubscriptionStatus.Canceled;
        subscription.UpdatedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(ct);
        await SyncWorkspacePlanAsync(db, subscription.WorkspaceId, ct);
    }

    /// <summary>
    /// Keeps the denormalized <see cref="Workspace.Plan"/> read field in
    /// sync with whatever the workspace's most recently updated
    /// subscription row actually says — free the moment nothing in
    /// <see cref="SubscriptionStatus.GatesOpen"/> covers it.
    /// </summary>
    private static async Task SyncWorkspacePlanAsync(ForgeDbContext db, Guid workspaceId, CancellationToken ct)
    {
        var current = await db.Subscriptions
            .Where(s => s.WorkspaceId == workspaceId)
            .OrderByDescending(s => s.UpdatedAt)
            .FirstOrDefaultAsync(ct);

        var newPlan = current is not null && SubscriptionStatus.GatesOpen.Contains(current.Status)
            ? current.Plan
            : WorkspacePlan.Free;

        await db.Workspaces
            .Where(w => w.Id == workspaceId)
            .ExecuteUpdateAsync(s => s.SetProperty(w => w.Plan, newPlan), ct);
    }

    private static string? GetString(JsonElement element, string propertyName) =>
        element.TryGetProperty(propertyName, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() : null;
}
