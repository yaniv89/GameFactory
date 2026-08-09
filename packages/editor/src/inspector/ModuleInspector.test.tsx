import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ModuleInspector } from "./ModuleInspector";
import type { ModuleManifest } from "../modules/moduleManifests";

const TURN_BATTLE: ModuleManifest = {
  name: "@forge/turn-battle",
  summary: "1v1 turn-based combat.",
  configSchema: {
    type: "object",
    properties: { baseHitChance: { type: "number", title: "Base hit chance", minimum: 0, maximum: 1 } },
    required: ["baseHitChance"],
  },
};

const DIALOGUE: ModuleManifest = { name: "@forge/dialogue", summary: "Dialogue trees." };

describe("ModuleInspector", () => {
  it("shows the module's current config", () => {
    render(<ModuleInspector manifest={TURN_BATTLE} config={{ baseHitChance: 0.9 }} onConfigure={() => {}} />);
    expect(screen.getByLabelText("Base hit chance")).toHaveValue(0.9);
  });

  it("calls onConfigure with the module name and new config once the field is blurred", async () => {
    const onConfigure = vi.fn();
    render(<ModuleInspector manifest={TURN_BATTLE} config={{ baseHitChance: 0.9 }} onConfigure={onConfigure} />);

    const field = screen.getByLabelText("Base hit chance");
    await userEvent.clear(field);
    await userEvent.type(field, "0.5");
    await userEvent.tab();

    expect(onConfigure).toHaveBeenCalledWith("@forge/turn-battle", { baseHitChance: 0.5 });
  });

  it("renders nothing for a module with no configSchema", () => {
    const { container } = render(<ModuleInspector manifest={DIALOGUE} config={{}} onConfigure={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });
});
