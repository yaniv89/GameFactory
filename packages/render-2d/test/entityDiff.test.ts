import { describe, expect, it } from "vitest";
import { EntityDiffTracker } from "../src/entityDiff";

describe("EntityDiffTracker", () => {
  it("reports no removals on the first frame", () => {
    const tracker = new EntityDiffTracker();
    tracker.see(1);
    tracker.see(2);
    expect(tracker.endFrame()).toEqual([]);
  });

  it("reports an entity as removed once it stops being seen", () => {
    const tracker = new EntityDiffTracker();
    tracker.see(1);
    tracker.see(2);
    tracker.endFrame();

    tracker.see(1);
    expect(tracker.endFrame()).toEqual([2]);
  });

  it("does not report an entity as removed while it continues to be seen", () => {
    const tracker = new EntityDiffTracker();
    tracker.see(1);
    tracker.endFrame();

    tracker.see(1);
    expect(tracker.endFrame()).toEqual([]);
  });

  it("reports a newly-absent entity only once", () => {
    const tracker = new EntityDiffTracker();
    tracker.see(1);
    tracker.see(2);
    tracker.endFrame();

    tracker.see(1);
    expect(tracker.endFrame()).toEqual([2]);

    tracker.see(1);
    expect(tracker.endFrame()).toEqual([]);
  });

  it("handles every entity disappearing at once", () => {
    const tracker = new EntityDiffTracker();
    tracker.see(1);
    tracker.see(2);
    tracker.see(3);
    tracker.endFrame();

    expect(tracker.endFrame().slice().sort()).toEqual([1, 2, 3]);
  });
});
