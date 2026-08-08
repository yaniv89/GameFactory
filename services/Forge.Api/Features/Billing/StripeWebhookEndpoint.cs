using System.Text.Json;
using Forge.Api.RateLimiting;
using Forge.Domain.Entities;
using Forge.Infrastructure.Billing;
using Forge.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Stripe;
// Stripe.net has its own Stripe.Subscription type — this alias, not a
// fully-qualified name at each call site, since the domain entity is
// what this file is overwhelmingly about; Stripe.net's own types
// (Event, EventUtility, StripeException) are used unqualified instead.
using Subscription = Forge.Domain.Entities.Subscription;

namespace Forge.Api.Features.Billing;

/// <summary>
/// docs/SPEC.md Section 13.2/23.5: <c>POST /api/v1/webhooks/stripe</c>.
/// The only place that ever writes <see cref="Subscription"/> or
/// <see cref="Workspace.Plan"/> — everything else in this feature only
/// reads them. Security is entirely the Stripe-Signature verification
/// below, not Bearer/cookie auth: Stripe calls this endpoint directly,
/// with no user session.
///
/// Reads event field values via <see cref="JsonDocument"/> over the raw
/// request body rather than <c>Stripe.Event.Data.Object</c>'s typed
/// model — deliberately: this only needs <see cref="Event.Type"/> (a
/// plain string, stable across SDK versions) from the Stripe.net object,
/// and parsing the payload itself with .NET's own, version-independent
/// JSON reader avoids any dependency on which JSON library a given
/// Stripe.net version uses internally to deserialize <c>Data.Object</c>.
/// </summary>
public static class StripeWebhookEndpoint
{
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

        Event stripeEvent;
        try
        {
            stripeEvent = EventUtility.ConstructEvent(json, request.Headers["Stripe-Signature"], webhookOptions.Secret);
        }
        catch (StripeException ex)
        {
            log.LogWarning("Rejected a Stripe webhook with an invalid signature: {Message}", ex.Message);
            return TypedResults.Problem(title: "Invalid signature", statusCode: StatusCodes.Status400BadRequest);
        }

        using var doc = JsonDocument.Parse(json);
        var dataObject = doc.RootElement.GetProperty("data").GetProperty("object");

        switch (stripeEvent.Type)
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

    private static async Task HandleCheckoutSessionCompletedAsync(JsonElement session, ForgeDbContext db, CancellationToken ct)
    {
        var customerId = GetString(session, "customer");
        var subscriptionId = GetString(session, "subscription");

        string? workspaceIdRaw = null;
        string? plan = null;
        if (session.TryGetProperty("metadata", out var metadata) && metadata.ValueKind == JsonValueKind.Object)
        {
            workspaceIdRaw = GetString(metadata, "workspaceId");
            plan = GetString(metadata, "plan");
        }

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
