import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearDevPreview, isValidDevPreviewSave, loadDevPreview, saveDevPreview, type DevPreviewSave } from "./devPreviewSave";

const SAMPLE: DevPreviewSave = {
  player: { Transform: { x: 10, y: 20, rotation: 0, scaleX: 1, scaleY: 1 }, Health: { current: 80, max: 100, invulnerableUntil: 0, flashUntil: 0 } },
  inventory: { coin: 3 },
  savedAt: "2026-08-20T00:00:00.000Z",
};

describe("devPreviewSave", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("round-trips a save through localStorage", () => {
    expect(loadDevPreview()).toBeNull();
    saveDevPreview(SAMPLE);
    expect(loadDevPreview()).toEqual(SAMPLE);
  });

  it("clearDevPreview removes a saved slot", () => {
    saveDevPreview(SAMPLE);
    clearDevPreview();
    expect(loadDevPreview()).toBeNull();
  });

  it("discards a corrupted stored value instead of throwing, and clears it so it can't strand future boots", () => {
    window.localStorage.setItem("forge:preview:dev-save:v1", "{not valid json");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(loadDevPreview()).toBeNull();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
    // Discarded, not left behind to fail again on the next boot.
    expect(window.localStorage.getItem("forge:preview:dev-save:v1")).toBeNull();
  });

  it("a later save overwrites an earlier one rather than merging", () => {
    saveDevPreview(SAMPLE);
    const updated: DevPreviewSave = { ...SAMPLE, inventory: { coin: 7 } };
    saveDevPreview(updated);
    expect(loadDevPreview()).toEqual(updated);
  });

  it("discards a value that parses as JSON but doesn't structurally match DevPreviewSave", () => {
    window.localStorage.setItem("forge:preview:dev-save:v1", JSON.stringify({ player: { Transform: { x: "not-a-number" } }, inventory: {}, savedAt: "now" }));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(loadDevPreview()).toBeNull();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
    expect(window.localStorage.getItem("forge:preview:dev-save:v1")).toBeNull();
  });
});

describe("isValidDevPreviewSave", () => {
  it("accepts a well-formed save", () => {
    expect(isValidDevPreviewSave(SAMPLE)).toBe(true);
  });

  it.each([
    ["not an object", "nope"],
    ["null", null],
    ["missing player", { inventory: {}, savedAt: "now" }],
    ["player with a non-numeric field", { player: { Transform: { x: "5" } }, inventory: {}, savedAt: "now" }],
    ["missing inventory", { player: {}, savedAt: "now" }],
    ["missing savedAt", { player: {}, inventory: {} }],
  ])("rejects %s", (_label, value) => {
    expect(isValidDevPreviewSave(value)).toBe(false);
  });
});
