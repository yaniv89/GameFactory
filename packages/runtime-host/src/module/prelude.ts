/**
 * The guest-side JS installed once per module instance, before the
 * module's own compiled source runs. Builds `globalThis.__forge_setupContext`
 * — the `SetupContext` (`@forge/module-api`) the module's `setup(ctx)` is
 * called with — entirely out of plain guest-realm JS plus the small set of
 * native bridge functions `ModuleBridge` installs (see moduleBridge.ts):
 *
 * - `__forge_addSystem` / `__forge_addInterceptor` / `__forge_eventsOn` take
 *   a live guest function handle directly (no JSON round trip — functions
 *   aren't JSON-serializable in the first place), so the host can call back
 *   into the guest later. This is a different trust shape than the M2
 *   capability bridge's JSON-only `__hostCall`, and deliberately kept as a
 *   separate mechanism (docs/security/SANDBOX-DESIGN.md has the rationale).
 * - `__forge_eventsEmit` / `__forge_defineComponent` / `__forge_log` /
 *   `__forge_world` are plain JSON-in/JSON-out calls, same shape as
 *   `__hostCall`.
 * - `__forge_registerModule` (guest-visible, defined below — NOT the native
 *   `__forge_registerModuleNative`) is how the module's own top-level
 *   script hands its `{setup, teardown?, migrateSave?}` object back to the
 *   host — see moduleBridge.ts's `setup()` doc comment for the exact
 *   convention. It exists as a guest-side wrapper (rather than calling the
 *   native function directly) specifically to JSON-wrap `migrateSave`:
 *   every other native bridge function speaks JSON on the wire, but a
 *   module author's own `migrateSave(from, to, data)` is written against
 *   `@forge/module-api`'s real signature (`data: unknown`, a deserialized
 *   value) — the wrapper is what reconciles the two without leaking the
 *   wire format into the public-facing contract.
 *
 * A system's `run(ctx, entities)` is itself wrapped here (`addSystem`
 * below) so the *actual* per-tick call the host makes
 * (`__forge_addSystem`'s stored handle) takes one JSON snapshot string and
 * returns one JSON write-batch string — the "one bridge call per system per
 * tick" from docs/adr/0005. `ctx.world` inside a system's `run()` is served
 * entirely from that snapshot: no host round trip during the call, per the
 * ADR. `ctx.world` inside an *interceptor* is a different, simpler thing —
 * interceptors aren't a hot per-entity path, so it's backed by
 * `__forge_world`, one direct (synchronous, immediately-applied) host call
 * per method — same shape as a capability call.
 */
