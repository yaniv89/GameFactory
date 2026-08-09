using Forge.Infrastructure.Play;
using Xunit;

namespace Forge.Tests.Infrastructure.Play;

public sealed class PlayTokenServiceTests
{
    private static PlayTokenService NewService(string secret = "test-secret") => new(new PlayTokenOptions(secret));

    [Fact]
    public void A_Freshly_Issued_Token_Validates_To_The_Same_Player_Id()
    {
        var service = NewService();
        var playerId = Guid.NewGuid();

        var token = service.Issue(playerId);

        Assert.True(service.TryValidate(token, out var validated));
        Assert.Equal(playerId, validated);
    }

    [Fact]
    public void A_Token_Signed_With_A_Different_Secret_Does_Not_Validate()
    {
        var issuer = NewService("secret-a");
        var verifier = NewService("secret-b");

        var token = issuer.Issue(Guid.NewGuid());

        Assert.False(verifier.TryValidate(token, out _));
    }

    [Theory]
    [InlineData("")]
    [InlineData("not-a-token")]
    [InlineData("only.two")]
    [InlineData("one.two.three.four")]
    public void A_Malformed_Token_Does_Not_Validate(string malformed)
    {
        var service = NewService();

        Assert.False(service.TryValidate(malformed, out _));
    }

    [Fact]
    public void Tampering_With_The_Player_Id_Segment_Invalidates_The_Signature()
    {
        var service = NewService();
        var token = service.Issue(Guid.NewGuid());
        var parts = token.Split('.');

        var tampered = $"{Guid.NewGuid():N}.{parts[1]}.{parts[2]}";

        Assert.False(service.TryValidate(tampered, out _));
    }

    [Fact]
    public void An_Expired_Token_Does_Not_Validate()
    {
        var service = NewService();
        // Forge a token with an already-past expiry using the same
        // signing scheme the real Issue() method uses internally, since
        // there's no way to fast-forward the service's own clock.
        var playerId = Guid.NewGuid();
        var expiredUnix = DateTimeOffset.UtcNow.AddDays(-1).ToUnixTimeSeconds();
        var payload = $"{playerId:N}.{expiredUnix}";
        using var hmac = new System.Security.Cryptography.HMACSHA256(System.Text.Encoding.UTF8.GetBytes("test-secret"));
        var signature = Convert.ToHexString(hmac.ComputeHash(System.Text.Encoding.UTF8.GetBytes(payload))).ToLowerInvariant();
        var expiredToken = $"{payload}.{signature}";

        Assert.False(service.TryValidate(expiredToken, out _));
    }
}
