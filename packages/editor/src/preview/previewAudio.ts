/**
 * H1f's audio layer — every beat in the live preview (footstep, swing,
 * impact, death, pickup) makes a real sound, synthesized directly through
 * the Web Audio API (CLAUDE.md Section 2.3: "Web Audio API directly.
 * Howler adds weight for little gain"). No sound assets exist yet (same
 * gap the visual side had before H1a's real sprites — L1-L5 is where a
 * real Art Pack audio category would eventually replace this), so each
 * cue is a short, honestly-synthesized oscillator/noise burst, the audio
 * equivalent of tilePalette.ts's flat-color tile swatches: a real,
 * functioning placeholder, not a stub that plays nothing.
 *
 * `AudioContext` starts suspended until a real user gesture resumes it
 * (browser autoplay policy) — `resume()` is idempotent and meant to be
 * called from the first real keydown/pointerdown the preview already
 * requires for keyboard focus, not from any boot-time effect.
 */
export interface PreviewAudio {
  resume(): void;
  playFootstep(): void;
  playSwing(): void;
  playImpact(): void;
  playDeath(): void;
  playPickup(): void;
  dispose(): void;
}

/** A no-op implementation for environments with no Web Audio support (or a boot context where creating an AudioContext would throw) — the same "degrade, don't crash the preview" posture the rest of this file's callers already take for missing pack art. */
function createSilentPreviewAudio(): PreviewAudio {
  return {
    resume: () => undefined,
    playFootstep: () => undefined,
    playSwing: () => undefined,
    playImpact: () => undefined,
    playDeath: () => undefined,
    playPickup: () => undefined,
    dispose: () => undefined,
  };
}

export function createPreviewAudio(): PreviewAudio {
  const AudioContextCtor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextCtor) return createSilentPreviewAudio();

  const ctx = new AudioContextCtor();
  const master = ctx.createGain();
  master.gain.value = 0.35; // one shared headroom trim so five different-shaped envelopes don't clip against each other
  master.connect(ctx.destination);

  /** A short burst of white noise through a bandpass filter — the shared building block behind the swing whoosh and the footstep thump, which differ only in center frequency/decay. */
  function playFilteredNoise(durationSec: number, filterFreq: number, filterQ: number, peakGain: number): void {
    const sampleCount = Math.max(1, Math.floor(ctx.sampleRate * durationSec));
    const buffer = ctx.createBuffer(1, sampleCount, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < sampleCount; i++) data[i] = Math.random() * 2 - 1;

    const source = ctx.createBufferSource();
    source.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = filterFreq;
    filter.Q.value = filterQ;

    const gain = ctx.createGain();
    const now = ctx.currentTime;
    gain.gain.setValueAtTime(peakGain, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + durationSec);

    source.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    source.start(now);
    source.stop(now + durationSec);
  }

  /** A single tone burst — the shared building block behind the impact thud, the death cue's downward sweep, and the pickup chime's two notes. */
  function playTone(
    waveform: OscillatorType,
    startFreq: number,
    endFreq: number,
    durationSec: number,
    peakGain: number,
    startDelaySec = 0,
  ): void {
    const osc = ctx.createOscillator();
    osc.type = waveform;
    const gain = ctx.createGain();
    const start = ctx.currentTime + startDelaySec;

    osc.frequency.setValueAtTime(startFreq, start);
    if (endFreq !== startFreq) osc.frequency.exponentialRampToValueAtTime(endFreq, start + durationSec);

    gain.gain.setValueAtTime(peakGain, start);
    gain.gain.exponentialRampToValueAtTime(0.001, start + durationSec);

    osc.connect(gain);
    gain.connect(master);
    osc.start(start);
    osc.stop(start + durationSec);
  }

  return {
    resume: () => {
      if (ctx.state === "suspended") void ctx.resume();
    },
    playFootstep: () => playFilteredNoise(0.05, 180, 2, 0.5),
    playSwing: () => playFilteredNoise(0.12, 2200, 1.1, 0.6),
    playImpact: () => playTone("square", 160, 90, 0.09, 0.7),
    playDeath: () => playTone("sawtooth", 220, 55, 0.35, 0.55),
    playPickup: () => {
      playTone("sine", 880, 880, 0.09, 0.5);
      playTone("sine", 1320, 1320, 0.12, 0.5, 0.08);
    },
    dispose: () => {
      void ctx.close();
    },
  };
}
