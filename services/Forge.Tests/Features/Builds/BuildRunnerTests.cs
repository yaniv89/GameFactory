using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Forge.Functions.Build;
using Xunit;

namespace Forge.Tests.Features.Builds;

/// <summary>
/// Exercises <see cref="BuildRunner"/> against the real, compiled `forge`
/// CLI (docs/adr/0009's <c>packages/cli/dist/index.js</c>) — not a fake
/// standing in for the cross-language boundary this worker actually has,
/// the same rigor <see cref="Features.Scan.SmokeRunGateTests"/> already
/// established for gate 4's own subprocess.
///
/// Requires <c>pnpm --filter "forge..." run build</c> to have already
/// produced <c>packages/cli/dist/index.js</c> before this test class
/// runs — wired into the .NET CI job specifically for this (see
/// .github/workflows/ci.yml's dotnet-build-test job).
///
/// ⚠ Not run in this sandbox: no .NET SDK here. Verified when CI runs on
/// a GitHub-hosted runner.
/// </summary>
[Collection("Forge export pipeline")]
public sealed class BuildRunnerTests
{
    private static BuildRunnerOptions Options(int timeoutSeconds = 60, string nodeExecutablePath = "node") => new()
    {
        NodeExecutablePath = nodeExecutablePath,
        CliEntryPath = RepoPaths.Resolve("packages/cli/dist/index.js"),
        TimeoutSeconds = timeoutSeconds,
    };

    private static JsonElement MinimalValidDocument() => JsonSerializer.SerializeToElement(new
    {
        scenes = new[]
        {
            new { id = "village", name = "Village", entities = Array.Empty<object>(), tiles = Enumerable.Repeat(0, 300).ToArray() },
        },
        installedModules = new { },
    });

    [Fact]
    public async Task A_Real_Minimal_Project_Builds_To_A_Playable_Artifact_With_Real_Csp_Hashes()
    {
        var runner = new BuildRunner(Options());
        var artifact = await runner.RunAsync(new BuildRunRequest(Guid.NewGuid(), MinimalValidDocument()), CancellationToken.None);

        Assert.NotEmpty(artifact.IndexHtmlBytes);
        var html = Encoding.UTF8.GetString(artifact.IndexHtmlBytes);
        Assert.Contains("<script type=\"module\">", html, StringComparison.Ordinal);
        Assert.Contains("<style>", html, StringComparison.Ordinal);

        // A real sha256 is 32 bytes — proves these are genuine hashes,
        // not a placeholder/empty string that happened to satisfy a
        // weaker "is it non-null" assertion.
        Assert.Equal(32, Convert.FromBase64String(artifact.InlineScriptSha256Base64).Length);
        Assert.Equal(32, Convert.FromBase64String(artifact.InlineStyleSha256Base64).Length);

        // Recomputes the hash independently against the actual extracted
        // substrings (not BuildRunner's own extraction logic) — this is
        // the test's real assertion that the *stored* hash matches what
        // a browser would compute from the *actual* inline blocks, not
        // just "some 32-byte value came back."
        var scriptStart = html.IndexOf("<script type=\"module\">", StringComparison.Ordinal) + "<script type=\"module\">".Length;
        var scriptEnd = html.IndexOf("</script>", scriptStart, StringComparison.Ordinal);
        var scriptText = html[scriptStart..scriptEnd];
        Assert.Equal(Convert.ToBase64String(SHA256.HashData(Encoding.UTF8.GetBytes(scriptText))), artifact.InlineScriptSha256Base64);
    }

    [Fact]
    public async Task A_Document_With_No_Scenes_Is_A_Real_Failed_Verdict_Not_A_Harness_Failure()
    {
        var runner = new BuildRunner(Options());
        var emptyDocument = JsonSerializer.SerializeToElement(new { scenes = Array.Empty<object>(), installedModules = new { } });

        var ex = await Assert.ThrowsAsync<BuildFailedException>(
            () => runner.RunAsync(new BuildRunRequest(Guid.NewGuid(), emptyDocument), CancellationToken.None));

        // Real, attributable, and NOT a raw stack trace (Build.cs's own
        // doc comment on ErrorMessage) — Node's uncaught-exception
        // printer always includes "    at " stack frames; the extraction
        // in BuildRunner.ExtractErrorMessage is specifically what keeps
        // those out of what gets stored.
        Assert.Contains("scene", ex.Message, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("\n    at ", ex.Message, StringComparison.Ordinal);
    }

    [Fact]
    public async Task An_Unresolvable_Node_Executable_Is_A_Harness_Failure_Not_Attributed_To_The_Project()
    {
        var runner = new BuildRunner(Options(nodeExecutablePath: "definitely-not-a-real-node-binary-xyz"));

        await Assert.ThrowsAsync<BuildHarnessException>(
            () => runner.RunAsync(new BuildRunRequest(Guid.NewGuid(), MinimalValidDocument()), CancellationToken.None));
    }

    [Fact]
    public async Task Exceeding_The_Timeout_Is_A_Harness_Failure()
    {
        // A real, valid document and a real node binary — the only thing
        // forcing failure is a timeout too short for the process to ever
        // finish, proving the timeout path itself (not just "a bad
        // executable path fails fast").
        var runner = new BuildRunner(Options(timeoutSeconds: 0));

        var ex = await Assert.ThrowsAsync<BuildHarnessException>(
            () => runner.RunAsync(new BuildRunRequest(Guid.NewGuid(), MinimalValidDocument()), CancellationToken.None));

        Assert.Contains("timeout", ex.Message, StringComparison.OrdinalIgnoreCase);
    }
}
