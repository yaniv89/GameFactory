using System.Diagnostics;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace Forge.Functions.Build;

/// <summary>What a claimed <see cref="Domain.Entities.Build"/> needs to actually build — the project's identity plus its committed revision's document, straight from <c>project_revisions.doc</c> (docs/adr/0010 Decision 4). No module-version/engine-version/guest-bundle resolution happens here: the real <c>forge export --document</c> CLI already does all of that itself (ADR 0009's <c>resolvePackageVersion</c> for a first-party module, reading from the same <c>packages/player</c> <c>node_modules</c> this worker's own subprocess runs against; a real HTTP fetch against the package registry's own CDN, hash-verified, for a marketplace-installed one) — this worker never needs its own copy of that logic, it just spawns the CLI and reads its exit code/output.</summary>
public sealed record BuildRunRequest(Guid ProjectId, JsonElement Document);

/// <summary>The real, playable output of a successful build — <c>index.html</c>'s raw bytes plus the two CSP hash sources the play-origin (Forge.Play, C4) needs to serve it under a real Content-Security-Policy with neither <c>script-src</c> nor <c>style-src</c> ever carrying `unsafe-inline` (docs/adr/0010 Decision 6).</summary>
public sealed record BuiltGameArtifact(byte[] IndexHtmlBytes, string InlineScriptSha256Base64, string InlineStyleSha256Base64);

/// <summary>
/// Thrown when the build harness itself fails to reach a verdict — the
/// CLI process couldn't start, exceeded its timeout, or exited 0 but
/// produced no <c>index.html</c> (a broken environment/template, not a
/// bad project). Deliberately distinct from <see cref="BuildFailedException"/>:
/// this says nothing about whether the project itself is buildable, so
/// the caller (<see cref="BuildOrchestrator"/>) requeues rather than
/// marking the build <see cref="Domain.Entities.BuildStatus.Failed"/> —
/// same harness-vs-verdict distinction
/// <c>Forge.Functions.Scan.SmokeGate.SmokeGateHarnessException</c>
/// already draws for gate 4.
/// </summary>
public sealed class BuildHarnessException(string message, Exception? innerException = null) : Exception(message, innerException);

/// <summary>Thrown when the CLI ran to completion and genuinely refused to build this project — a real, attributable verdict (a license the project's installed modules can't satisfy, a malformed document). <see cref="Exception.Message"/> is already the CLI's own cleaned error text, safe to store verbatim as <see cref="Domain.Entities.Build.ErrorMessage"/>.</summary>
public sealed class BuildFailedException(string message) : Exception(message);

