/**
 * A single physical binding an action can fire from. `code` is a
 * `KeyboardEvent.code` value (`"Space"`, `"KeyW"`, ...), not `.key` — code
 * is layout-independent, the right choice for an action map meant to work
 * the same on an AZERTY keyboard as a QWERTY one.
 */
export type InputBinding = { readonly type: "key"; readonly code: string } | { readonly type: "pointerButton"; readonly button: number };

/** Action name -> the physical bindings that fire it. Per docs/SPEC.md Section 7.3's `settings.inputMaps` (`./data/input.default.json`); this is the in-memory shape that file is expected to deserialize into. */
export type InputActionMap = Readonly<Record<string, readonly InputBinding[]>>;

function bindingsEqual(a: InputBinding, b: InputBinding): boolean {
  if (a.type !== b.type) return false;
  return a.type === "key" && b.type === "key" ? a.code === b.code : a.type === "pointerButton" && b.type === "pointerButton" ? a.button === b.button : false;
}

/**
 * Action-mapped input state backing `@forge/module-api`'s `InputSnapshot`
 * (`isActionDown`/`wasActionPressed`/`wasActionReleased`/`pointerPosition`)
 * for both native `@forge/core` systems and, via the sandbox bridge
 * (`packages/runtime-host/src/module/`), sandboxed guest modules.
 *
 * This class owns no DOM/browser event listeners itself — `@forge/core`
 * has no platform dependency (CLAUDE.md Section 3's repo structure: "ECS,
 * scheduler, events" only). A host (the editor's preview, the standalone
 * player) wires real `keydown`/`keyup`/pointer events to `handleKeyDown`
 * etc.; this class only does the action-mapping and per-tick sampling.
 *
 * Per `@forge/module-api`'s own `InputSnapshot` doc comment, "pressed"/
 * "released" are sampled once per fixed step and held constant for the
 * rest of it — `beginTick()` is the sampling point, called by `Scheduler`
 * once per fixed step, before `PreUpdate` runs. Raw events between two
 * `beginTick()` calls accumulate; a key that goes down and back up between
 * samples still registers as both pressed and released for that one step
 * (never silently dropped), matching how most engines' action systems
 * behave for very short taps.
 */
export class InputState {
  private actionMap: InputActionMap;
  private readonly heldBindingKeys = new Set<string>();
  private readonly downActions = new Set<string>();
  private readonly accumulatedPressed = new Set<string>();
  private readonly accumulatedReleased = new Set<string>();
  private readonly sampledPressed = new Set<string>();
  private readonly sampledReleased = new Set<string>();
  private readonly pointerPos = { x: 0, y: 0 };

  constructor(actionMap: InputActionMap = {}) {
    this.actionMap = actionMap;
  }

  /** Replaces the active action map wholesale — e.g. a scene-specific rebind. Held/sampled state is untouched; a binding no longer present in the new map simply stops matching future events. */
  setActionMap(map: InputActionMap): void {
    this.actionMap = map;
  }

  handleKeyDown(code: string): void {
    this.handleBindingDown({ type: "key", code }, `key:${code}`);
  }

  handleKeyUp(code: string): void {
    this.handleBindingUp({ type: "key", code }, `key:${code}`);
  }

  handlePointerDown(button: number): void {
    this.handleBindingDown({ type: "pointerButton", button }, `pointer:${button}`);
  }

  handlePointerUp(button: number): void {
    this.handleBindingUp({ type: "pointerButton", button }, `pointer:${button}`);
  }

  /** No action-mapping involved — pointer position is always raw, read directly off `pointerPosition`. */
  handlePointerMove(x: number, y: number): void {
    this.pointerPos.x = x;
    this.pointerPos.y = y;
  }

  private handleBindingDown(binding: InputBinding, bindingKey: string): void {
    if (this.heldBindingKeys.has(bindingKey)) return; // ignore OS auto-repeat
    this.heldBindingKeys.add(bindingKey);
    for (const action of this.actionsBoundTo(binding)) {
      if (this.downActions.has(action)) continue;
      this.downActions.add(action);
      this.accumulatedPressed.add(action);
    }
  }

  private handleBindingUp(binding: InputBinding, bindingKey: string): void {
    this.heldBindingKeys.delete(bindingKey);
    for (const action of this.actionsBoundTo(binding)) {
      if (!this.downActions.has(action)) continue;
      if (this.anyBindingStillHeld(action)) continue; // a different binding for this same action is still down
      this.downActions.delete(action);
      this.accumulatedReleased.add(action);
    }
  }

  private *actionsBoundTo(binding: InputBinding): Iterable<string> {
    for (const action in this.actionMap) {
      if (!Object.prototype.hasOwnProperty.call(this.actionMap, action)) continue;
      const bindings = this.actionMap[action]!;
      for (const candidate of bindings) {
        if (bindingsEqual(candidate, binding)) {
          yield action;
          break;
        }
      }
    }
  }

  private anyBindingStillHeld(action: string): boolean {
    const bindings = this.actionMap[action];
    if (!bindings) return false;
    for (const binding of bindings) {
      const key = binding.type === "key" ? `key:${binding.code}` : `pointer:${binding.button}`;
      if (this.heldBindingKeys.has(key)) return true;
    }
    return false;
  }

  /** Called once per fixed step by `Scheduler`, before `PreUpdate`. Promotes this step's accumulated press/release edges into the sampled, held-constant view every phase in this step reads. */
  beginTick(): void {
    this.sampledPressed.clear();
    for (const action of this.accumulatedPressed) this.sampledPressed.add(action);
    this.accumulatedPressed.clear();

    this.sampledReleased.clear();
    for (const action of this.accumulatedReleased) this.sampledReleased.add(action);
    this.accumulatedReleased.clear();
  }

  isActionDown(action: string): boolean {
    return this.downActions.has(action);
  }

  wasActionPressed(action: string): boolean {
    return this.sampledPressed.has(action);
  }

  wasActionReleased(action: string): boolean {
    return this.sampledReleased.has(action);
  }

  /** Same object identity every call — mutated in place, never reallocated, so reading it from inside a system's `run()` doesn't allocate (CLAUDE.md Section 1.3 guardrail 14). */
  get pointerPosition(): { readonly x: number; readonly y: number } {
    return this.pointerPos;
  }

  /** Every action currently held down. Read-only live view — for the sandbox bridge's per-tick serialization (`packages/runtime-host`), not a hot per-entity path itself. */
  get downActionNames(): ReadonlySet<string> {
    return this.downActions;
  }

  /** This fixed step's sampled "just pressed" edges. Same live-view caveat as `downActionNames`. */
  get pressedActionNames(): ReadonlySet<string> {
    return this.sampledPressed;
  }

  /** This fixed step's sampled "just released" edges. Same live-view caveat as `downActionNames`. */
  get releasedActionNames(): ReadonlySet<string> {
    return this.sampledReleased;
  }
}
