using Forge.Domain.Versioning;
using Xunit;

namespace Forge.Tests.Versioning;

public sealed class SemVerTests
{
    [Theory]
    [InlineData("1.2.3", 1, 2, 3)]
    [InlineData("0.0.1", 0, 0, 1)]
    [InlineData("10.20.30", 10, 20, 30)]
    public void Parses_The_Release_Core(string input, int major, int minor, int patch)
    {
        var v = SemVer.Parse(input);
        Assert.Equal(major, v.Major);
        Assert.Equal(minor, v.Minor);
        Assert.Equal(patch, v.Patch);
        Assert.False(v.IsPrerelease);
    }

    [Fact]
    public void Parses_A_Prerelease_Suffix()
    {
        var v = SemVer.Parse("1.0.0-beta.2");
        Assert.True(v.IsPrerelease);
        Assert.Equal(["beta", "2"], v.Prerelease);
    }

    [Theory]
    [InlineData("1")]
    [InlineData("1.2")]
    [InlineData("v1.2.3")]
    [InlineData("1.2.3.4")]
    [InlineData("01.2.3")] // leading zero, invalid per spec
    [InlineData("")]
    public void Rejects_Non_SemVer_Input(string input)
    {
        Assert.False(SemVer.TryParse(input, out _));
    }

    [Theory]
    [InlineData("1.0.0", "2.0.0")]      // major
    [InlineData("1.0.0", "1.1.0")]      // minor
    [InlineData("1.0.0", "1.0.1")]      // patch
    [InlineData("1.0.0-alpha", "1.0.0")] // prerelease < release
    [InlineData("1.0.0-alpha", "1.0.0-alpha.1")] // fewer identifiers < more, equal prefix
    [InlineData("1.0.0-alpha.1", "1.0.0-alpha.beta")] // numeric < alphanumeric identifier
    [InlineData("1.0.0-alpha.2", "1.0.0-alpha.10")] // numeric identifiers compare numerically, not lexically
    public void Orders_Versions_Per_Semver_Precedence(string lower, string higher)
    {
        Assert.True(SemVer.Parse(lower) < SemVer.Parse(higher));
        Assert.True(SemVer.Parse(higher) > SemVer.Parse(lower));
    }

    [Fact]
    public void Equal_Versions_Compare_Equal_Regardless_Of_Build_Metadata()
    {
        Assert.Equal(SemVer.Parse("1.2.3+build1"), SemVer.Parse("1.2.3+build2"));
    }
}
