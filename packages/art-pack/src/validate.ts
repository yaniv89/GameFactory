import type {
  ArtPackAnimation,
  ArtPackAttribution,
  ArtPackAudio,
  ArtPackCharacterAnchor,
  ArtPackCharacters,
  ArtPackCharacterTemplate,
  ArtPackGrid,
  ArtPackManifest,
  ArtPackTileset,
  ArtPackUi,
  ArtPackUiFont,
} from "./manifest";

export interface ArtPackValidationResult {
  readonly ok: boolean;
  /** Present only when `ok` is true. */
  readonly manifest?: ArtPackManifest;
  /** Field path -> messages. Empty when `ok` is true. */
  readonly errors: Readonly<Record<string, string[]>>;
}

const SCOPED_NAME_PATTERN = /^@[a-z0-9-]+\/[a-z0-9-]+$/;
const SEMVER_LIKE_PATTERN = /^\d+\.\d+\.\d+(-[0-9A-Za-z-.]+)?(\+[0-9A-Za-z-.]+)?$/;
const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{3,8}$/;

/**
 * docs/SPEC.md Section 11.2's pack contract, validated against arbitrary
 * parsed JSON (a pack's `pack.json`, fetched from the registry or a
 * local upload) — the client/editor-side counterpart to
 * services/Forge.Api/Features/Registry/Publishing/ManifestValidator.cs's
 * server-side gate 1 check, not a replacement for it: this package has
 * no access to the request context that server-side check validates
 * against (the publishing account, the request's own declared
 * name/version/kind), so it only ever checks the manifest's own internal
 * shape and consistency.
 *
 * Deliberately hand-rolled rather than a schema-DSL library (Zod, per
 * CLAUDE.md Section 2.2, is reserved for module `configSchema` ->
 * runtime form generation, not general validation) — matching the same
 * explicit-function style ManifestValidator.cs and
 * packages/core/src/save/serialize.ts already use.
 */
export function validateArtPackManifest(data: unknown): ArtPackValidationResult {
  const errors: Record<string, string[]> = {};
  const addError = (field: string, message: string): void => {
    (errors[field] ??= []).push(message);
  };

  if (!isRecord(data)) {
    addError("manifest", "Must be a JSON object.");
    return { ok: false, errors };
  }

  const schemaVersion = data["schemaVersion"];
  if (!isPositiveInteger(schemaVersion)) {
    addError("schemaVersion", "Required and must be a positive integer.");
  }

  const name = data["name"];
  if (typeof name !== "string" || name.length === 0) {
    addError("name", "Required.");
  } else if (!SCOPED_NAME_PATTERN.test(name)) {
    addError("name", `'${name}' must be scoped, e.g. '@author/pack-name'.`);
  }

  const version = data["version"];
  if (typeof version !== "string" || version.length === 0) {
    addError("version", "Required.");
  } else if (!SEMVER_LIKE_PATTERN.test(version)) {
    addError("version", `'${version}' does not look like a semantic version.`);
  }

  const kind = data["kind"];
  if (kind !== "artpack") {
    addError("kind", `Must be 'artpack', got ${JSON.stringify(kind)}.`);
  }

  const engine = data["engine"];
  if (typeof engine !== "string" || engine.length === 0) {
    addError("engine", "Required.");
  }

  const grid = validateGrid(data["grid"], addError);

  const implementsField = data["implements"];
  if (!isNonEmptyStringArray(implementsField)) {
    addError("implements", "Required and must be a non-empty array of capability profile ids.");
  }

  const tilesets = validateTilesets(data["tilesets"], addError);

  let characters: ArtPackCharacters | undefined;
  if ("characters" in data && data["characters"] !== undefined) {
    characters = validateCharacters(data["characters"], addError);
  }

  let ui: ArtPackUi | undefined;
  if ("ui" in data && data["ui"] !== undefined) {
    ui = validateUi(data["ui"], addError);
  }

  let audio: ArtPackAudio | undefined;
  if ("audio" in data && data["audio"] !== undefined) {
    audio = validateAudio(data["audio"], addError);
  }

  const locales = data["locales"];
  if (!isNonEmptyStringArray(locales)) {
    addError("locales", "Required and must be a non-empty array of locale codes.");
  }

  let attribution: ArtPackAttribution | undefined;
  if ("attribution" in data && data["attribution"] !== undefined) {
    attribution = validateAttribution(data["attribution"], addError);
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    errors: {},
    manifest: {
      schemaVersion: schemaVersion as number,
      name: name as string,
      version: version as string,
      kind: "artpack",
      engine: engine as string,
      grid: grid!,
      implements: implementsField as readonly string[],
      tilesets: tilesets!,
      locales: locales as readonly string[],
      // exactOptionalPropertyTypes (tsconfig.base.json) forbids assigning
      // `undefined` to an optional property directly — these fields are
      // included only when actually present, never as an explicit
      // `key: undefined`.
      ...(characters !== undefined ? { characters } : {}),
      ...(ui !== undefined ? { ui } : {}),
      ...(audio !== undefined ? { audio } : {}),
      ...(attribution !== undefined ? { attribution } : {}),
    },
  };
}

