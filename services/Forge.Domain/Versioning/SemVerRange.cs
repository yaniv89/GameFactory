namespace Forge.Domain.Versioning;

/// <summary>
/// A dependency/engine version range as it appears throughout
/// docs/SPEC.md (Section 7.3's <c>"engine": "^2.4.0"</c>, Section 7.6's
/// <c>"@acme/weather-system": "~0.9.4"</c>, Section 11.2's
/// <c>"engine": ">=2.0.0 &lt;3.0.0"</c>) — a space-separated AND of
/// comparators, where <c>^</c> and <c>~</c> are shorthand for a
/// <c>&gt;=</c>/<c>&lt;</c> pair per the same semantics npm's ranges use,
/// and a bare version (no operator) matches that version exactly.
///
/// Deliberately not the full npm range grammar: no <c>||</c> (OR) sets,
/// no partial versions (<c>^1</c>, <c>~1.2</c>), no <c>x</c>/<c>*</c>
/// wildcards. Every range this registry itself ever generates or asks a
/// publisher to declare is a plain AND of full-triple comparators or a
/// single <c>^</c>/<c>~</c> shorthand — adding syntax nothing in this
/// codebase produces or needs would be exactly the kind of speculative
/// generality CLAUDE.md's guardrails bar.
/// </summary>
public sealed class SemVerRange
{
    private readonly IReadOnlyList<Comparator> _comparators;

    private SemVerRange(IReadOnlyList<Comparator> comparators, string raw)
    {
        _comparators = comparators;
        Raw = raw;
    }

    public string Raw { get; }

    public static bool TryParse(string input, out SemVerRange? range)
    {
        range = null;
        var trimmed = input.Trim();
        if (trimmed.Length == 0) return false;

        var comparators = new List<Comparator>();
        foreach (var token in trimmed.Split(' ', StringSplitOptions.RemoveEmptyEntries))
        {
            if (!TryParseToken(token, comparators)) return false;
        }
        if (comparators.Count == 0) return false;

        range = new SemVerRange(comparators, trimmed);
        return true;
    }

    public static SemVerRange Parse(string input) =>
        TryParse(input, out var range) ? range! : throw new FormatException($"'{input}' is not a valid version range.");

    private static bool TryParseToken(string token, List<Comparator> comparators)
    {
        if (token.StartsWith('^'))
        {
            if (!SemVer.TryParse(token[1..], out var v) || v is null) return false;
            var upper = v.Major > 0
                ? new SemVer(v.Major + 1, 0, 0)
                : v.Minor > 0
                    ? new SemVer(0, v.Minor + 1, 0)
                    : new SemVer(0, 0, v.Patch + 1);
            comparators.Add(new Comparator(ComparisonOp.GreaterOrEqual, v));
            comparators.Add(new Comparator(ComparisonOp.LessThan, upper));
            return true;
        }

        if (token.StartsWith('~'))
        {
            if (!SemVer.TryParse(token[1..], out var v) || v is null) return false;
            var upper = new SemVer(v.Major, v.Minor + 1, 0);
            comparators.Add(new Comparator(ComparisonOp.GreaterOrEqual, v));
            comparators.Add(new Comparator(ComparisonOp.LessThan, upper));
            return true;
        }

        foreach (var (prefix, op) in OperatorPrefixes)
        {
            if (!token.StartsWith(prefix, StringComparison.Ordinal)) continue;
            if (!SemVer.TryParse(token[prefix.Length..], out var v) || v is null) return false;
            comparators.Add(new Comparator(op, v));
            return true;
        }

        if (SemVer.TryParse(token, out var exact) && exact is not null)
        {
            comparators.Add(new Comparator(ComparisonOp.Equal, exact));
            return true;
        }

        return false;
    }

    // Longer prefixes first so ">=" isn't matched as ">" with a stray "=".
    private static readonly (string Prefix, ComparisonOp Op)[] OperatorPrefixes =
    [
        (">=", ComparisonOp.GreaterOrEqual),
        ("<=", ComparisonOp.LessOrEqual),
        (">", ComparisonOp.GreaterThan),
        ("<", ComparisonOp.LessThan),
        ("=", ComparisonOp.Equal),
    ];

    public bool IsSatisfiedBy(SemVer version) => _comparators.All(c => c.IsSatisfiedBy(version));

    public override string ToString() => Raw;

    private enum ComparisonOp
    {
        Equal,
        GreaterThan,
        GreaterOrEqual,
        LessThan,
        LessOrEqual,
    }

    private readonly record struct Comparator(ComparisonOp Op, SemVer Version)
    {
        public bool IsSatisfiedBy(SemVer v) => Op switch
        {
            ComparisonOp.Equal => v == Version,
            ComparisonOp.GreaterThan => v > Version,
            ComparisonOp.GreaterOrEqual => v >= Version,
            ComparisonOp.LessThan => v < Version,
            ComparisonOp.LessOrEqual => v <= Version,
            _ => throw new InvalidOperationException($"Unhandled comparison operator {Op}."),
        };
    }
}
