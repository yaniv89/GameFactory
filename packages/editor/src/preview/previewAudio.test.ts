import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPreviewAudio } from "./previewAudio";

class FakeAudioParam {
  value = 0;
  setValueAtTime = vi.fn();
  exponentialRampToValueAtTime = vi.fn();
}

class FakeGainNode {
  gain = new FakeAudioParam();
  connect = vi.fn();
}

class FakeBiquadFilterNode {
  type = "";
  frequency = new FakeAudioParam();
  Q = new FakeAudioParam();
  connect = vi.fn();
}

class FakeBufferSourceNode {
  buffer: unknown;
  connect = vi.fn();
  start = vi.fn();
  stop = vi.fn();
}

class FakeOscillatorNode {
  type = "";
  frequency = new FakeAudioParam();
  connect = vi.fn();
  start = vi.fn();
  stop = vi.fn();
}

/** Captures every node it creates so a test can assert on the specific instance a `play*` call produced, without the real Web Audio API (unavailable in jsdom). */
class FakeAudioContext {
  sampleRate = 44100;
  currentTime = 0;
  state: "suspended" | "running" | "closed" = "suspended";
  destination = {};
  resume = vi.fn(async () => {
    this.state = "running";
  });
  close = vi.fn(async () => {
    this.state = "closed";
  });

  readonly gains: FakeGainNode[] = [];
  readonly filters: FakeBiquadFilterNode[] = [];
  readonly sources: FakeBufferSourceNode[] = [];
  readonly oscillators: FakeOscillatorNode[] = [];

  createGain(): FakeGainNode {
    const node = new FakeGainNode();
    this.gains.push(node);
    return node;
  }
  createBiquadFilter(): FakeBiquadFilterNode {
    const node = new FakeBiquadFilterNode();
    this.filters.push(node);
    return node;
  }
  createBufferSource(): FakeBufferSourceNode {
    const node = new FakeBufferSourceNode();
    this.sources.push(node);
    return node;
  }
  createOscillator(): FakeOscillatorNode {
    const node = new FakeOscillatorNode();
    this.oscillators.push(node);
    return node;
  }
  createBuffer(channels: number, length: number): { getChannelData: (channel: number) => Float32Array } {
    const data = new Float32Array(length);
    return { getChannelData: () => data };
  }
}

describe("createPreviewAudio", () => {
  let originalAudioContext: typeof AudioContext | undefined;

  beforeEach(() => {
    originalAudioContext = window.AudioContext;
  });

  afterEach(() => {
    window.AudioContext = originalAudioContext as typeof AudioContext;
  });

  it("degrades to a silent, non-throwing implementation when the browser has no Web Audio support", () => {
    // @ts-expect-error deliberately simulating an environment with no AudioContext constructor
    delete window.AudioContext;
    const audio = createPreviewAudio();
    expect(() => {
      audio.resume();
      audio.playFootstep();
      audio.playSwing();
      audio.playImpact();
      audio.playDeath();
      audio.playPickup();
      audio.dispose();
    }).not.toThrow();
  });

  it("resume() calls AudioContext.resume() only while suspended (the browser-autoplay-gesture unlock)", () => {
    const ctx = new FakeAudioContext();
    window.AudioContext = vi.fn(() => ctx) as unknown as typeof AudioContext;
    const audio = createPreviewAudio();

    audio.resume();
    expect(ctx.resume).toHaveBeenCalledTimes(1);
  });

  it("playFootstep synthesizes a short, low-frequency bandpass noise burst", () => {
    const ctx = new FakeAudioContext();
    window.AudioContext = vi.fn(() => ctx) as unknown as typeof AudioContext;
    const audio = createPreviewAudio();

    audio.playFootstep();

    expect(ctx.sources).toHaveLength(1);
    expect(ctx.filters).toHaveLength(1);
    expect(ctx.filters[0]!.type).toBe("bandpass");
    expect(ctx.filters[0]!.frequency.value).toBe(180);
    expect(ctx.sources[0]!.start).toHaveBeenCalledTimes(1);
  });

  it("playSwing synthesizes a brighter, higher-frequency bandpass noise burst than a footstep", () => {
    const ctx = new FakeAudioContext();
    window.AudioContext = vi.fn(() => ctx) as unknown as typeof AudioContext;
    const audio = createPreviewAudio();

    audio.playSwing();

    expect(ctx.filters).toHaveLength(1);
    expect(ctx.filters[0]!.type).toBe("bandpass");
    expect(ctx.filters[0]!.frequency.value).toBe(2200);
    expect(ctx.filters[0]!.frequency.value).toBeGreaterThan(180); // distinctly different from a footstep's own cue
  });

  it("playImpact synthesizes a tone starting well above where it ends (a percussive downward thud)", () => {
    const ctx = new FakeAudioContext();
    window.AudioContext = vi.fn(() => ctx) as unknown as typeof AudioContext;
    const audio = createPreviewAudio();

    audio.playImpact();

    expect(ctx.oscillators).toHaveLength(1);
    expect(ctx.oscillators[0]!.type).toBe("square");
    expect(ctx.oscillators[0]!.frequency.setValueAtTime).toHaveBeenCalledWith(160, expect.any(Number));
    expect(ctx.oscillators[0]!.frequency.exponentialRampToValueAtTime).toHaveBeenCalledWith(90, expect.any(Number));
  });

  it("playDeath synthesizes a longer, lower-pitched downward sweep than playImpact", () => {
    const ctx = new FakeAudioContext();
    window.AudioContext = vi.fn(() => ctx) as unknown as typeof AudioContext;
    const audio = createPreviewAudio();

    audio.playDeath();

    expect(ctx.oscillators).toHaveLength(1);
    expect(ctx.oscillators[0]!.type).toBe("sawtooth");
    expect(ctx.oscillators[0]!.frequency.setValueAtTime).toHaveBeenCalledWith(220, expect.any(Number));
    expect(ctx.oscillators[0]!.frequency.exponentialRampToValueAtTime).toHaveBeenCalledWith(55, expect.any(Number));
  });

  it("playPickup synthesizes two bright ascending notes, the second delayed after the first", () => {
    const ctx = new FakeAudioContext();
    window.AudioContext = vi.fn(() => ctx) as unknown as typeof AudioContext;
    const audio = createPreviewAudio();

    audio.playPickup();

    expect(ctx.oscillators).toHaveLength(2);
    expect(ctx.oscillators[0]!.type).toBe("sine");
    expect(ctx.oscillators[1]!.type).toBe("sine");
    expect(ctx.oscillators[0]!.frequency.setValueAtTime).toHaveBeenCalledWith(880, expect.any(Number));
    expect(ctx.oscillators[1]!.frequency.setValueAtTime).toHaveBeenCalledWith(1320, expect.any(Number));
    const firstNoteStart = ctx.oscillators[0]!.start.mock.calls[0]![0] as number;
    const secondNoteStart = ctx.oscillators[1]!.start.mock.calls[0]![0] as number;
    expect(secondNoteStart).toBeGreaterThan(firstNoteStart);
  });

  it("dispose() closes the underlying AudioContext", () => {
    const ctx = new FakeAudioContext();
    window.AudioContext = vi.fn(() => ctx) as unknown as typeof AudioContext;
    const audio = createPreviewAudio();

    audio.dispose();

    expect(ctx.close).toHaveBeenCalledTimes(1);
  });
});
