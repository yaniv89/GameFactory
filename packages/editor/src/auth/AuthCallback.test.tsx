import { render, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./authClient", () => ({
  completeLoginFromCallback: vi.fn(),
}));

import { completeLoginFromCallback } from "./authClient";
import { AuthCallback } from "./AuthCallback";

/**
 * Found by an actual manual signup-through-a-real-browser run against
 * `pnpm dev` (React 18 StrictMode is dev-only — a production build never
 * hit this): StrictMode intentionally mounts this effect, cleans it up,
 * and mounts it again to surface exactly this class of bug. These tests
 * render under a real `<StrictMode>` for the same reason — jsdom/RTL
 * reproduce React's dev double-invoke faithfully, so this is a real
 * regression test, not a simulation of one.
 */
describe("AuthCallback", () => {
  beforeEach(() => {
    vi.mocked(completeLoginFromCallback).mockReset();
  });

  it("under StrictMode's dev double-invoke, exchanges the code exactly once and calls onDone", async () => {
    vi.mocked(completeLoginFromCallback).mockResolvedValue({ accessToken: "at-1", expiresAt: Date.now() + 900_000 });
    const onDone = vi.fn();

    render(
      <StrictMode>
        <AuthCallback onDone={onDone} />
      </StrictMode>,
    );

    await waitFor(() => expect(onDone).toHaveBeenCalledOnce());
    expect(completeLoginFromCallback).toHaveBeenCalledOnce();
  });

  it("under StrictMode's dev double-invoke, shows the real error exactly once rather than a second call's spurious one", async () => {
    vi.mocked(completeLoginFromCallback).mockRejectedValue(new Error("Sign-in callback 'state' did not match — possible CSRF, request rejected."));
    const onDone = vi.fn();

    const { findByRole } = render(
      <StrictMode>
        <AuthCallback onDone={onDone} />
      </StrictMode>,
    );

    const alert = await findByRole("alert");
    expect(alert.textContent).toContain("state' did not match");
    expect(onDone).not.toHaveBeenCalled();
    expect(completeLoginFromCallback).toHaveBeenCalledOnce();
  });
});
