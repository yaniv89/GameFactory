import { describe, expect, it } from "vitest";
import { generateCodeChallenge, generateCodeVerifier, generateState } from "./pkce";

describe("pkce", () => {
  it("generateCodeVerifier produces a base64url string with no padding/plus/slash characters", () => {
    const verifier = generateCodeVerifier();
    expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(verifier.length).toBeGreaterThanOrEqual(43); // RFC 7636's minimum verifier length
  });

  it("generateCodeVerifier produces a different value on every call", () => {
    const a = generateCodeVerifier();
    const b = generateCodeVerifier();
    expect(a).not.toBe(b);
  });

  it("generateCodeChallenge computes the RFC 7636 S256 challenge for a known verifier (known-answer test, independently computed via Node's crypto module)", async () => {
    const challenge = await generateCodeChallenge("test-verifier-a1b2c3d4e5f6g7h8i9j0");
    expect(challenge).toBe("uHU3v5tKKEfB4gtTok1dmn6HjggpD7eo5eWD22psTSA");
  });

  it("generateState produces a different value on every call", () => {
    const a = generateState();
    const b = generateState();
    expect(a).not.toBe(b);
  });
});
