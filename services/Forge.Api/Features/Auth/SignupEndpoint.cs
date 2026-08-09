using System.Text.RegularExpressions;
using Forge.Api.RateLimiting;
using Forge.Domain.Entities;
using Forge.Infrastructure.Email;
using Forge.Infrastructure.Identity;
using Forge.Infrastructure.Persistence;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace Forge.Api.Features.Auth;

public sealed record SignupRequest(string Email, string Password, string DisplayName);

public sealed record SignupResponse(Guid UserId, Guid WorkspaceId);

/// <summary>
/// docs/SPEC.md Section 23.3 step 1: creates an Identity account, an
/// unverified domain <see cref="User"/> row, and an owned Free-tier
/// <see cref="Workspace"/> — a brand-new account is never workspace-less,
/// since every other endpoint assumes at least one.
/// </summary>
public static class SignupEndpoint
{
    public static IEndpointRouteBuilder MapSignup(this IEndpointRouteBuilder app)
    {
        app.MapPost("/api/v1/auth/signup", Handle)
            .WithRateLimit("auth:signup", RateLimitKeyStrategy.IpAddress, RateLimitPolicies.Auth)
            .WithName("Signup")
            .Produces<SignupResponse>(StatusCodes.Status201Created)
            .ProducesValidationProblem();
        return app;
    }

    private static async Task<IResult> Handle(
        SignupRequest req,
        UserManager<ForgeIdentityUser> userManager,
        ForgeDbContext db,
        IEmailSender emailSender,
        CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(req.Email) || string.IsNullOrWhiteSpace(req.Password) || string.IsNullOrWhiteSpace(req.DisplayName))
        {
            return TypedResults.ValidationProblem(new Dictionary<string, string[]>
            {
                ["request"] = ["Email, password, and display name are all required."],
            });
        }

        var identityUser = new ForgeIdentityUser { UserName = req.Email, Email = req.Email };
        var createResult = await userManager.CreateAsync(identityUser, req.Password);
        if (!createResult.Succeeded)
        {
            return TypedResults.ValidationProblem(
                createResult.Errors
                    .GroupBy(e => e.Code)
                    .ToDictionary(g => g.Key, g => g.Select(e => e.Description).ToArray()));
        }

        var domainUser = new User
        {
            IdentitySubjectId = identityUser.Id.ToString(),
            Email = req.Email,
            DisplayName = req.DisplayName,
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow,
        };
        db.DomainUsers.Add(domainUser);
        await db.SaveChangesAsync(ct); // domainUser.Id must be real before the member row below.

        var workspace = await CreateWorkspaceWithUniqueSlugAsync(db, req.DisplayName, ct); // workspace.Id must be real before the member row below.

        db.WorkspaceMembers.Add(new WorkspaceMember
        {
            WorkspaceId = workspace.Id,
            UserId = domainUser.Id,
            Role = WorkspaceRole.Owner,
            JoinedAt = DateTimeOffset.UtcNow,
        });
        await db.SaveChangesAsync(ct);

        // The token itself is the real secret here — there's no SPA
        // verification-link page to point at yet (M4's editor doesn't
        // have an account/billing surface), so this ships the raw token
        // rather than a clickable link. VerifyEmailEndpoint takes
        // (email, token) directly for exactly that reason.
        var verificationToken = await userManager.GenerateEmailConfirmationTokenAsync(identityUser);
        await emailSender.SendAsync(
            req.Email,
            "Verify your Forge account",
            $"Verification token: {verificationToken}",
            ct);

        return TypedResults.Created($"/api/v1/workspaces/{workspace.Id}", new SignupResponse(domainUser.Id, workspace.Id));
    }

    /// <summary>
    /// Generates a candidate slug and inserts the workspace in the same
    /// attempt, retrying on an actual unique-constraint violation rather
    /// than checking availability first and inserting later — a real CI
    /// run under concurrent signups (M5 Phase 6's load test) proved the
    /// check-then-insert version genuinely races: two signups with the
    /// same display name ("Test User" in the test; "John Smith" in
    /// reality) can both pass an <c>AnyAsync</c> availability check
    /// before either has committed, and the second insert then throws an
    /// unhandled <c>23505</c> unique-violation. This can't be pushed into
    /// a Serializable transaction the way <see cref="Projects.RevisionCommitService"/>
    /// handles its own race — the whole point here is to keep retrying
    /// with a different slug, not to report a conflict back to a caller
    /// who never supplied one.
    /// </summary>
    private static async Task<Workspace> CreateWorkspaceWithUniqueSlugAsync(ForgeDbContext db, string displayName, CancellationToken ct)
    {
        var baseSlug = Slugify(displayName);
        for (var attempt = 0; attempt < 5; attempt++)
        {
            var candidate = attempt == 0 ? baseSlug : $"{baseSlug}-{Guid.NewGuid().ToString("N")[..6]}";
            var workspace = new Workspace
            {
                Slug = candidate,
                Name = $"{displayName}'s Workspace",
                Plan = "free",
                CreatedAt = DateTimeOffset.UtcNow,
            };
            db.Workspaces.Add(workspace);

            try
            {
                await db.SaveChangesAsync(ct);
                return workspace;
            }
            catch (DbUpdateException ex) when (ex.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation, ConstraintName: "ix_workspaces_slug" })
            {
                db.Entry(workspace).State = EntityState.Detached;
            }
        }
        throw new InvalidOperationException("Could not generate a unique workspace slug after 5 attempts.");
    }

    private static string Slugify(string input)
    {
        var lowered = input.Trim().ToLowerInvariant();
        var slug = Regex.Replace(lowered, "[^a-z0-9]+", "-").Trim('-');
        return string.IsNullOrEmpty(slug) ? "workspace" : slug;
    }
}
