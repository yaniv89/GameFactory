using Forge.Domain.Versioning;
using Xunit;

namespace Forge.Tests.Versioning;

public sealed class SemVerRangeTests
{
    [Theory]
    [InlineData("^1.8.0", "1.8.0", true)]
    [InlineData("^1.8.0", "1.9.5", true)]
    [InlineData("^1.8.0", "2.0.0", false)]
    [InlineData("^1.8.0", "1.7.9", false)]
    [InlineData("^0.2.3", "0.2.9", true)]  // 0.x.y: caret only allows patch/minor-within-same-minor
    [InlineData("^0.2.3", "0.3.0", false)]
    [InlineData("^0.0.3", "0.0.3", true)]  // 0.0.x: caret is exact-patch only
    [InlineData("^0.0.3", "0.0.4", false)]
    public void Caret_Range_Matches_Npm_Semantics(string range, string version, bool expected)
    {
        Assert.Equal(expected, SemVerRange.Parse(range).IsSatisfiedBy(SemVer.Parse(version)));
    }

    [Theory]
    [InlineData("~0.9.4", "0.9.4", true)]
    [InlineData("~0.9.4", "0.9.9", true)]
    [InlineData("~0.9.4", "0.10.0", false)]
    [InlineData("~0.9.4", "0.9.3", false)]
    public void Tilde_Range_Allows_Patch_Level_Changes_Only(string range, string version, bool expected)
    {
        Assert.Equal(expected, SemVerRange.Parse(range).IsSatisfiedBy(SemVer.Parse(version)));
    }

    [Theory]
    [InlineData(">=2.1.0 <3.0.0", "2.1.0", true)]
    [InlineData(">=2.1.0 <3.0.0", "2.9.9", true)]
    [InlineData(">=2.1.0 <3.0.0", "3.0.0", false)]
    [InlineData(">=2.1.0 <3.0.0", "2.0.9", false)]
    public void Comparator_Set_Is_Anded(string range, string version, bool expected)
    {
        Assert.Equal(expected, SemVerRange.Parse(range).IsSatisfiedBy(SemVer.Parse(version)));
    }

    [Theory]
    [InlineData("4.2.0", "4.2.0", true)]
    [InlineData("4.2.0", "4.2.1", false)]
    public void Bare_Version_Matches_Exactly(string range, string version, bool expected)
    {
        Assert.Equal(expected, SemVerRange.Parse(range).IsSatisfiedBy(SemVer.Parse(version)));
    }

    [Theory]
    [InlineData("")]
    [InlineData("not-a-range")]
    [InlineData("^not-a-version")]
    [InlineData("||1.0.0")]
    public void Rejects_Malformed_Ranges(string input)
    {
        Assert.False(SemVerRange.TryParse(input, out _));
    }
}
