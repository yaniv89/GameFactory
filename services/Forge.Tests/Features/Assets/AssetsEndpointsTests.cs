using System.Net;
using System.Net.Http.Json;
using Forge.Api.Features.Assets;
using Forge.Domain.Entities;
using Forge.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace Forge.Tests.Features.Assets;

/// <summary>
/// docs/adr/0012 Decision 3/6, driven through a real HTTP client against
/// the real host and a real Azurite container (<see cref="ForgeWebApplicationFactory.ConfigureWebHost"/>'s
/// own two-container <c>IAssetStorage</c> override) — same idiom as
/// <see cref="Builds.BuildsEndpointsTests"/>. This is the API-level half
/// of the proof; <see cref="Authorization.CrossTenantAuthorizationTests"/>
/// covers the cross-tenant 404 case for these endpoints separately.
/// </summary>
public sealed class AssetsEndpointsTests : IClassFixture<ForgeWebApplicationFactory>
{
    private readonly ForgeWebApplicationFactory _factory;

    // A minimal, genuinely valid 1x1 PNG — the smallest real file that
    // satisfies "not empty, under the size cap," not a claim this proves
    // anything about ImageSharp's own decode (that's E3's job entirely;
    // Forge.Api never opens these bytes as an image at all, docs/adr/0012
    // Decision 3's own point).
    private static readonly byte[] TinyPngBytes = Convert.FromBase64String(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=");

    public AssetsEndpointsTests(ForgeWebApplicationFactory factory)
    {
        _factory = factory;
    }

    private static Task<HttpResponseMessage> UploadAsync(AuthenticatedTestUser user, string originalName, string mimeType, byte[] bytes, Guid? projectId = null) =>
        user.Client.PostAsJsonAsync(
            $"/api/v1/workspaces/{user.WorkspaceId}/assets",
            new UploadAssetRequest(originalName, mimeType, Convert.ToBase64String(bytes), projectId));

    [Fact]
    public async Task Upload_Then_List_Round_Trip()
    {
        var user = await AuthTestHelper.SignupAndAuthenticateAsync(_factory);

        var uploadResponse = await UploadAsync(user, "hero.png", "image/png", TinyPngBytes);
        Assert.Equal(HttpStatusCode.Accepted, uploadResponse.StatusCode);
        var uploaded = (await uploadResponse.Content.ReadFromJsonAsync<UploadAssetResponse>())!;
        Assert.Equal(AssetStatus.Pending, uploaded.Status);

        var listResponse = await user.Client.GetAsync($"/api/v1/workspaces/{user.WorkspaceId}/assets");
        Assert.Equal(HttpStatusCode.OK, listResponse.StatusCode);
        var list = (await listResponse.Content.ReadFromJsonAsync<AssetListResponse>())!;
        var summary = Assert.Single(list.Assets, a => a.Id == uploaded.Id);
        Assert.Equal("hero.png", summary.OriginalName);
        Assert.Equal(AssetStatus.Pending, summary.Status);
        Assert.Equal(TinyPngBytes.Length, summary.SizeBytes);
        // Not yet decoded (Forge.Functions.Assets, E3, hasn't run) — no
        // width/height/processed content exists yet, and this endpoint
        // never guesses at either.
        Assert.Null(summary.Width);
        Assert.Null(summary.Height);
    }

    [Fact]
    public async Task Rejects_A_Disallowed_Mime_Type_Including_Svg()
    {
        var user = await AuthTestHelper.SignupAndAuthenticateAsync(_factory);

        // docs/adr/0012 Decision 1: SVG is rejected outright, by name, not
        // merely "not on the allowlist" the same way an arbitrary
        // unsupported type is — inline-executable markup, not raster data.
        var response = await UploadAsync(user, "logo.svg", "image/svg+xml", "<svg onload=alert(1)></svg>"u8.ToArray());

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("image/svg+xml", body, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Rejects_An_Oversized_Upload_With_413()
    {
        var user = await AuthTestHelper.SignupAndAuthenticateAsync(_factory);
        var oversized = new byte[10 * 1024 * 1024 + 1];

        var response = await UploadAsync(user, "huge.png", "image/png", oversized);

        Assert.Equal(HttpStatusCode.RequestEntityTooLarge, response.StatusCode);
    }

    [Fact]
    public async Task Rejects_Empty_Content_As_A_Validation_Problem()
    {
        var user = await AuthTestHelper.SignupAndAuthenticateAsync(_factory);

        var response = await UploadAsync(user, "empty.png", "image/png", []);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task A_Second_Upload_Of_The_Same_Bytes_Dedupes_Onto_The_Existing_Row()
    {
        var user = await AuthTestHelper.SignupAndAuthenticateAsync(_factory);

        var first = await UploadAsync(user, "hero.png", "image/png", TinyPngBytes);
        var firstBody = (await first.Content.ReadFromJsonAsync<UploadAssetResponse>())!;

        var second = await UploadAsync(user, "hero-again.png", "image/png", TinyPngBytes);
        var secondBody = (await second.Content.ReadFromJsonAsync<UploadAssetResponse>())!;

        Assert.Equal(firstBody.Id, secondBody.Id);

        var listResponse = await user.Client.GetAsync($"/api/v1/workspaces/{user.WorkspaceId}/assets");
        var list = (await listResponse.Content.ReadFromJsonAsync<AssetListResponse>())!;
        // Exactly one row, not two — the whole point of the dedupe index
        // (docs/adr/0012 Decision 3 step 4).
        Assert.Single(list.Assets, a => a.Id == firstBody.Id);
    }

    [Fact]
    public async Task Upload_Over_Quota_Gets_A_Clear_402()
    {
        var user = await AuthTestHelper.SignupAndAuthenticateAsync(_factory);

        // Shrink this workspace's quota below a single tiny PNG so the
        // very next upload has to fail the check — proving the check
        // reads the real, current quota rather than some hardcoded
        // headroom this test would otherwise need to fill by uploading
        // hundreds of files.
        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ForgeDbContext>();
            await db.Workspaces.Where(w => w.Id == user.WorkspaceId).ExecuteUpdateAsync(s => s.SetProperty(w => w.StorageQuotaMb, 0));
        }

        var response = await UploadAsync(user, "hero.png", "image/png", TinyPngBytes);

        Assert.Equal(HttpStatusCode.PaymentRequired, response.StatusCode);
    }

    [Fact]
    public async Task Delete_Then_List_No_Longer_Shows_It_And_A_Second_Delete_Is_404()
    {
        var user = await AuthTestHelper.SignupAndAuthenticateAsync(_factory);
        var uploadResponse = await UploadAsync(user, "hero.png", "image/png", TinyPngBytes);
        var uploaded = (await uploadResponse.Content.ReadFromJsonAsync<UploadAssetResponse>())!;

        var deleteResponse = await user.Client.DeleteAsync($"/api/v1/assets/{uploaded.Id}");
        Assert.Equal(HttpStatusCode.NoContent, deleteResponse.StatusCode);

        var listResponse = await user.Client.GetAsync($"/api/v1/workspaces/{user.WorkspaceId}/assets");
        var list = (await listResponse.Content.ReadFromJsonAsync<AssetListResponse>())!;
        Assert.DoesNotContain(list.Assets, a => a.Id == uploaded.Id);

        var secondDelete = await user.Client.DeleteAsync($"/api/v1/assets/{uploaded.Id}");
        Assert.Equal(HttpStatusCode.NotFound, secondDelete.StatusCode);
    }

    [Fact]
    public async Task Delete_Of_A_Nonexistent_Asset_Is_404()
    {
        var user = await AuthTestHelper.SignupAndAuthenticateAsync(_factory);

        var response = await user.Client.DeleteAsync($"/api/v1/assets/{Guid.NewGuid()}");

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }
}
