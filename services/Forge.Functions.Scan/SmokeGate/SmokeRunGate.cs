using System.Diagnostics;
using System.Text;
using System.Text.Json;

namespace Forge.Functions.Scan.SmokeGate;

/// <summary>
/// Thrown when the smoke-run harness itself fails to reach a verdict —
/// the CLI process couldn't start, produced unparseable output, reported
/// its own <c>harnessError</c>, or exceeded <see cref="SmokeGateOptions.TimeoutSeconds"/>.
/// Deliberately distinct from a <see cref="SmokeRunReport"/> whose
/// <c>Verdict</c> is "blocked" — that is this gate doing its job and
/// saying the bundle is bad. A <see cref="SmokeGateHarnessException"/>
/// says nothing about the bundle at all; the caller must retry or alert,
/// never write it into <c>PackageVersion.ScanStatus</c> as if it were a
/// real verdict.
/// </summary>
public sealed class SmokeGateHarnessException(string message, Exception? innerException = null)
    : Exception(message, innerException);

/// <summary>
/// docs/SPEC.md Section 10.4 gate 4, the .NET half. Spawns the real
/// sandboxed smoke-run CLI (packages/runtime-host/src/smoke/cli.ts,
/// built by that package's own build script to
/// dist/smoke/cli.bundle.mjs) as a subprocess, hands it the bundle over
/// stdin, and reads its JSON verdict back over stdout — the actual
/// cross-language isolation boundary cli.ts's own doc comment describes:
/// this process never evaluates any bundle content itself, only ever
/// reads back a verdict the sandboxed subprocess computed.
/// </summary>
public sealed class SmokeRunGate(SmokeGateOptions options)
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    public async Task<SmokeRunReport> RunAsync(SmokeRunRequest request, CancellationToken ct)
    {
        using var process = new Process
        {
            StartInfo = new ProcessStartInfo
            {
                FileName = options.NodeExecutablePath,
                ArgumentList = { options.CliBundlePath },
                RedirectStandardInput = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                StandardInputEncoding = Encoding.UTF8,
                StandardOutputEncoding = Encoding.UTF8,
                StandardErrorEncoding = Encoding.UTF8,
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
            throw new SmokeGateHarnessException(
                $"Failed to start the smoke-run CLI process ('{options.NodeExecutablePath} {options.CliBundlePath}'): {ex.Message}", ex);
        }

        // Started before writing stdin, not after: the child reads all of
        // stdin before producing any stdout (cli.ts's own contract), but
        // draining stdout/stderr concurrently rather than sequentially
        // after the write avoids any dependence on that ordering surviving
        // a future change to either side.
        var stdoutTask = process.StandardOutput.ReadToEndAsync(linkedCts.Token);
        var stderrTask = process.StandardError.ReadToEndAsync(linkedCts.Token);

        try
        {
            var stdinPayload = JsonSerializer.Serialize(request, JsonOptions);
            await process.StandardInput.WriteAsync(stdinPayload);
            process.StandardInput.Close();

            await process.WaitForExitAsync(linkedCts.Token);
        }
        catch (OperationCanceledException) when (timeoutCts.IsCancellationRequested)
        {
            TryKill(process);
            throw new SmokeGateHarnessException(
                $"Smoke run exceeded its {options.TimeoutSeconds}s hard timeout (docs/SPEC.md Section 10.4) for module \"{request.ModuleName}\"@{request.Version}.");
        }

        var stdout = await stdoutTask;
        var stderr = await stderrTask;

        return ParseVerdict(stdout, stderr, process.ExitCode, request);
    }

    private static SmokeRunReport ParseVerdict(string stdout, string stderr, int exitCode, SmokeRunRequest request)
    {
        JsonDocument document;
        try
        {
            document = JsonDocument.Parse(stdout);
        }
        catch (JsonException ex)
        {
            throw new SmokeGateHarnessException(
                $"Smoke-run CLI produced non-JSON stdout for \"{request.ModuleName}\"@{request.Version} (exit {exitCode}): {Truncate(stdout)}. stderr: {Truncate(stderr)}", ex);
        }

        using (document)
        {
            if (document.RootElement.TryGetProperty("harnessError", out var harnessErrorEl))
            {
                throw new SmokeGateHarnessException(
                    $"Smoke-run CLI harness failure for \"{request.ModuleName}\"@{request.Version}: {harnessErrorEl.GetString()}");
            }

            var report = document.RootElement.Deserialize<SmokeRunReport>(JsonOptions);
            if (report is null)
            {
                throw new SmokeGateHarnessException(
                    $"Smoke-run CLI produced an empty verdict for \"{request.ModuleName}\"@{request.Version} (exit {exitCode}).");
            }
            return report;
        }
    }

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

    private static string Truncate(string text, int max = 2000) =>
        text.Length <= max ? text : $"{text[..max]}... (truncated, {text.Length} chars total)";
}
