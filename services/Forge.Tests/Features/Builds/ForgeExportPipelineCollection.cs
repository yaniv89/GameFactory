using Xunit;

namespace Forge.Tests.Features.Builds;

/// <summary>
/// <see cref="Forge.Functions.Build.BuildRunner"/> spawns the real
/// <c>forge export</c> CLI as a subprocess (docs/adr/0010 Decision 4) —
/// and that subprocess writes to a shared, non-isolated location:
/// <c>packages/player/src/generated/*.ts</c> (overwritten on every
/// invocation, ADR 0009's export.ts <c>writeGeneratedFiles</c>) and
/// <c>packages/player/dist-app/</c> (vite's own <c>outDir</c>, then
/// mutated in place by <c>inline-bundle.mjs</c>). Every test class that
/// constructs a real <see cref="Forge.Functions.Build.BuildRunner"/> —
/// <see cref="BuildRunnerTests"/>,
/// <see cref="Forge.Tests.Features.PlayOrigin.PublishedBuildE2ETests"/>,
/// <see cref="BuildOrchestratorTests"/> — has to share this one xUnit
/// collection, or xUnit's default cross-class parallelism runs two real
/// <c>forge export</c> subprocesses at once, each reading and writing
/// the other's in-flight <c>dist-app/assets/</c> and generated source
/// files. Caught for real on GitHub Actions CI, not by inspection: two
/// different runs of this same PR each failed a different one of these
/// three test classes with two different, otherwise-inexplicable
/// symptoms (<c>inline-bundle.mjs</c> finding two <c>.js</c> chunks
/// instead of one; a build's real, attributable-looking status turning
/// out <c>Failed</c> instead of <c>Ready</c>) — both were 0/3 reproducible
/// running the exact same CLI export locally, one process at a time,
/// which is exactly what a shared-directory race predicts and a
/// deterministic code defect does not.
///
/// No shared fixture object — this definition exists purely to opt these
/// classes out of xUnit's default cross-class parallelism.
/// </summary>
[CollectionDefinition("Forge export pipeline")]
public sealed class ForgeExportPipelineCollection;
