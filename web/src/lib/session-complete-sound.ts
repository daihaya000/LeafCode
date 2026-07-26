const SOUND_DURATION_SEC = 0.18;
const SOUND_GAIN = 0.045;

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
 * Play a short, non-blocking completion chime for a session busy/retry → idle
 * transition. Browsers may reject audio before a user gesture; this is best
 * effort and intentionally never surfaces errors to the UI.
 */
export function playSessionCompleteSound() {
  const AudioContextCtor = getAudioContextConstructor();
  if (!AudioContextCtor) return;

  try {
    const ctx = new AudioContextCtor();
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    const start = ctx.currentTime;
    const end = start + SOUND_DURATION_SEC;

    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(880, start);
    oscillator.frequency.exponentialRampToValueAtTime(1320, start + 0.08);

    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(SOUND_GAIN, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, end);

    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.start(start);
    oscillator.stop(end);
    oscillator.addEventListener("ended", () => {
      void ctx.close().catch(() => undefined);
    });
  } catch {
    // Autoplay/user-activation restrictions or unavailable audio devices.
  }
}
