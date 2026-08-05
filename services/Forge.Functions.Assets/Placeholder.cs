namespace Forge.Functions.Assets;

/// <summary>
/// Image/audio/font/tileset processing (docs/SPEC.md Section 14.2), all
/// decoding in an isolated worker with no network egress and hard resource
/// caps, since input is untrusted. Milestone M6.
/// </summary>
public static class Placeholder
{
    public static void NotImplemented() =>
        throw new NotImplementedException("Forge.Functions.Assets: not implemented (Milestone M6)");
}
