import type { QuickJSContext, QuickJSRuntime } from "quickjs-emscripten";
import type { CapabilityHandler, CapabilityName } from "./capabilities";

/**
 * Wires exactly the granted capabilities' bridge functions into `context`'s
 * global scope, per docs/security/SANDBOX-DESIGN.md Section 4:
 *
 * - Every argument and return value crosses the boundary as a JSON string
 *   — decomposed to primitives on the way in, reconstructed from JSON on
 *   the way out. No live object, function, or closure reference ever
 *   crosses in either direction.
 * - A capability the host didn't pass a handler for simply has no
 *   corresponding property on `globalThis` in the guest — absence is the
 *   enforcement mechanism, not a runtime permission check inside a
 *   universally-available function.
 *
 * Two low-level bridge functions (`__hostCall` for sync, `__hostCallAsync`
 * for async) are installed once; the guest-visible `globalThis.<name>`
 * objects are a small generated shim built only from the granted
 * handlers' declared method names, evaluated once immediately after.
 */
export function installCapabilityBridge(
  runtime: QuickJSRuntime,
  context: QuickJSContext,
  handlers: readonly CapabilityHandler[],
): void {
  if (handlers.length === 0) return;

  const byCapability = new Map<CapabilityName, CapabilityHandler>(handlers.map((h) => [h.capability, h]));

  installSyncDispatcher(context, byCapability);
  installAsyncDispatcher(runtime, context, byCapability);
  evalShimOrThrow(context, buildGuestShim(handlers));
}

function installSyncDispatcher(context: QuickJSContext, byCapability: Map<CapabilityName, CapabilityHandler>): void {
  const handle = context.newFunction("__hostCall", (capabilityHandle, methodHandle, argsJsonHandle) => {
    const capability = context.getString(capabilityHandle) as CapabilityName;
    const method = context.getString(methodHandle);
    const handler = byCapability.get(capability);
    if (!handler?.call) {
      throw new Error(`Capability "${capability}" is not granted or does not support synchronous calls`);
    }
    const args = JSON.parse(context.getString(argsJsonHandle)) as unknown[];
    const result = handler.call(method, args);
    return context.newString(JSON.stringify(result === undefined ? null : result));
  });
  context.setProp(context.global, "__hostCall", handle);
  handle.dispose();
}

function installAsyncDispatcher(
  runtime: QuickJSRuntime,
  context: QuickJSContext,
  byCapability: Map<CapabilityName, CapabilityHandler>,
): void {
  const handle = context.newFunction("__hostCallAsync", (capabilityHandle, methodHandle, argsJsonHandle) => {
    const capability = context.getString(capabilityHandle) as CapabilityName;
    const method = context.getString(methodHandle);
    const argsJson = context.getString(argsJsonHandle);
    const deferred = context.newPromise();

    const handler = byCapability.get(capability);
    if (!handler?.callAsync) {
      const errorHandle = context.newError(`Capability "${capability}" is not granted or does not support asynchronous calls`);
      deferred.reject(errorHandle);
      errorHandle.dispose();
      queueMicrotask(() => runtime.executePendingJobs());
      return deferred.handle;
    }

    const args = JSON.parse(argsJson) as unknown[];
    handler
      .callAsync(method, args)
      .then((result) => {
        const resultHandle = context.newString(JSON.stringify(result === undefined ? null : result));
        deferred.resolve(resultHandle);
        resultHandle.dispose();
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        const errorHandle = context.newError(message);
        deferred.reject(errorHandle);
        errorHandle.dispose();
      })
      .finally(() => {
        runtime.executePendingJobs();
      });

    return deferred.handle;
  });
  context.setProp(context.global, "__hostCallAsync", handle);
  handle.dispose();
}

function evalShimOrThrow(context: QuickJSContext, shimSource: string): void {
  const result = context.evalCode(shimSource);
  if (result.error) {
    const dumped = context.dump(result.error);
    result.error.dispose();
    throw new Error(`Failed to install capability bridge shim: ${JSON.stringify(dumped)}`);
  }
  result.value.dispose();
}

function buildGuestShim(handlers: readonly CapabilityHandler[]): string {
  const namespaces = handlers.map((handler) => {
    const methodDefs = [
      ...(handler.syncMethods ?? []).map((method) => buildSyncMethod(handler.capability, method)),
      ...(handler.asyncMethods ?? []).map((method) => buildAsyncMethod(handler.capability, method)),
    ];
    return `globalThis[${JSON.stringify(handler.globalName)}] = { ${methodDefs.join(", ")} };`;
  });
  return namespaces.join("\n");
}

function buildSyncMethod(capability: CapabilityName, method: string): string {
  return `${JSON.stringify(method)}: function() {
    return JSON.parse(__hostCall(${JSON.stringify(capability)}, ${JSON.stringify(method)}, JSON.stringify(Array.prototype.slice.call(arguments))));
  }`;
}

function buildAsyncMethod(capability: CapabilityName, method: string): string {
  return `${JSON.stringify(method)}: function() {
    var argsJson = JSON.stringify(Array.prototype.slice.call(arguments));
    return __hostCallAsync(${JSON.stringify(capability)}, ${JSON.stringify(method)}, argsJson).then(function(json) {
      return JSON.parse(json);
    });
  }`;
}
