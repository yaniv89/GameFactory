using System.Net;
using System.Net.Http.Json;
using Forge.Api.Features.Registry;
using Forge.Domain.Entities;
using Forge.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace Forge.Tests.Features.Registry;

/// <summary>
/// docs/SPEC.md Section 16.2's ratings/reviews subsystem (F1):
/// <see cref="ReviewsEndpoint"/>'s upsert/delete and
/// <see cref="PackageDetailAndVersionsEndpoint"/>'s reviews-list read.
///
/// ⚠ Not run in this sandbox: no .NET SDK here. Verified when CI runs on
/// a GitHub-hosted runner.
/// </summary>
public sealed class ReviewsEndpointTests : IClassFixture<ForgeWebApplicationFactory>
{
    private readonly ForgeWebApplicationFactory _factory;

    public ReviewsEndpointTests(ForgeWebApplicationFactory factory)
    {
        _factory = factory;
    }

    private async Task<Guid> SeedPackageAsync(string name, string pricingModel = ListingPricingModel.Free, int priceCents = 0)
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ForgeDbContext>();

        var author = new User
        {
            IdentitySubjectId = Guid.NewGuid().ToString(),
            Email = $"author-{Guid.NewGuid():N}@example.com",
            DisplayName = "Author",
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow,
        };
        db.DomainUsers.Add(author);
        await db.SaveChangesAsync();

        var package = new Package
        {
            Name = name,
            Kind = PackageKind.Module,
            AuthorUserId = author.Id,
            DisplayName = "Test Package",
            Summary = "A test package.",
            LicenseSpdx = "MIT",
            CreatedAt = DateTimeOffset.UtcNow,
        };
        db.Packages.Add(package);
        await db.SaveChangesAsync();