function validateGrid(value: unknown, addError: (field: string, message: string) => void): ArtPackGrid | undefined {
  if (!isRecord(value)) {
    addError("grid", "Required and must be an object.");
    return undefined;
  }
  if (!isPositiveInteger(value["tileSize"])) {
    addError("grid.tileSize", "Required and must be a positive integer.");
  }
  let spriteSize: ArtPackGrid["spriteSize"];
  if ("spriteSize" in value && value["spriteSize"] !== undefined) {
    const s = value["spriteSize"];
    if (!isRecord(s) || !isPositiveInteger(s["width"]) || !isPositiveInteger(s["height"])) {
      addError("grid.spriteSize", "Must be an object with positive integer width/height.");
    } else {
      spriteSize = { width: s["width"] as number, height: s["height"] as number };
    }
  }
  return { tileSize: value["tileSize"] as number, ...(spriteSize !== undefined ? { spriteSize } : {}) };
}

function validateTilesets(
  value: unknown,
  addError: (field: string, message: string) => void,
): Readonly<Record<string, ArtPackTileset>> | undefined {
  if (!isRecord(value) || Object.keys(value).length === 0) {
    addError("tilesets", "Required and must be a non-empty object.");
    return undefined;
  }
  const result: Record<string, ArtPackTileset> = {};
  let ok = true;
  for (const [id, entry] of Object.entries(value)) {
    const field = `tilesets.${id}`;
    if (!isRecord(entry)) {
      addError(field, "Must be an object.");
      ok = false;
      continue;
    }
    const src = entry["src"];
    const columns = entry["columns"];
    const terrains = entry["terrains"];
    const autotile = entry["autotile"];
    if (typeof src !== "string" || src.length === 0) {
      addError(`${field}.src`, "Required.");
      ok = false;
    }
    if (!isPositiveInteger(columns)) {
      addError(`${field}.columns`, "Required and must be a positive integer.");
      ok = false;
    }
    if (!isNonEmptyStringArray(terrains)) {
      addError(`${field}.terrains`, "Required and must be a non-empty array of terrain tags.");
      ok = false;
    }
    if (autotile !== undefined && typeof autotile !== "string") {
      addError(`${field}.autotile`, "Must be a string.");
      ok = false;
    }
    if (typeof src === "string" && isPositiveInteger(columns) && isNonEmptyStringArray(terrains)) {
      result[id] = {
        src,
        columns,
        terrains,
        ...(typeof autotile === "string" ? { autotile } : {}),
      };
    }
  }
  return ok ? result : undefined;
}

function validateCharacters(value: unknown, addError: (field: string, message: string) => void): ArtPackCharacters | undefined {
  if (!isRecord(value)) {
    addError("characters", "Must be an object.");
    return undefined;
  }
  const template = validateCharacterTemplate(value["template"], addError);
  const sheets = value["sheets"];
  if (!isRecord(sheets) || Object.keys(sheets).length === 0) {
    addError("characters.sheets", "Required and must be a non-empty object of role id -> sheet path.");
    return undefined;
  }
  const sheetsOut: Record<string, string> = {};
  let ok = true;
  for (const [role, path] of Object.entries(sheets)) {
    if (typeof path !== "string" || path.length === 0) {
      addError(`characters.sheets.${role}`, "Must be a non-empty string path.");
      ok = false;
    } else {
      sheetsOut[role] = path;
    }
  }
  if (!template || !ok) return undefined;
  return { template, sheets: sheetsOut };
}

