using System.Text.RegularExpressions;
using Forge.Domain.Entities;
using Forge.Infrastructure.Email;
using Forge.Infrastructure.Identity;
using Forge.Infrastructure.Persistence;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

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

        var workspace = new Workspace
        {
            Slug = await GenerateUniqueSlugAsync(db, req.DisplayName, ct),
            Name = $"{req.DisplayName}'s Workspace",
            Plan = "free",
            CreatedAt = DateTimeOffset.UtcNow,
        };
        db.Workspaces.Add(workspace);
        await db.SaveChangesAsync(ct); // workspace.Id must be real before the member row below.

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

    private static async Task<string> GenerateUniqueSlugAsync(ForgeDbContext db, string displayName, CancellationToken ct)
    {
        var baseSlug = Slugify(displayName);
        for (var attempt = 0; attempt < 5; attempt++)
        {
            var suffix = Guid.NewGuid().ToString("N")[..6];
            var candidate = attempt == 0 ? baseSlug : $"{baseSlug}-{suffix}";
            if (!await db.Workspaces.AnyAsync(w => w.Slug == candidate, ct)) return candidate;
        }
        throw new InvalidOperationException("Could not generate a unique workspace slug.");
    }

    private static string Slugify(string input)
    {
        var lowered = input.Trim().ToLowerInvariant();
        var slug = Regex.Replace(lowered, "[^a-z0-9]+", "-").Trim('-');
        return string.IsNullOrEmpty(slug) ? "workspace" : slug;
    }
}
