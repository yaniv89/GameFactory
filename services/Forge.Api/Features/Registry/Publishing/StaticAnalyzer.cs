using System.Text.RegularExpressions;

namespace Forge.Api.Features.Registry.Publishing;

public enum StaticAnalysisVerdict
{
    Clean,
    Flagged,
    Blocked,
}

public sealed record StaticAnalysisFinding(string Rule, StaticAnalysisVerdict Severity, string Detail);

public sealed record StaticAnalysisReport(StaticAnalysisVerdict Verdict, IReadOnlyList<StaticAnalysisFinding> Findings);

/// <summary>
/// docs/SPEC.md Section 10.4 gate 2: "eval/Function detection,
/// obfuscation heuristics, network calls outside allowlist, known-bad
/// patterns" — a fast, cheap pre-filter over the bundle's source text,
/// run before gate 4's actual sandboxed execution (M6 Phase 3) so an
/// obviously hostile bundle never spends that budget.
///
/// ⚠ This is exactly what docs/SPEC.md itself calls it: heuristics, not a
/// security boundary. Regex over source text cannot prove a bundle is
/// safe — it can only catch cheap, obvious cases (a literal <c>eval(</c>
/// call, a hardcoded request to a domain never declared in the manifest)
/// while missing anything that reconstructs a string at runtime before
/// calling it. The actual security boundary is the QuickJS sandbox
/// (docs/security/SANDBOX-DESIGN.md, M2) a module runs inside regardless
/// of what this gate finds. Never let this gate's "Clean" verdict be
/// read as "safe" — it means "nothing cheap and obvious was found."
/// </summary>
public static partial class StaticAnalyzer
{
    private const double SuspiciousEscapeRatio = 0.03; // hex/unicode escapes per source character.

    public static StaticAnalysisReport Analyze(string bundleSource, IReadOnlySet<string> allowedNetworkDomains)
    {
        var findings = new List<StaticAnalysisFinding>();

        if (EvalPattern().IsMatch(bundleSource))
        {
            findings.Add(new StaticAnalysisFinding("eval-call", StaticAnalysisVerdict.Blocked, "Direct eval() call detected."));
        }
        if (FunctionConstructorPattern().IsMatch(bundleSource))
        {
            findings.Add(new StaticAnalysisFinding("function-constructor", StaticAnalysisVerdict.Blocked, "Dynamic Function() construction detected — equivalent to eval()."));
        }

        foreach (var builtin in NodeBuiltinEscapePatterns)
        {
            if (bundleSource.Contains(builtin, StringComparison.Ordinal))
            {
                findings.Add(new StaticAnalysisFinding("node-builtin-escape", StaticAnalysisVerdict.Blocked, $"References a Node.js built-in ('{builtin}') a sandboxed module has no legitimate reason to touch."));
            }
        }

        foreach (Match match in NetworkCallPattern().Matches(bundleSource))
        {
            var url = match.Groups["url"].Value;
            if (!Uri.TryCreate(url, UriKind.Absolute, out var uri)) continue;
            if (!allowedNetworkDomains.Contains(uri.Host))
            {
                findings.Add(new StaticAnalysisFinding("network-allowlist-violation", StaticAnalysisVerdict.Blocked, $"Hardcoded request to '{uri.Host}', which is not in the manifest's declared network allowlist."));
            }
        }

        var escapeCount = HexOrUnicodeEscapePattern().Matches(bundleSource).Count;
        if (bundleSource.Length > 0 && (double)escapeCount / bundleSource.Length > SuspiciousEscapeRatio)
        {
            findings.Add(new StaticAnalysisFinding("obfuscation-heuristic", StaticAnalysisVerdict.Flagged, $"{escapeCount} hex/unicode escape sequences across {bundleSource.Length} characters — unusually dense for hand-written or ordinarily-minified code."));
        }

        var verdict = findings.Count == 0
            ? StaticAnalysisVerdict.Clean
            : findings.Max(f => f.Severity);

        return new StaticAnalysisReport(verdict, findings);
    }

    private static readonly string[] NodeBuiltinEscapePatterns =
    [
        "require(\"fs\")", "require('fs')",
        "require(\"child_process\")", "require('child_process')",
        "require(\"net\")", "require('net')",
        "process.binding", "process.mainModule", "process.exit",
    ];

    // Two cases, deliberately not one shared lookbehind: a bare eval(
    // preceded by a '.' is some other object's own method (config.eval(),
    // never the global eval) and must NOT match, but window.eval /
    // globalThis.eval / self.eval ARE the real global eval reached
    // through a browser-global alias — an evasion of exactly the kind a
    // naive "no eval(" scanner invites — and must match despite the '.'.
    [GeneratedRegex(@"(?<![\w.$])eval\s*\(|(?<![\w$])(?:window|globalThis|self)\.eval\s*\(")]
    private static partial Regex EvalPattern();

    [GeneratedRegex(@"(?:\bnew\s+Function\s*\(|(?<![\w.$])Function\s*\(\s*[""'])")]
    private static partial Regex FunctionConstructorPattern();

    [GeneratedRegex(@"(?:fetch|XMLHttpRequest|WebSocket)\s*\(\s*[""'](?<url>https?://[^""']+|wss?://[^""']+)[""']")]
    private static partial Regex NetworkCallPattern();

    [GeneratedRegex(@"\\[xu][0-9a-fA-F]{2,4}")]
    private static partial Regex HexOrUnicodeEscapePattern();
}
