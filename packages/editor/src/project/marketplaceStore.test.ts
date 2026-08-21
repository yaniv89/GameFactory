import { beforeEach, describe, expect, it, vi } from "vitest";
import * as marketplaceApi from "../api/marketplaceApi";
import type { MarketplaceInstallable, PackageDetail } from "../api/marketplaceApi";
import { ApiError } from "../api/httpClient";
import { useProjectStore } from "../store/projectStore";
import { useMarketplaceStore } from "./marketplaceStore";
import { useProjectSyncStore } from "./projectSyncStore";

vi.mock("../api/marketplaceApi", () => ({
  listPackages: vi.fn(),
  getPackage: vi.fn(),
  listReviews: vi.fn(),
  upsertReview: vi.fn(),
  deleteReview: vi.fn(),
  listLicenses: vi.fn(),
  createCheckoutSession: vi.fn(),
  getInstallEligibility: vi.fn(),
}));

const DETAIL: PackageDetail = {
  id: "p1",
  name: "@acme/loot-tables",
  kind: "module",
  authorUserId: "author-1",
  displayName: "Loot Tables",
  summary: "Configurable drop tables for any enemy.",
  readmeMarkdown: undefined,
  homepageUrl: undefined,
  licenseSpdx: "MIT",
  isDeprecated: false,
  createdAt: "2026-01-01T00:00:00Z",
  averageRating: undefined,
  reviewCount: 0,
  pricingModel: "free",
  priceCents: 0,
};

const ELIGIBLE: MarketplaceInstallable = {
  packageName: "@acme/loot-tables",
  version: "1.2.0",
  manifest: {
    configSchema: {
      type: "object",
      properties: { dropRate: { type: "number", default: 0.2 } },
      required: ["dropRate"],
    },
  },
  bundleUrl: "https://cdn.forge.dev/packages/@acme/loot-tables/1.2.0/bundle.js",
  bundleSha256Hex: "deadbeef",
};

describe("useMarketplaceStore.install", () => {
  beforeEach(() => {
    vi.mocked(marketplaceApi.getInstallEligibility).mockReset();
    useMarketplaceStore.setState({
      selectedName: "@acme/loot-tables",
      detail: DETAIL,
      installing: false,
      installError: undefined,
      installedManifests: {},
    });
    useProjectSyncStore.setState({ projectId: "project-1" });
    useProjectStore.setState({ document: { scenes: [], installedModules: {}, activePack: undefined, packOverrides: {}, packTerrainRemap: {}, graphs: {}, quests: {}, dataTables: {} }, past: [], future: [] });
  });

  it("resolves eligibility, installs with the pinned version/bundle URL, and caches the manifest for display", async () => {
    vi.mocked(marketplaceApi.getInstallEligibility).mockResolvedValueOnce(ELIGIBLE);

    await useMarketplaceStore.getState().install();

    expect(marketplaceApi.getInstallEligibility).toHaveBeenCalledWith("project-1", "@acme/loot-tables");
    expect(useProjectStore.getState().document.installedModules["@acme/loot-tables"]).toEqual({
      config: { dropRate: 0.2 },
      marketplace: { version: "1.2.0", bundleUrl: ELIGIBLE.bundleUrl, bundleSha256Hex: ELIGIBLE.bundleSha256Hex },
    });
    expect(useMarketplaceStore.getState().installing).toBe(false);
    expect(useMarketplaceStore.getState().installError).toBeUndefined();
    expect(useMarketplaceStore.getState().installedManifests["@acme/loot-tables"]).toEqual({
      name: "@acme/loot-tables",
      summary: DETAIL.summary,
      configSchema: ELIGIBLE.manifest && (ELIGIBLE.manifest as { configSchema: unknown }).configSchema,
    });
  });

  it("installs with an empty config when the manifest declares no configSchema (e.g. a dialogue-shaped module)", async () => {
    vi.mocked(marketplaceApi.getInstallEligibility).mockResolvedValueOnce({ ...ELIGIBLE, manifest: {} });

    await useMarketplaceStore.getState().install();

    expect(useProjectStore.getState().document.installedModules["@acme/loot-tables"]!.config).toEqual({});
  });

  it("is a no-op when no project is open", async () => {
    useProjectSyncStore.setState({ projectId: undefined });

    await useMarketplaceStore.getState().install();

    expect(marketplaceApi.getInstallEligibility).not.toHaveBeenCalled();
  });

  it("is a no-op when the module is already installed", async () => {
    useProjectStore.setState({
      document: {
        scenes: [],
        installedModules: { "@acme/loot-tables": { config: { dropRate: 0.5 } } },
        activePack: undefined,
        packOverrides: {},
        packTerrainRemap: {},
        graphs: {},
        quests: {},
        dataTables: {},
      },
    });

    await useMarketplaceStore.getState().install();

    expect(marketplaceApi.getInstallEligibility).not.toHaveBeenCalled();
  });

  it("surfaces a purchase-required error and leaves installing false", async () => {
    vi.mocked(marketplaceApi.getInstallEligibility).mockRejectedValueOnce(new ApiError("Purchase required", 403, undefined));

    await useMarketplaceStore.getState().install();

    expect(useMarketplaceStore.getState().installing).toBe(false);
    expect(useMarketplaceStore.getState().installError).toBe("Purchase required");
    expect(useProjectStore.getState().document.installedModules["@acme/loot-tables"]).toBeUndefined();
  });
});
