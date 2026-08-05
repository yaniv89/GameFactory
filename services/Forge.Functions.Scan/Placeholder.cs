namespace Forge.Functions.Scan;

/// <summary>
/// Module publish security gates: static analysis, dependency audit,
/// sandboxed smoke run (docs/SPEC.md Section 10.4). Milestone M6.
/// Runs with zero network egress except Blob Storage, a hard 60s timeout,
/// a memory cap, and a fresh container per job — every job here processes
/// untrusted third-party code.
/// </summary>
public static class Placeholder
{
    public static void NotImplemented() =>
        throw new NotImplementedException("Forge.Functions.Scan: not implemented (Milestone M6)");
}
