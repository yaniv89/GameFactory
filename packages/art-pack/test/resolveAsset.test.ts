import { describe, expect, it } from "vitest";
import { PLACEHOLDER_ASSET_URL, resolveAsset, type AssetResolutionContext } from "../src/resolveAsset";

function emptyContext(overrides: Partial<AssetResolutionContext> = {}): AssetResolutionContext {
  return {
    projectOverrides: new Map(),
    projectAssets: new Map(),
    moduleBundledAssets: new Map(),
    ...overrides,
  };
}

describe("resolveAsset: docs/SPEC.md Section 11.4's five-tier priority order", () => {
  it("tier 5: falls through to the placeholder when nothing resolves", () => {
    const result = resolveAsset("tilesets/outdoor-base.png", emptyContext());
    expect(result.found).toBe(false);
    expect(result.source).toBe("placeholder");
    expect(result.url).toBe(PLACEHOLDER_ASSET_URL);
    expect(result.assetId).toBe("tilesets/outdoor-base.png");
  });

  it("tier 3: resolves from the active pack when it declares the path", () => {
    const context = emptyContext({
      activePackName: "@pixelfoundry/fantasy-pack",
      activePack: {
        baseUrl: "https://cdn.forge.dev/packs/@pixelfoundry/fantasy-pack/4.2.0",
        declaredPaths: new Set(["tilesets/outdoor-base.png"]),
      },
    });
    const result = resolveAsset("tilesets/outdoor-base.png", context);
    expect(result.found).toBe(true);
    expect(result.source).toBe("active-pack");
    expect(result.url).toBe("https://cdn.forge.dev/packs/@pixelfoundry/fantasy-pack/4.2.0/tilesets/outdoor-base.png");
  });

  it("tier 3 does not resolve a path the active pack doesn't declare — falls through to placeholder", () => {
    const context = emptyContext({
      activePackName: "@moonlit/scifi-pack",
      activePack: {
        baseUrl: "https://cdn.forge.dev/packs/@moonlit/scifi-pack/2.0.1",
        declaredPaths: new Set(["tilesets/interior.png"]), // no "props/well.png"
      },
    });
    const result = resolveAsset("props/well.png", context);
    expect(result.found).toBe(false);
    expect(result.source).toBe("placeholder");
  });

  it("tier 2 (project-uploaded asset) beats tier 3 (active pack)", () => {
    const context = emptyContext({
      activePackName: "@pixelfoundry/fantasy-pack",
      activePack: {
        baseUrl: "https://cdn.forge.dev/packs/@pixelfoundry/fantasy-pack/4.2.0",
        declaredPaths: new Set(["tilesets/outdoor-base.png"]),
      },
      projectAssets: new Map([["tilesets/outdoor-base.png", { baseUrl: "https://cdn.forge.dev/projects/proj-1/assets" }]]),
    });
    const result = resolveAsset("tilesets/outdoor-base.png", context);
    expect(result.found).toBe(true);
    expect(result.source).toBe("project-asset");
    expect(result.url).toBe("https://cdn.forge.dev/projects/proj-1/assets/tilesets/outdoor-base.png");
  });

  it("tier 1 (project override) beats every other tier", () => {
    const context = emptyContext({
      activePackName: "@pixelfoundry/fantasy-pack",
      activePack: {
        baseUrl: "https://cdn.forge.dev/packs/@pixelfoundry/fantasy-pack/4.2.0",
        declaredPaths: new Set(["tilesets/outdoor-base.png"]),
      },
      projectAssets: new Map([["tilesets/outdoor-base.png", { baseUrl: "https://cdn.forge.dev/projects/proj-1/assets" }]]),
      projectOverrides: new Map([
        ["@pixelfoundry/fantasy-pack/tilesets/outdoor-base.png", { baseUrl: "https://cdn.forge.dev/projects/proj-1/overrides/@pixelfoundry/fantasy-pack" }],
      ]),
    });
    const result = resolveAsset("tilesets/outdoor-base.png", context);
    expect(result.found).toBe(true);
    expect(result.source).toBe("project-override");
  });

  it("a project override is scoped to the active pack's own name — a different pack's override never matches", () => {
    const context = emptyContext({
      activePackName: "@moonlit/scifi-pack",
      projectOverrides: new Map([
        ["@pixelfoundry/fantasy-pack/tilesets/outdoor-base.png", { baseUrl: "https://cdn.forge.dev/projects/proj-1/overrides/@pixelfoundry/fantasy-pack" }],
      ]),
    });
    const result = resolveAsset("tilesets/outdoor-base.png", context);
    expect(result.found).toBe(false);
  });

  it("tier 4: resolves a module-bundled asset only when moduleName is passed", () => {
    const context = emptyContext({
      moduleBundledAssets: new Map([["@acme/weather-system/overlays/rain.png", { baseUrl: "https://cdn.forge.dev/modules/@acme/weather-system/1.0.0" }]]),
    });

    const withoutModule = resolveAsset("overlays/rain.png", context);
    expect(withoutModule.found).toBe(false);

    const withModule = resolveAsset("overlays/rain.png", context, "@acme/weather-system");
    expect(withModule.found).toBe(true);
    expect(withModule.source).toBe("module-bundled");
    expect(withModule.url).toBe("https://cdn.forge.dev/modules/@acme/weather-system/1.0.0/overlays/rain.png");
    expect(withModule.assetId).toBe("@acme/weather-system::overlays/rain.png");
  });

  it("tier 3 (active pack) still wins over tier 4 (module-bundled) when both apply", () => {
    const context = emptyContext({
      activePackName: "@pixelfoundry/fantasy-pack",
      activePack: {
        baseUrl: "https://cdn.forge.dev/packs/@pixelfoundry/fantasy-pack/4.2.0",
        declaredPaths: new Set(["overlays/rain.png"]),
      },
      moduleBundledAssets: new Map([["@acme/weather-system/overlays/rain.png", { baseUrl: "https://cdn.forge.dev/modules/@acme/weather-system/1.0.0" }]]),
    });
    const result = resolveAsset("overlays/rain.png", context, "@acme/weather-system");
    expect(result.source).toBe("active-pack");
  });

  it("every result carries a stable assetId, found or not, for logging/placeholder labeling", () => {
    const found = resolveAsset("audio/select.ogg", emptyContext({
      activePackName: "@pixelfoundry/fantasy-pack",
      activePack: { baseUrl: "https://cdn.forge.dev/x", declaredPaths: new Set(["audio/select.ogg"]) },
    }));
    const missing = resolveAsset("audio/select.ogg", emptyContext());
    expect(found.assetId).toBe("audio/select.ogg");
    expect(missing.assetId).toBe("audio/select.ogg");
  });
});
