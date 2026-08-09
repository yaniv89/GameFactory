import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PresenceIndicatorView } from "./PresenceIndicator";

describe("PresenceIndicatorView", () => {
  it("shows a connecting message while loading", () => {
    render(<PresenceIndicatorView status="loading" roster={[]} />);
    expect(screen.getByRole("status")).toHaveTextContent("Connecting to collaborators");
  });

  it("shows an offline message when offline", () => {
    render(<PresenceIndicatorView status="offline" roster={[]} />);
    expect(screen.getByRole("status")).toHaveTextContent("Offline");
  });

  it("shows an error message when disconnected", () => {
    render(<PresenceIndicatorView status="error" roster={[]} />);
    expect(screen.getByRole("status")).toHaveTextContent("Not connected");
  });

  it("shows the online count and a dot per collaborator when populated", () => {
    render(
      <PresenceIndicatorView
        status="populated"
        roster={[
          { connectionId: "a", userId: "u1", displayName: "Ada" },
          { connectionId: "b", userId: "u2", displayName: "Grace" },
        ]}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("2 online");
    expect(document.querySelectorAll(".fg-presence__dot--online")).toHaveLength(2);
  });
});
