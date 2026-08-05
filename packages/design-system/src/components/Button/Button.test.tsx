import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Button } from "./Button";

describe("Button", () => {
  it("fires onClick when clicked", async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Publish</Button>);
    await userEvent.click(screen.getByRole("button", { name: "Publish" }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("does not fire onClick when disabled", async () => {
    const onClick = vi.fn();
    render(
      <Button onClick={onClick} disabled>
        Publish
      </Button>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Publish" }));
    expect(onClick).not.toHaveBeenCalled();
  });

  it("disables the button and sets aria-busy while loading", () => {
    render(<Button loading>Publishing…</Button>);
    const button = screen.getByRole("button", { name: /publishing/i });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
  });
});
