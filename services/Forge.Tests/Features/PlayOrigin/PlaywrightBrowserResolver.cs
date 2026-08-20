namespace Forge.Tests.Features.PlayOrigin;

/// <summary>
/// Resolves this specific development sandbox's own pre-installed
/// Chromium — <c>/opt/pw-browsers/chromium-*</c>, a fixed revision this
/// environment ships to avoid every tool re-downloading a browser. A
/// real GitHub Actions runner has none of this; it installs its own
/// browser via a real <c>playwright install</c> step
/// (.github/workflows/ci.yml's <c>dotnet-build-test</c> job), which
/// lands exactly where <c>Microsoft.Playwright</c>'s own default
/// resolution already looks — so this returns false there, and
/// <see cref="Features.PlayOrigin.PublishedBuildE2ETests"/> leaves
/// <c>BrowserTypeLaunchOptions.ExecutablePath</c> unset in that case
/// rather than pointing at a path that would never exist outside this
/// one sandbox.
/// </summary>
internal static class PlaywrightBrowserResolver
{
    private const string SandboxBrowsersRoot = "/opt/pw-browsers";

    public static bool TryResolveSandboxChromiumPath(out string executablePath)
    {
        executablePath = "";
        if (!Directory.Exists(SandboxBrowsersRoot)) return false;

        var chromiumDir = Directory.GetDirectories(SandboxBrowsersRoot, "chromium-*").FirstOrDefault();
        if (chromiumDir is null) return false;

        var candidate = Path.Combine(chromiumDir, "chrome-linux", "chrome");
        if (!File.Exists(candidate)) return false;

        executablePath = candidate;
        return true;
    }
}
