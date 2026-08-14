const SOUND_DURATION_SEC = 0.18;
const SOUND_GAIN = 0.045;

/** Attention (permission / question) alert: three staccato beeps. */
const ATTENTION_BEEP_COUNT = 3;
const ATTENTION_BEEP_DURATION_SEC = 0.11;
const ATTENTION_BEEP_GAP_SEC = 0.1;
const ATTENTION_BEEP_FREQ = 660;
const ATTENTION_GAIN = 0.05;

type AudioContextConstructor = new () => AudioContext;

function getAudioContextConstructor(): AudioContextConstructor | undefined {
  if (typeof window === "undefined") return undefined;
  return (
    window.AudioContext ??
    (window as typeof window & { webkitAudioContext?: AudioContextConstructor })
      .webkitAudioContext
  );
}

/**
 * Create an AudioContext, schedule the given tones, and close the context
 * once the last scheduled oscillator has ended.
 */
function withAudioContext(
  schedule: (ctx: AudioContext, start: number) => OscillatorNode[],
) {
  const AudioContextCtor = getAudioContextConstructor();
  if (!AudioContextCtor) return;

  try {
    const ctx = new AudioContextCtor();
    const oscillators = schedule(ctx, ctx.currentTime);
    const last = oscillators[oscillators.length - 1];
    last?.addEventListener("ended", () => {
      void ctx.close().catch(() => undefined);
    });
  } catch {
    // Autoplay/user-activation restrictions or unavailable audio devices.
  }
}

function createTone(
  ctx: AudioContext,
  start: number,
  duration: number,
  startFreq: number,
  endFreq: number,
  gainValue: number,
): OscillatorNode {
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  const end = start + duration;

  oscillator.type = "sine";
  oscillator.frequency.setValueAtTime(startFreq, start);
  oscillator.frequency.exponentialRampToValueAtTime(endFreq, start + 0.08);

  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(gainValue, start + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, end);

  oscillator.connect(gain);
  gain.connect(ctx.destination);
  oscillator.start(start);
  oscillator.stop(end);
  return oscillator;
}

/**
 * Play a short, non-blocking completion chime for a session busy/retry → idle
 * transition. Browsers may reject audio before a user gesture; this is best
 * effort and intentionally never surfaces errors to the UI.
 */
export function playSessionCompleteSound() {
  withAudioContext((ctx, start) => [
    createTone(ctx, start, SOUND_DURATION_SEC, 880, 1320, SOUND_GAIN),
  ]);
}

/**
 * Play a short, non-blocking alert when a user approval (permission) or
 * question UI appears. Best effort, like the completion chime.
 */
export function playAttentionRequiredSound() {
  withAudioContext((ctx, start) => {
    const oscillators: OscillatorNode[] = [];
    for (let i = 0; i < ATTENTION_BEEP_COUNT; i++) {
      const at = start + i * (ATTENTION_BEEP_DURATION_SEC + ATTENTION_BEEP_GAP_SEC);
      oscillators.push(
        createTone(
          ctx,
          at,
          ATTENTION_BEEP_DURATION_SEC,
          ATTENTION_BEEP_FREQ,
          ATTENTION_BEEP_FREQ,
          ATTENTION_GAIN,
        ),
      );
    }
    return oscillators;
  });
}