        db.Listings.Add(new Listing { PackageId = package.Id, PricingModel = pricingModel, PriceCents = priceCents });
        await db.SaveChangesAsync();
        return package.Id;
    }

    private async Task GrantLicenseAsync(Guid packageId, Guid workspaceId, DateTimeOffset? revokedAt = null)
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ForgeDbContext>();
        db.Licenses.Add(new License
        {
            PackageId = packageId,
            WorkspaceId = workspaceId,
            GrantedVia = LicenseGrantedVia.Purchase,
            GrantedAt = DateTimeOffset.UtcNow,
            RevokedAt = revokedAt,
        });
        await db.SaveChangesAsync();
    }

    [Fact]
    public async Task Upsert_Creates_A_Review_For_A_Free_Package_Without_Any_Purchase()
    {
        var packageId = await SeedPackageAsync("@acme/reviews-free-create");
        var user = await AuthTestHelper.SignupAndAuthenticateAsync(_factory);

        var response = await user.Client.PutAsJsonAsync(
            "/api/v1/packages/@acme/reviews-free-create/reviews", new { rating = 5, body = "Great module." });

        response.EnsureSuccessStatusCode();
        var body = await response.Content.ReadFromJsonAsync<ReviewResponse>();
        Assert.Equal(5, body!.Rating);
        Assert.Equal("Great module.", body.Body);
        Assert.Null(body.UpdatedAt);
    }

    [Fact]
    public async Task Upsert_Called_Twice_By_The_Same_User_Edits_In_Place_Not_A_Second_Row()
    {
        var packageId = await SeedPackageAsync("@acme/reviews-edit-in-place");
        var user = await AuthTestHelper.SignupAndAuthenticateAsync(_factory);

        var first = await user.Client.PutAsJsonAsync(
            "/api/v1/packages/@acme/reviews-edit-in-place/reviews", new { rating = 3, body = "It's okay." });
        first.EnsureSuccessStatusCode();
        var firstBody = await first.Content.ReadFromJsonAsync<ReviewResponse>();

        var second = await user.Client.PutAsJsonAsync(
            "/api/v1/packages/@acme/reviews-edit-in-place/reviews", new { rating = 5, body = "Changed my mind, love it." });
        second.EnsureSuccessStatusCode();
        var secondBody = await second.Content.ReadFromJsonAsync<ReviewResponse>();

        Assert.Equal(firstBody!.Id, secondBody!.Id);
        Assert.Equal(5, secondBody.Rating);
        Assert.NotNull(secondBody.UpdatedAt);

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ForgeDbContext>();
        var count = await db.Reviews.CountAsync(r => r.PackageId == packageId && r.UserId == user.UserId);
        Assert.Equal(1, count);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(6)]
    public async Task Upsert_Rejects_A_Rating_Outside_1_To_5(int rating)
    {
        await SeedPackageAsync("@acme/reviews-bad-rating-" + rating);
        var user = await AuthTestHelper.SignupAndAuthenticateAsync(_factory);

        var response = await user.Client.PutAsJsonAsync(
            "/api/v1/packages/@acme/reviews-bad-rating-" + rating + "/reviews", new { rating, body = (string?)null });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Upsert_Requires_Authentication()
    {
        await SeedPackageAsync("@acme/reviews-anon-rejected");
        var client = _factory.CreateClient();

        var response = await client.PutAsJsonAsync(
            "/api/v1/packages/@acme/reviews-anon-rejected/reviews", new { rating = 4, body = (string?)null });

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Upsert_On_A_Paid_Package_Is_Forbidden_Without_A_License()
    {
        await SeedPackageAsync("@acme/reviews-paid-no-license", pricingModel: ListingPricingModel.OneTime, priceCents: 999);
        var user = await AuthTestHelper.SignupAndAuthenticateAsync(_factory);

        var response = await user.Client.PutAsJsonAsync(
            "/api/v1/packages/@acme/reviews-paid-no-license/reviews", new { rating = 5, body = (string?)null });

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task Upsert_On_A_Paid_Package_Succeeds_With_A_Non_Revoked_License()
    {
        var packageId = await SeedPackageAsync("@acme/reviews-paid-licensed", pricingModel: ListingPricingModel.OneTime, priceCents: 999);
        var user = await AuthTestHelper.SignupAndAuthenticateAsync(_factory);
        await GrantLicenseAsync(packageId, user.WorkspaceId);

        var response = await user.Client.PutAsJsonAsync(
            "/api/v1/packages/@acme/reviews-paid-licensed/reviews", new { rating = 4, body = "Worth it." });

        response.EnsureSuccessStatusCode();
    }

    [Fact]
    public async Task Upsert_On_A_Paid_Package_Is_Forbidden_When_The_Only_License_Was_Revoked()
    {
        var packageId = await SeedPackageAsync("@acme/reviews-paid-revoked", pricingModel: ListingPricingModel.OneTime, priceCents: 999);
        var user = await AuthTestHelper.SignupAndAuthenticateAsync(_factory);
        await GrantLicenseAsync(packageId, user.WorkspaceId, revokedAt: DateTimeOffset.UtcNow);

        var response = await user.Client.PutAsJsonAsync(
            "/api/v1/packages/@acme/reviews-paid-revoked/reviews", new { rating = 4, body = (string?)null });

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task Upsert_404s_For_An_Unknown_Package()
    {
        var user = await AuthTestHelper.SignupAndAuthenticateAsync(_factory);

        var response = await user.Client.PutAsJsonAsync(
            "/api/v1/packages/@nobody/does-not-exist/reviews", new { rating = 4, body = (string?)null });

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task Delete_Removes_The_Callers_Own_Review()
    {
        await SeedPackageAsync("@acme/reviews-delete-own");
        var user = await AuthTestHelper.SignupAndAuthenticateAsync(_factory);
        await user.Client.PutAsJsonAsync("/api/v1/packages/@acme/reviews-delete-own/reviews", new { rating = 3, body = (string?)null });

        var response = await user.Client.DeleteAsync("/api/v1/packages/@acme/reviews-delete-own/reviews");

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
    }

    [Fact]
    public async Task Delete_404s_When_The_Caller_Never_Reviewed_The_Package()
    {
        await SeedPackageAsync("@acme/reviews-delete-none");
        var user = await AuthTestHelper.SignupAndAuthenticateAsync(_factory);

        var response = await user.Client.DeleteAsync("/api/v1/packages/@acme/reviews-delete-none/reviews");

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task Delete_Does_Not_Remove_Another_Users_Review()
    {
        await SeedPackageAsync("@acme/reviews-delete-cross-user");
        var owner = await AuthTestHelper.SignupAndAuthenticateAsync(_factory);
        await owner.Client.PutAsJsonAsync("/api/v1/packages/@acme/reviews-delete-cross-user/reviews", new { rating = 3, body = (string?)null });
        var stranger = await AuthTestHelper.SignupAndAuthenticateAsync(_factory);

        var response = await stranger.Client.DeleteAsync("/api/v1/packages/@acme/reviews-delete-cross-user/reviews");
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ForgeDbContext>();
        Assert.Equal(1, await db.Reviews.CountAsync(r => r.UserId == owner.UserId));
    }

    [Fact]
    public async Task List_Reviews_Is_Newest_First_And_Reports_The_Raw_Average_And_Count()
    {
        await SeedPackageAsync("@acme/reviews-list");
        var first = await AuthTestHelper.SignupAndAuthenticateAsync(_factory);
        await first.Client.PutAsJsonAsync("/api/v1/packages/@acme/reviews-list/reviews", new { rating = 2, body = "Meh." });
        await Task.Delay(10);
        var second = await AuthTestHelper.SignupAndAuthenticateAsync(_factory);
        await second.Client.PutAsJsonAsync("/api/v1/packages/@acme/reviews-list/reviews", new { rating = 4, body = "Pretty good." });

        var anonymousClient = _factory.CreateClient();
        var response = await anonymousClient.GetAsync("/api/v1/packages/@acme/reviews-list/reviews");

        response.EnsureSuccessStatusCode();
        var body = await response.Content.ReadFromJsonAsync<ReviewListResponse>();

        Assert.Equal(2, body!.ReviewCount);
        Assert.Equal(3.0, body.AverageRating!.Value, precision: 6);
        Assert.Equal([4, 2], body.Reviews.Select(r => r.Rating));
    }

    [Fact]
    public async Task List_Reviews_404s_For_An_Unknown_Package()
    {
        var client = _factory.CreateClient();
        var response = await client.GetAsync("/api/v1/packages/@nobody/does-not-exist/reviews");
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task Package_Detail_Reports_Null_Average_And_Zero_Count_With_No_Reviews()
    {
        await SeedPackageAsync("@acme/reviews-detail-empty");
        var client = _factory.CreateClient();

        var response = await client.GetAsync("/api/v1/packages/@acme/reviews-detail-empty");
        response.EnsureSuccessStatusCode();
        var body = await response.Content.ReadFromJsonAsync<PackageDetailResponse>();

        Assert.Null(body!.AverageRating);
        Assert.Equal(0, body.ReviewCount);
    }

    [Fact]
    public async Task Package_Detail_Reflects_A_Real_Review()
    {
        await SeedPackageAsync("@acme/reviews-detail-populated");
        var user = await AuthTestHelper.SignupAndAuthenticateAsync(_factory);
        await user.Client.PutAsJsonAsync("/api/v1/packages/@acme/reviews-detail-populated/reviews", new { rating = 5, body = (string?)null });

        var client = _factory.CreateClient();
        var response = await client.GetAsync("/api/v1/packages/@acme/reviews-detail-populated");
        response.EnsureSuccessStatusCode();
        var body = await response.Content.ReadFromJsonAsync<PackageDetailResponse>();

        Assert.Equal(5.0, body!.AverageRating);
        Assert.Equal(1, body.ReviewCount);
    }
}
