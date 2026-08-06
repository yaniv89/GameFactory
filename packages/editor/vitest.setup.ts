import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => {
  cleanup();
});

/**
 * jsdom doesn't implement ResizeObserver (dockview-core uses it to react
 * to panel/container size changes). This is a test-environment shim —
 * the same category as jsdom itself standing in for a real browser — not
 * a stand-in for any of our own application logic.
 */
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
}
