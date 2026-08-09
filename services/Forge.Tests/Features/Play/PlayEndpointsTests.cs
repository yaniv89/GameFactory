using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using Forge.Api.Features.Play;
using Forge.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace Forge.Tests.Features.Play;

/// <summary>
/// M7 Phase 7: anonymous play identity, cloud saves, leaderboards,
/// achievements, and analytics ingestion (docs/SPEC.md Section 17) —
/// over real HTTP against a real Azurite Table Storage container (same
/// approach <c>PublishVersionEndpointTests</c> already takes for real
/// Blob Storage), not a fake or mock.
///
/// ⚠ Not run in this sandbox: no .NET SDK here. Verified when CI runs on
/// a GitHub-hosted runner.
/// </summary>
public sealed class PlayEndpointsTests : IClassFixture<ForgeWebApplicationFactory>
{
    private readonly ForgeWebApplicationFactory _factory;

    public PlayEndpointsTests(ForgeWebApplicationFactory factory)
    {
        _factory = factory;
    }

    private async Task<(HttpClient Client, Guid PlayerId, string PlayToken)> CreatePlayerAsync()
    {
        var client = _factory.CreateClient();
        var response = await client.PostAsync("/api/v1/play/identity", null);
        response.EnsureSuccessStatusCode();
        var body = (await response.Content.ReadFromJsonAsync<PlayIdentityResponse>())!;

        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("PlayToken", body.PlayToken);
        return (client, body.PlayerId, body.PlayToken);
    }

    [Fact]
    public async Task Create_Identity_Issues_A_Player_And_A_Token_That_Authenticates_Play_Calls()
    {
        var (client, playerId, playToken) = await CreatePlayerAsync();

        Assert.NotEqual(Guid.Empty, playerId);
        Assert.False(string.IsNullOrEmpty(playToken));

        // Prove the token actually authenticates, not just that it parses.
        var projectId = Guid.NewGuid();
        var savesResponse = await client.GetAsync($"/api/v1/play/{projectId}/saves");
        Assert.Equal(HttpStatusCode.OK, savesResponse.StatusCode);
    }

