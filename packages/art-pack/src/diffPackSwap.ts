import type { ArtPackManifest } from "./manifest";

export type PackSwapSeverity = "ok" | "warn" | "fail";

export interface PackSwapFinding {
  readonly severity: PackSwapSeverity;
  /** Terse, single-line summary — matches docs/SPEC.md Section 11.5's own example output style. */
  readonly message: string;
  /** Second line explaining the practical consequence, when there is one worth stating (Section 11.5's "Scenes will be rescaled." / "Timing will be resampled." / "These will render as placeholders until remapped."). */
  readonly detail?: string;
}

export interface PackSwapDiffResult {
  readonly findings: readonly PackSwapFinding[];
  readonly hasFailures: boolean;
  /**
   * The terrain tags `source` uses that `target` doesn't declare at
   * all — the same set the terrain FAIL finding's message summarizes in
   * prose, exposed structured for a "remap manually" UI that needs to
   * act on the actual tags, not parse them back out of a sentence.
   */
  readonly missingTerrains: readonly string[];
  /** Every terrain tag `target` itself declares — what a manual remap can substitute in. */
  readonly targetTerrains: readonly string[];
}

/**
 * docs/SPEC.md Section 11.5's compatibility diff — "the single most
 * demo-able feature of the entire platform." Compares `source` (the
 * currently active pack) against `target` (the one a creator is
 * considering switching to) and reports what maps cleanly, what will be
 * rescaled/resampled, and what has no equivalent at all.
 *
 * ⚠ Approximates "what the project actually uses" as "everything
 * `source` declares" — the honest choice available today, not a claim
 * of full accuracy. The real spec model (docs/SPEC.md Section 7.4's
 * `tilesetRef`/scene-level asset references) would scan actual scene
 * content for which specific tiles/sheets a project references, but
 * that per-scene reference tracking doesn't exist yet (this repo's
 * scenes still use a flat numeric tile-id palette, not pack-relative
 * references — see packages/editor/src/canvas/SceneCanvas.tsx's own
 * scope notes). Diffing against everything the source pack declares is
 * a conservative superset of real usage: it can flag a tile as "no
 * equivalent" that a specific project never actually painted, but it
 * will never miss a real incompatibility by under-counting. Swap this
 * for real per-scene usage once that tracking exists.
 */
export function diffPackSwap(source: ArtPackManifest, target: ArtPackManifest): PackSwapDiffResult {
  const findings: PackSwapFinding[] = [];

  const missingTerrains = diffTerrains(source, target, findings);

  if (source.grid.tileSize !== target.grid.tileSize) {
    findings.push({
      severity: "warn",
      message: `Tile size differs (${source.grid.tileSize} -> ${target.grid.tileSize})`,
      detail: "Scenes will be rescaled.",
    });
  }

  diffCharacterSheets(source, target, findings);
  diffAnimations(source, target, findings);

  return {
    findings,
    hasFailures: findings.some((f) => f.severity === "fail"),
    missingTerrains,
    targetTerrains: Array.from(collectTerrains(target)).sort(),
  };
}

function diffTerrains(source: ArtPackManifest, target: ArtPackManifest, findings: PackSwapFinding[]): readonly string[] {
  const sourceTerrains = Array.from(collectTerrains(source));
  const targetTerrains = collectTerrains(target);
  const matched = sourceTerrains.filter((tag) => targetTerrains.has(tag));
  const missing = sourceTerrains.filter((tag) => !targetTerrains.has(tag));

  if (matched.length > 0) {
    findings.push({ severity: "ok", message: `${matched.length} ${pluralize(matched.length, "tile")} map by terrain tag` });
  }
  if (missing.length > 0) {
    findings.push({
      severity: "fail",
      message: `${missing.length} ${pluralize(missing.length, "prop")} ${conjugate(missing.length, "have")} no equivalent: ${quoteList(missing)}`,
      detail: "These will render as placeholders until remapped.",
    });
  }
  return missing;
}

function diffCharacterSheets(source: ArtPackManifest, target: ArtPackManifest, findings: PackSwapFinding[]): void {
  const sourceSheets = source.characters ? Object.keys(source.characters.sheets) : [];
  if (sourceSheets.length === 0) return; // nothing to compare — source declares no character sheets at all.
  const targetSheets = new Set(target.characters ? Object.keys(target.characters.sheets) : []);
  const matched = sourceSheets.filter((role) => targetSheets.has(role));
  const missing = sourceSheets.filter((role) => !targetSheets.has(role));

  if (matched.length > 0) {
    findings.push({ severity: "ok", message: `${matched.length} character ${pluralize(matched.length, "sheet")} map by role tag` });
  }
  if (missing.length > 0) {
    findings.push({
      severity: "fail",
      message: `${missing.length} character ${pluralize(missing.length, "sheet")} ${conjugate(missing.length, "have")} no equivalent: ${quoteList(missing)}`,
      detail: "These will render as placeholders until remapped.",
    });
  }
}

function diffAnimations(source: ArtPackManifest, target: ArtPackManifest, findings: PackSwapFinding[]): void {
  if (!source.characters) return;
  const sourceAnimations = source.characters.template.animations;
  const targetAnimations = target.characters?.template.animations ?? {};

  const missing: string[] = [];
  for (const [name, sourceAnim] of Object.entries(sourceAnimations)) {
    const targetAnim = targetAnimations[name];
    if (!targetAnim) {
      missing.push(name);
      continue;
    }
    if (targetAnim.frames !== sourceAnim.frames) {
      findings.push({
        severity: "warn",
        message: `'${name}' animation has ${targetAnim.frames} frames in target, ${sourceAnim.frames} in source`,
        detail: "Timing will be resampled.",
      });
    }
  }

  if (missing.length > 0) {
    findings.push({
      severity: "fail",
      message: `${missing.length} ${pluralize(missing.length, "animation")} ${conjugate(missing.length, "have")} no equivalent: ${quoteList(missing)}`,
      detail: "These will be skipped until remapped.",
    });
  }
}

function collectTerrains(manifest: ArtPackManifest): Set<string> {
  const terrains = new Set<string>();
  for (const tileset of Object.values(manifest.tilesets)) {
    for (const terrain of tileset.terrains) terrains.add(terrain);
  }
  return terrains;
}

function pluralize(count: number, singular: string): string {
  return count === 1 ? singular : `${singular}s`;
}

/** `have` -> `has` for a singular count — the plural form is used verbatim as-is. */
function conjugate(count: number, pluralVerb: "have"): string {
  return count === 1 ? "has" : pluralVerb;
}

function quoteList(values: readonly string[]): string {
  return values.map((value) => `'${value}'`).join(", ");
}
