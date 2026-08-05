import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatusBar } from "./StatusBar";

describe("StatusBar", () => {
  it.each([
    ["saved", "Saved"],
    ["saving", "Saving…"],
    ["unsaved", "Unsaved changes"],
    ["offline", "Offline — changes stored locally"],
  ] as const)("renders the %s status as %j, never optimistically as Saved", (status, label) => {
    render(<StatusBar status={status} />);
    expect(screen.getByRole("status")).toHaveTextContent(label);
  });
});