export function buildModulePrelude(
  moduleName: string,
  engineVersion: string,
  config: Readonly<Record<string, unknown>>,
): string {
  return `
(function () {
  var MODULE_NAME = ${JSON.stringify(moduleName)};
  var ENGINE_VERSION = ${JSON.stringify(engineVersion)};
  var CONFIG = Object.freeze(${JSON.stringify(config)});

  function notImplemented(what) {
    return function () {
      throw new Error(
        "TickContext." + what + " is not implemented yet (tracked: " +
        "https://github.com/yaniv89/GameFactory/issues/3) — no Input or Scene " +
        "system exists in @forge/core until M4"
      );
    };
  }

  function makeInputSnapshot() {
    return {
      isActionDown: notImplemented("input.isActionDown"),
      wasActionPressed: notImplemented("input.wasActionPressed"),
      wasActionReleased: notImplemented("input.wasActionReleased"),
      get pointerPosition() {
        notImplemented("input.pointerPosition")();
      }
    };
  }

  function makeSceneApi() {
    return {
      get currentSceneId() {
        notImplemented("scene.currentSceneId")();
      },
      transitionTo: notImplemented("scene.transitionTo")
    };
  }

  function makeSnapshotWorld(entitiesById, order, writes, nextTempIdRef) {
    return {
      get: function (id, component) {
        var c = entitiesById[id];
        return c && Object.prototype.hasOwnProperty.call(c, component) ? c[component] : undefined;
      },
      has: function (id, component) {
        var c = entitiesById[id];
        return !!(c && Object.prototype.hasOwnProperty.call(c, component));
      },
      query: function (components) {
        var matched = [];
        for (var j = 0; j < order.length; j++) {
          var id = order[j];
          var c = entitiesById[id];
          var ok = !!c;
          for (var k = 0; ok && k < components.length; k++) {
            if (!Object.prototype.hasOwnProperty.call(c, components[k])) ok = false;
          }
          if (ok) matched.push(id);
        }
        return {
          count: matched.length,
          forEach: function (fn) {
            for (var m = 0; m < matched.length; m++) fn(matched[m]);
          }
        };
      },
      create: function (components) {
        var tempId = nextTempIdRef.value--;
        var comps = components || {};
        writes.push({ kind: "create", tempId: tempId, components: comps });
        entitiesById[tempId] = flattenForRead(comps);
        order.push(tempId);
        return tempId;
      },
      destroy: function (id) {
        writes.push({ kind: "destroy", id: id });
        delete entitiesById[id];
      },
      add: function (id, component, value) {
        writes.push({ kind: "add", id: id, component: component, value: value });
        var c = entitiesById[id] || (entitiesById[id] = {});
        c[component] = value;
      },
      remove: function (id, component) {
        writes.push({ kind: "remove", id: id, component: component });
        var c = entitiesById[id];
        if (c) delete c[component];
      },
      set: function (id, component, value) {
        writes.push({ kind: "set", id: id, component: component, value: value });
        var c = entitiesById[id] || (entitiesById[id] = {});
        c[component] = Object.assign({}, c[component], value);
      }
    };
  }

  function flattenForRead(components) {
    var flat = {};
    for (var name in components) {
      if (Object.prototype.hasOwnProperty.call(components, name)) flat[name] = components[name];
    }
    return flat;
  }

  function logFn(level) {
    return function (message, data) {
      __forge_log(level, message, JSON.stringify(data === undefined ? null : data));
    };
  }

  globalThis.__forge_registerModule = function (moduleObj) {
    var wrapped = { setup: moduleObj.setup, teardown: moduleObj.teardown };
    if (typeof moduleObj.migrateSave === "function") {
      wrapped.migrateSave = function (from, to, dataJson) {
        var result = moduleObj.migrateSave(from, to, JSON.parse(dataJson));
        return JSON.stringify(result === undefined ? null : result);
      };
    }
    __forge_registerModuleNative(wrapped);
  };

  globalThis.__forge_setupContext = {
    moduleName: MODULE_NAME,
    engineVersion: ENGINE_VERSION,
    config: CONFIG,

    defineComponent: function (name, schema, defaults) {
      var realName = __forge_defineComponent(name, JSON.stringify(schema), JSON.stringify(defaults));
      return { name: realName };
    },

    addSystem: function (def) {
      var wrappedRun = function (snapshotJson) {
        var snapshot = JSON.parse(snapshotJson);
        var entitiesById = {};
        var order = [];
        for (var i = 0; i < snapshot.entities.length; i++) {
          var e = snapshot.entities[i];
          entitiesById[e.id] = e.components;
          order.push(e.id);
        }
        var writes = [];
        var nextTempIdRef = { value: -1 };
        var world = makeSnapshotWorld(entitiesById, order, writes, nextTempIdRef);
        var entityView = {
          count: order.length,
          forEach: function (fn) {
            for (var n = 0; n < order.length; n++) fn(order[n]);
          }
        };
        var ctx = {
          dt: snapshot.dt,
          alpha: snapshot.alpha,
          elapsed: snapshot.elapsed,
          frame: snapshot.frame,
          world: world,
          input: makeInputSnapshot(),
          scene: makeSceneApi()
        };
        def.run(ctx, entityView);
        return JSON.stringify({ writes: writes });
      };
      __forge_addSystem(
        def.id,
        def.phase,
        JSON.stringify(def.query),
        JSON.stringify({
          before: def.before || [],
          after: def.after || [],
          skipIfEmpty: def.skipIfEmpty !== false
        }),
        wrappedRun
      );
    },

    addInterceptor: function (point, priority, fn) {
      var wrappedFn = function (valueJson) {
        var value = JSON.parse(valueJson);
        var ctx = {
          world: {
            get: function (id, component) {
              return JSON.parse(__forge_world("get", JSON.stringify([id, component])));
            },
            has: function (id, component) {
              return JSON.parse(__forge_world("has", JSON.stringify([id, component])));
            },
            query: function (components) {
              var ids = JSON.parse(__forge_world("query", JSON.stringify([components])));
              return {
                count: ids.length,
                forEach: function (fn2) {
                  for (var i2 = 0; i2 < ids.length; i2++) fn2(ids[i2]);
                }
              };
            },
            create: function (components) {
              return JSON.parse(__forge_world("create", JSON.stringify([components || {}])));
            },
            destroy: function (id) {
              __forge_world("destroy", JSON.stringify([id]));
            },
            add: function (id, component, value2) {
              __forge_world("add", JSON.stringify([id, component, value2]));
            },
            remove: function (id, component) {
              __forge_world("remove", JSON.stringify([id, component]));
            },
            set: function (id, component, value2) {
              __forge_world("set", JSON.stringify([id, component, value2]));
            }
          }
        };
        var result = fn(value, ctx);
        return JSON.stringify(result === undefined ? value : result);
      };
      __forge_addInterceptor(point, priority, wrappedFn);
    },

    events: {
      __offMap: (typeof WeakMap !== "undefined") ? new WeakMap() : new Map(),
      on: function (event, handler) {
        var unsub = __forge_eventsOn(event, function (payloadJson) {
          handler(JSON.parse(payloadJson));
        });
        this.__offMap.set(handler, unsub);
        return unsub;
      },
      off: function (event, handler) {
        var unsub = this.__offMap.get(handler);
        if (unsub) {
          unsub();
          this.__offMap.delete(handler);
        }
      },
      emit: function (event, payload) {
        __forge_eventsEmit(event, JSON.stringify(payload));
      }
    },

    storage: globalThis.storage,
    net: globalThis.network,

    log: {
      debug: logFn("debug"),
      info: logFn("info"),
      warn: logFn("warn"),
      error: logFn("error")
    }
  };
})();
`;
}