function validateCharacterTemplate(
  value: unknown,
  addError: (field: string, message: string) => void,
): ArtPackCharacterTemplate | undefined {
  if (!isRecord(value)) {
    addError("characters.template", "Required and must be an object.");
    return undefined;
  }
  const animations = value["animations"];
  if (!isRecord(animations) || Object.keys(animations).length === 0) {
    addError("characters.template.animations", "Required and must be a non-empty object.");
    return undefined;
  }
  const animationsOut: Record<string, ArtPackAnimation> = {};
  let ok = true;
  for (const [id, anim] of Object.entries(animations)) {
    const field = `characters.template.animations.${id}`;
    if (!isRecord(anim) || !isPositiveInteger(anim["frames"]) || !isPositiveNumber(anim["fps"]) || !isPositiveInteger(anim["directions"])) {
      addError(field, "Must be an object with positive frames/fps/directions.");
      ok = false;
      continue;
    }
    animationsOut[id] = {
      frames: anim["frames"] as number,
      fps: anim["fps"] as number,
      directions: anim["directions"] as number,
    };
  }
  const anchor = value["anchor"];
  let anchorOut: ArtPackCharacterAnchor | undefined;
  if (!isRecord(anchor) || typeof anchor["x"] !== "number" || typeof anchor["y"] !== "number") {
    addError("characters.template.anchor", "Required and must be an object with numeric x/y.");
    ok = false;
  } else {
    anchorOut = { x: anchor["x"], y: anchor["y"] };
  }
  if (!ok) return undefined;
  return { animations: animationsOut, anchor: anchorOut! };
}

function validateUi(value: unknown, addError: (field: string, message: string) => void): ArtPackUi | undefined {
  if (!isRecord(value)) {
    addError("ui", "Must be an object.");
    return undefined;
  }
  let ok = true;
  const skin = value["skin"];
  if (typeof skin !== "string" || skin.length === 0) {
    addError("ui.skin", "Required.");
    ok = false;
  }

  const font = value["font"];
  let fontOut: ArtPackUiFont | undefined;
  if (
    !isRecord(font) ||
    typeof font["family"] !== "string" ||
    font["family"].length === 0 ||
    !isPositiveNumber(font["baseSize"]) ||
    !isPositiveNumber(font["lineHeight"])
  ) {
    addError("ui.font", "Required and must declare a non-empty family plus positive baseSize/lineHeight.");
    ok = false;
  } else {
    fontOut = { family: font["family"], baseSize: font["baseSize"], lineHeight: font["lineHeight"] };
  }

  const palette = value["palette"];
  if (!isRecord(palette) || Object.keys(palette).length === 0) {
    addError("ui.palette", "Required and must be a non-empty object.");
    ok = false;
  } else {
    for (const [token, color] of Object.entries(palette)) {
      if (typeof color !== "string" || !HEX_COLOR_PATTERN.test(color)) {
        addError(`ui.palette.${token}`, `'${String(color)}' is not a hex color.`);
        ok = false;
      }
    }
  }

  if (!ok) return undefined;
  return { skin: skin as string, font: fontOut!, palette: palette as Record<string, string> };
}

function validateAudio(value: unknown, addError: (field: string, message: string) => void): ArtPackAudio | undefined {
  if (!isRecord(value)) {
    addError("audio", "Must be an object.");
    return undefined;
  }
  const sfx = "sfx" in value ? value["sfx"] : undefined;
  const music = "music" in value ? value["music"] : undefined;
  let ok = true;
  if (sfx !== undefined && !isStringRecord(sfx)) {
    addError("audio.sfx", "Must be an object of id -> file path.");
    ok = false;
  }
  if (music !== undefined && !isStringRecord(music)) {
    addError("audio.music", "Must be an object of id -> file path.");
    ok = false;
  }
  const hasSfx = isStringRecord(sfx) && Object.keys(sfx).length > 0;
  const hasMusic = isStringRecord(music) && Object.keys(music).length > 0;
  if (!hasSfx && !hasMusic) {
    addError("audio", "Must declare at least one non-empty sfx or music entry.");
    ok = false;
  }
  if (!ok) return undefined;
  return {
    ...(isStringRecord(sfx) ? { sfx } : {}),
    ...(isStringRecord(music) ? { music } : {}),
  };
}

function validateAttribution(value: unknown, addError: (field: string, message: string) => void): ArtPackAttribution | undefined {
  if (!isRecord(value) || typeof value["required"] !== "boolean" || typeof value["text"] !== "string") {
    addError("attribution", "Must be an object with a boolean 'required' and a string 'text'.");
    return undefined;
  }
  if (value["required"] && value["text"].length === 0) {
    addError("attribution.text", "Required when attribution.required is true.");
    return undefined;
  }
  return { required: value["required"], text: value["text"] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function isPositiveNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isNonEmptyStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.length > 0 && value.every((v) => typeof v === "string" && v.length > 0);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((v) => typeof v === "string" && v.length > 0);
}