    [Fact]
    public async Task Play_Endpoints_Reject_A_Request_With_No_Token()
    {
        var client = _factory.CreateClient();
        var response = await client.GetAsync($"/api/v1/play/{Guid.NewGuid()}/saves");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task An_Editor_Bearer_Token_Does_Not_Authenticate_Play_Endpoints()
    {
        var editor = await AuthTestHelper.SignupAndAuthenticateAsync(_factory);

        var response = await editor.Client.GetAsync($"/api/v1/play/{Guid.NewGuid()}/saves");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Link_Identity_Sets_The_Linked_User_On_The_Player_Row()
    {
        var (_, playerId, playToken) = await CreatePlayerAsync();
        var editor = await AuthTestHelper.SignupAndAuthenticateAsync(_factory);

        var response = await editor.Client.PostAsJsonAsync("/api/v1/play/identity/link", new LinkPlayIdentityRequest(playToken));
        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ForgeDbContext>();
        var player = await db.Players.SingleAsync(p => p.Id == playerId);
        Assert.Equal(editor.UserId, player.LinkedUserId);
    }

    [Fact]
    public async Task Link_Identity_With_A_Garbage_Token_Is_A_Validation_Problem()
    {
        var editor = await AuthTestHelper.SignupAndAuthenticateAsync(_factory);

        var response = await editor.Client.PostAsJsonAsync("/api/v1/play/identity/link", new LinkPlayIdentityRequest("not-a-real-token"));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Put_Then_Get_Save_Slot_Round_Trips_And_List_Reports_All_Five_Slots()
    {
        var (client, _, _) = await CreatePlayerAsync();
        var projectId = Guid.NewGuid();
        var dataBase64 = Convert.ToBase64String("hello save"u8.ToArray());

        var putResponse = await client.PutAsJsonAsync($"/api/v1/play/{projectId}/saves/2", new PutSaveSlotRequest(dataBase64, null));
        Assert.Equal(HttpStatusCode.OK, putResponse.StatusCode);

        var getResponse = await client.GetAsync($"/api/v1/play/{projectId}/saves/2");
        Assert.Equal(HttpStatusCode.OK, getResponse.StatusCode);
        var slot = await getResponse.Content.ReadFromJsonAsync<SaveSlotResponse>();
        Assert.Equal(dataBase64, slot!.DataBase64);

        var listResponse = await client.GetAsync($"/api/v1/play/{projectId}/saves");
        var list = await listResponse.Content.ReadFromJsonAsync<SaveSlotListResponse>();
        Assert.Equal(5, list!.Slots.Count);
        Assert.Equal(dataBase64, list.Slots.Single(s => s.Slot == 2).DataBase64);
        Assert.Null(list.Slots.Single(s => s.Slot == 0).DataBase64);
    }

    [Fact]
    public async Task Put_Save_Slot_Rejects_Data_Over_The_512Kb_Cap()
    {
        var (client, _, _) = await CreatePlayerAsync();
        var projectId = Guid.NewGuid();
        var oversized = Convert.ToBase64String(new byte[513 * 1024]);

        var response = await client.PutAsJsonAsync($"/api/v1/play/{projectId}/saves/0", new PutSaveSlotRequest(oversized, null));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Theory]
    [InlineData(-1)]
    [InlineData(5)]
    public async Task Put_Save_Slot_Rejects_An_Out_Of_Range_Slot_Index(int slot)
    {
        var (client, _, _) = await CreatePlayerAsync();
        var projectId = Guid.NewGuid();

        var response = await client.PutAsJsonAsync(
            $"/api/v1/play/{projectId}/saves/{slot}", new PutSaveSlotRequest(Convert.ToBase64String("x"u8.ToArray()), null));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Put_Save_Slot_Without_A_Matching_ETag_Is_A_Conflict()
    {
        var (client, _, _) = await CreatePlayerAsync();
        var projectId = Guid.NewGuid();
        var first = Convert.ToBase64String("first"u8.ToArray());
        var second = Convert.ToBase64String("second"u8.ToArray());

        await client.PutAsJsonAsync($"/api/v1/play/{projectId}/saves/0", new PutSaveSlotRequest(first, null));

        // Writing again without the ETag the first write returned — the
        // "another session may have written since you last read" case.
        var response = await client.PutAsJsonAsync($"/api/v1/play/{projectId}/saves/0", new PutSaveSlotRequest(second, null));

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
    }

    [Fact]
    public async Task Put_Save_Slot_With_The_Correct_ETag_Succeeds()
    {
        var (client, _, _) = await CreatePlayerAsync();
        var projectId = Guid.NewGuid();
        var first = Convert.ToBase64String("first"u8.ToArray());
        var second = Convert.ToBase64String("second"u8.ToArray());

        var firstPut = await client.PutAsJsonAsync($"/api/v1/play/{projectId}/saves/0", new PutSaveSlotRequest(first, null));
        var firstSlot = await firstPut.Content.ReadFromJsonAsync<SaveSlotResponse>();

        var response = await client.PutAsJsonAsync($"/api/v1/play/{projectId}/saves/0", new PutSaveSlotRequest(second, firstSlot!.ETag));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var updated = await response.Content.ReadFromJsonAsync<SaveSlotResponse>();
        Assert.Equal(second, updated!.DataBase64);
    }

    [Fact]
    public async Task Delete_Save_Slot_Is_Idempotent()
    {
        var (client, _, _) = await CreatePlayerAsync();
        var projectId = Guid.NewGuid();

        var first = await client.DeleteAsync($"/api/v1/play/{projectId}/saves/0");
        var second = await client.DeleteAsync($"/api/v1/play/{projectId}/saves/0");

        Assert.Equal(HttpStatusCode.NoContent, first.StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, second.StatusCode);
    }

    [Fact]
    public async Task Submit_Score_Then_Read_Leaderboard_Shows_It_Marked_Unverified()
    {
        var (client, playerId, _) = await CreatePlayerAsync();
        var projectId = Guid.NewGuid();
        var leaderboardId = "high-scores";

        var submit = await client.PostAsJsonAsync($"/api/v1/play/{projectId}/leaderboards/{leaderboardId}/scores", new SubmitScoreRequest(100));
        Assert.Equal(HttpStatusCode.NoContent, submit.StatusCode);

        var anonymous = _factory.CreateClient();
        var response = await anonymous.GetAsync($"/api/v1/play/{projectId}/leaderboards/{leaderboardId}");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var board = await response.Content.ReadFromJsonAsync<LeaderboardResponse>();

        Assert.False(board!.Verified);
        var entry = Assert.Single(board.Entries, e => e.PlayerId == playerId);
        Assert.Equal(100, entry.Score);
    }

    [Fact]
    public async Task A_Worse_Score_Does_Not_Replace_The_Players_Best_A_Better_One_Does()
    {
        var (client, playerId, _) = await CreatePlayerAsync();
        var projectId = Guid.NewGuid();
        var leaderboardId = "improve-only";

        await client.PostAsJsonAsync($"/api/v1/play/{projectId}/leaderboards/{leaderboardId}/scores", new SubmitScoreRequest(50));
        await client.PostAsJsonAsync($"/api/v1/play/{projectId}/leaderboards/{leaderboardId}/scores", new SubmitScoreRequest(10)); // worse, ignored
        await client.PostAsJsonAsync($"/api/v1/play/{projectId}/leaderboards/{leaderboardId}/scores", new SubmitScoreRequest(75)); // better, replaces

        var response = await client.GetAsync($"/api/v1/play/{projectId}/leaderboards/{leaderboardId}");
        var board = await response.Content.ReadFromJsonAsync<LeaderboardResponse>();

        var entry = Assert.Single(board!.Entries, e => e.PlayerId == playerId); // exactly one row, not three.
        Assert.Equal(75, entry.Score);
    }

    [Fact]
    public async Task Get_Leaderboard_Rejects_An_Unsupported_Window()
    {
        var client = _factory.CreateClient();

        var response = await client.GetAsync($"/api/v1/play/{Guid.NewGuid()}/leaderboards/whatever?window=weekly");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Unlock_Achievement_Then_List_Shows_It_Marked_Unverified()
    {
        var (client, _, _) = await CreatePlayerAsync();
        var projectId = Guid.NewGuid();

        var unlock = await client.PostAsync($"/api/v1/play/{projectId}/achievements/first-win/unlock", null);
        Assert.Equal(HttpStatusCode.OK, unlock.StatusCode);
        var unlockBody = await unlock.Content.ReadFromJsonAsync<AchievementUnlockResponse>();
        Assert.False(unlockBody!.Verified);

        var list = await client.GetAsync($"/api/v1/play/{projectId}/achievements");
        var body = await list.Content.ReadFromJsonAsync<AchievementListResponse>();
        Assert.Single(body!.Achievements, a => a.AchievementId == "first-win");
    }

    [Fact]
    public async Task Unlocking_The_Same_Achievement_Twice_Keeps_The_Original_Timestamp()
    {
        var (client, _, _) = await CreatePlayerAsync();
        var projectId = Guid.NewGuid();

        var first = await client.PostAsync($"/api/v1/play/{projectId}/achievements/repeat-me/unlock", null);
        var firstBody = await first.Content.ReadFromJsonAsync<AchievementUnlockResponse>();

        await Task.Delay(50); // Ensure a real clock difference would be observable if this were (wrongly) not idempotent.
        var second = await client.PostAsync($"/api/v1/play/{projectId}/achievements/repeat-me/unlock", null);
        var secondBody = await second.Content.ReadFromJsonAsync<AchievementUnlockResponse>();

        Assert.Equal(firstBody!.UnlockedAt, secondBody!.UnlockedAt);
    }

    [Fact]
    public async Task Ingest_Analytics_Events_Succeeds()
    {
        var (client, _, _) = await CreatePlayerAsync();
        var projectId = Guid.NewGuid();

        var response = await client.PostAsJsonAsync(
            $"/api/v1/play/{projectId}/analytics/events",
            new IngestAnalyticsEventsRequest([new AnalyticsEventRequest("level_start", """{"level":1}"""), new AnalyticsEventRequest("level_complete", null)]));

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
    }

    [Fact]
    public async Task Ingest_Analytics_Rejects_An_Empty_Batch()
    {
        var (client, _, _) = await CreatePlayerAsync();
        var projectId = Guid.NewGuid();

        var response = await client.PostAsJsonAsync($"/api/v1/play/{projectId}/analytics/events", new IngestAnalyticsEventsRequest([]));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }
}