/// <summary>
/// docs/adr/0010 Decision 4, the .NET half. Spawns the real, compiled
/// `forge export --document` CLI (packages/cli/dist/index.js, ADR 0009)
/// as a subprocess — file-based I/O, not the JSON-over-stdio protocol
/// <c>SmokeRunGate</c> uses for gate 4, because this subprocess's output
/// (a built <c>index.html</c> embedding the QuickJS WASM binary as
/// base64) can run to low-single-digit megabytes, not a small JSON
/// verdict a pipe is a good fit for.
/// </summary>
public sealed class BuildRunner(BuildRunnerOptions options)
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    // Matches inline-bundle.mjs's own, exact output shape: a single
    // `<script type="module">...</script>` tag with no other attributes
    // (real, confirmed against a real built dist-app/index.html before
    // writing this, not assumed) and a single, unmodified `<style>...</style>`
    // block from packages/player/index.html's own static template
    // (docs/adr/0010's own Context section already establishes vite
    // build passes that block through byte-for-byte). Singleline so `.`
    // spans the embedded newlines a real bundle/stylesheet has.
    private static readonly Regex InlineScriptPattern = new("""<script type="module">(.*?)</script>""", RegexOptions.Singleline | RegexOptions.Compiled);
    private static readonly Regex InlineStylePattern = new("""<style>(.*?)</style>""", RegexOptions.Singleline | RegexOptions.Compiled);

    public async Task<BuiltGameArtifact> RunAsync(BuildRunRequest request, CancellationToken ct)
    {
        var workDir = Directory.CreateTempSubdirectory("forge-build-");
        try
        {
            var documentPath = Path.Combine(workDir.FullName, "project.json");
            var outDir = Path.Combine(workDir.FullName, "out");

            var exportFileJson = JsonSerializer.Serialize(
                new { projectId = request.ProjectId.ToString(), document = request.Document }, JsonOptions);
            await File.WriteAllTextAsync(documentPath, exportFileJson, ct);

            using var process = new Process
            {
                StartInfo = new ProcessStartInfo
                {
                    FileName = options.NodeExecutablePath,
                    ArgumentList = { options.CliEntryPath, "export", "--document", documentPath, "--out", outDir },
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    UseShellExecute = false,
                    CreateNoWindow = true,
                },
            };

            using var timeoutCts = new CancellationTokenSource(TimeSpan.FromSeconds(options.TimeoutSeconds));
            using var linkedCts = CancellationTokenSource.CreateLinkedTokenSource(ct, timeoutCts.Token);

            try
            {
                process.Start();
            }
            catch (Exception ex) when (ex is InvalidOperationException or System.ComponentModel.Win32Exception)
            {
                throw new BuildHarnessException(
                    $"Failed to start the forge export CLI process ('{options.NodeExecutablePath} {options.CliEntryPath} export --document {documentPath} --out {outDir}') for project {request.ProjectId}: {ex.Message}", ex);
            }

            var stdoutTask = process.StandardOutput.ReadToEndAsync(linkedCts.Token);
            var stderrTask = process.StandardError.ReadToEndAsync(linkedCts.Token);

            try
            {
                await process.WaitForExitAsync(linkedCts.Token);
            }
            catch (OperationCanceledException) when (timeoutCts.IsCancellationRequested)
            {
                TryKill(process);
                throw new BuildHarnessException(
                    $"forge export exceeded its {options.TimeoutSeconds}s timeout for project {request.ProjectId}.");
            }

            var stdout = await stdoutTask;
            var stderr = await stderrTask;

            if (process.ExitCode != 0)
            {
                throw new BuildFailedException(ExtractErrorMessage(stderr, stdout));
            }

            var indexHtmlPath = Path.Combine(outDir, "index.html");
            if (!File.Exists(indexHtmlPath))
            {
                throw new BuildHarnessException(
                    $"forge export exited 0 but produced no index.html at '{indexHtmlPath}' for project {request.ProjectId}. stdout: {Truncate(stdout)}");
            }

            var indexHtmlBytes = await File.ReadAllBytesAsync(indexHtmlPath, ct);
            var html = Encoding.UTF8.GetString(indexHtmlBytes);

            var scriptMatch = InlineScriptPattern.Match(html);
            if (!scriptMatch.Success)
            {
                throw new BuildHarnessException(
                    $"forge export's index.html for project {request.ProjectId} has no inline <script type=\"module\"> block — inline-bundle.mjs's own output shape must have changed underneath this extraction.");
            }
            var styleMatch = InlineStylePattern.Match(html);
            if (!styleMatch.Success)
            {
                throw new BuildHarnessException(
                    $"forge export's index.html for project {request.ProjectId} has no inline <style> block — packages/player/index.html's own template must have changed underneath this extraction.");
            }

            return new BuiltGameArtifact(
                indexHtmlBytes,
                Sha256Base64(scriptMatch.Groups[1].Value),
                Sha256Base64(styleMatch.Groups[1].Value));
        }
        finally
        {
            try
            {
                workDir.Delete(recursive: true);
            }
            catch (IOException)
            {
                // Best-effort cleanup of a process-local temp directory —
                // not the build's actual output (already read into
                // memory above by this point), so a leftover directory
                // here costs disk, not correctness.
            }
        }
    }

    /// <summary>
    /// CSP's own hashing rule: base64(SHA-256(exact UTF-8 bytes of the
    /// element's text content)) — no tag markup included, which is
    /// exactly what the regex capture groups above already isolate.
    /// </summary>
    private static string Sha256Base64(string content) =>
        Convert.ToBase64String(SHA256.HashData(Encoding.UTF8.GetBytes(content)));

    private static void TryKill(Process process)
    {
        try
        {
            if (!process.HasExited) process.Kill(entireProcessTree: true);
        }
        catch (InvalidOperationException)
        {
            // Expected race: the process exited on its own between the
            // HasExited check and Kill() — nothing left to clean up.
        }
    }

    /// <summary>
    /// Node's default uncaught-exception printer writes the error's
    /// message line(s) followed by a `    at ...` stack trace —
    /// packages/cli's own thrown errors (bad document, disallowed
    /// license) are single-line messages via a plain `throw new
    /// Error(...)`, never caught inside the CLI itself. Keeping only the
    /// lines before the first stack frame avoids storing a raw stack
    /// trace as Build.ErrorMessage (Build.cs's own doc comment on why),
    /// while still surfacing the real, actionable message.
    /// </summary>
    private static string ExtractErrorMessage(string stderr, string stdout)
    {
        var messageLines = stderr
            .Split('\n')
            .TakeWhile(line => !line.TrimStart().StartsWith("at ", StringComparison.Ordinal))
            .Select(line => line.Trim())
            .Where(line => line.Length > 0)
            .ToArray();

        if (messageLines.Length > 0) return string.Join(" ", messageLines);
        return string.IsNullOrWhiteSpace(stdout)
            ? "forge export exited with a non-zero status and produced no error message."
            : Truncate(stdout);
    }

    private static string Truncate(string text, int max = 2000) =>
        text.Length <= max ? text : $"{text[..max]}... (truncated, {text.Length} chars total)";
}
