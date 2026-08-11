import type { Query } from "../ecs/query";
import type { World } from "../ecs/world";
import type { EventBusImpl } from "../events/eventBus";
import { InputState } from "../input/inputState";
import { SceneManager } from "../scene/sceneManager";
import { FIXED_STEP_MS, FIXED_STEP_PHASES, MAX_ACCUMULATED_MS, PER_FRAME_PHASES, type Phase } from "./phase";

/**
 * Floating-point tolerance for the accumulator's `>= FIXED_STEP_MS` check.
 * Without it, a `dt` built from exact multiples of FIXED_STEP_MS (the
 * common case at a steady 60Hz) can accumulate rounding error that leaves
 * the accumulator a few ULPs short of a full step, silently dropping one
 * fixed step every so often.
 */
const STEP_EPSILON_MS = 1e-6;
import { resolveSystemOrder, type SystemDefinition } from "./system";
import type { TickContext } from "./tickContext";

interface MutableTickContext {
  dt: number;
  alpha: number;
  elapsed: number;
  frame: number;
  world: World;
  input: InputState;
  scene: SceneManager;
}

export interface SchedulerOptions {
  /** Defaults to a fresh `InputState` with no action map — a host wires real bindings via `setActionMap`/`handleKeyDown` etc. after construction, or passes its own instance here. */
  readonly input?: InputState;
  /** Defaults to a fresh `SceneManager` with `initialSceneId` (`""` if omitted) and no event bus, meaning `"scene:changed"` is tracked internally but not emitted anywhere. Ignored if `scene` is also provided. */
  readonly initialSceneId?: string;
  /** Takes precedence over `initialSceneId` if both are given. */
  readonly scene?: SceneManager;
  /** Wired into a scheduler-constructed `SceneManager` so `"scene:changed"` reaches whatever the host already uses for module/system communication. Ignored if `scene` is provided directly — that instance's own event wiring (or lack of it) is used as-is. See `SceneManager`'s constructor param for why this accepts any caller-parameterized `EventBusImpl<EventMap>`. */
  readonly events?: EventBusImpl<any>;
}

/**
 * Runs registered systems through the fixed-step accumulator loop described
 * in docs/SPEC.md Section 8.2. One Scheduler owns one World.
 *
 * The `TickContext` passed to every system is a single object mutated in
 * place across phases, not reallocated per call — the frame loop must not
 * allocate (CLAUDE.md Section 1.3, guardrail 14), and this is the mechanism
 * that keeps the scheduler itself off the allocation path once systems are
 * registered.
 */
export class Scheduler {
  private readonly systemsByPhase = new Map<Phase, SystemDefinition[]>();
  private readonly orderCache = new Map<Phase, SystemDefinition[]>();
  private readonly queryCache = new Map<string, Query>();
  private readonly registeredIds = new Set<string>();
  private readonly ctx: MutableTickContext;
  private readonly inputState: InputState;
  private readonly sceneManager: SceneManager;

  private accumulatorMs = 0;
  private elapsedSeconds = 0;
  private fixedStepCountValue = 0;

  constructor(
    private readonly world: World,
    options: SchedulerOptions = {},
  ) {
    this.inputState = options.input ?? new InputState();
    this.sceneManager = options.scene ?? new SceneManager(options.initialSceneId ?? "", options.events);
    this.ctx = { dt: FIXED_STEP_MS / 1000, alpha: 0, elapsed: 0, frame: 0, world, input: this.inputState, scene: this.sceneManager };
    for (const phase of [...FIXED_STEP_PHASES, ...PER_FRAME_PHASES]) {
      this.systemsByPhase.set(phase, []);
    }
  }

  /** The `InputState` this scheduler's `TickContext.input` is backed by — same instance every call, for a host to feed raw events into or for the sandbox bridge to read from between ticks. */
  get input(): InputState {
    return this.inputState;
  }

  /** The `SceneManager` this scheduler's `TickContext.scene` is backed by — see `input` above for why this is exposed directly rather than only reachable through a running system. */
  get scene(): SceneManager {
    return this.sceneManager;
  }

  /** Total simulated seconds elapsed across every fixed step run so far. */
  get elapsed(): number {
    return this.elapsedSeconds;
  }

  /** Total fixed steps run so far. */
  get fixedStepCount(): number {
    return this.fixedStepCountValue;
  }

  addSystem(def: SystemDefinition): void {
    if (this.registeredIds.has(def.id)) {
      throw new Error(`Scheduler: system id "${def.id}" is already registered`);
    }
    const list = this.systemsByPhase.get(def.phase);
    if (!list) {
      throw new Error(`Scheduler: unknown phase "${def.phase}" for system "${def.id}"`);
    }
    list.push(def);
    this.registeredIds.add(def.id);
    this.orderCache.delete(def.phase);
  }

  private orderFor(phase: Phase): SystemDefinition[] {
    let order = this.orderCache.get(phase);
    if (!order) {
      order = resolveSystemOrder(this.systemsByPhase.get(phase) ?? []);
      this.orderCache.set(phase, order);
    }
    return order;
  }

  private queryFor(def: SystemDefinition): Query {
    let query = this.queryCache.get(def.id);
    if (!query) {
      query = this.world.query(def.query);
      this.queryCache.set(def.id, query);
    }
    return query;
  }

  private runPhase(phase: Phase): void {
    for (const def of this.orderFor(phase)) {
      const query = this.queryFor(def);
      const skipIfEmpty = def.skipIfEmpty ?? true;
      if (skipIfEmpty && query.count() === 0) continue;
      def.run(this.ctx as TickContext, query);
    }
    this.world.flush();
  }

  /**
   * Advances the simulation by `dtMs` of real elapsed time: runs zero or
   * more fixed steps (PreUpdate/Update/PostUpdate/Physics), then the
   * per-frame phases (PreRender/Render/UI) exactly once, per the loop in
   * docs/SPEC.md Section 8.2. `dtMs` is clamped to `MAX_ACCUMULATED_MS`
   * before accumulating, so a backgrounded tab can't trigger the spiral of
   * death on resume.
   */
  tick(dtMs: number): void {
    this.accumulatorMs += Math.min(Math.max(dtMs, 0), MAX_ACCUMULATED_MS);
    this.ctx.dt = FIXED_STEP_MS / 1000;

    while (this.accumulatorMs >= FIXED_STEP_MS - STEP_EPSILON_MS) {
      this.ctx.elapsed = this.elapsedSeconds;
      this.ctx.frame = this.fixedStepCountValue;
      this.ctx.alpha = 0;
      // Sampled once here, before PreUpdate, and held constant for every
      // phase this fixed step runs — per InputState's own doc comment and
      // @forge/module-api's InputSnapshot contract.
      this.inputState.beginTick();
      for (const phase of FIXED_STEP_PHASES) this.runPhase(phase);
      // Applied once here, after every fixed-step phase has run — a
      // system calling ctx.scene.transitionTo() mid-tick must not see
      // currentSceneId change out from under a later system in the same
      // step. Same "settle at a defined boundary" discipline World.flush()
      // already uses for structural changes.
      this.sceneManager.applyPendingTransition();
      this.accumulatorMs -= FIXED_STEP_MS;
      this.elapsedSeconds += FIXED_STEP_MS / 1000;
      this.fixedStepCountValue++;
    }

    this.ctx.alpha = Math.max(0, this.accumulatorMs) / FIXED_STEP_MS;
    this.ctx.elapsed = this.elapsedSeconds;
    this.ctx.frame = this.fixedStepCountValue;
    for (const phase of PER_FRAME_PHASES) this.runPhase(phase);
  }
}
