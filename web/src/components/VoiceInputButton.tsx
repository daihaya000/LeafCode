import { Mic, MicOff } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { timedFetch } from "@/lib/client";
import type { UseVoiceInputReturn } from "@/lib/use-voice-input";

const WINDOWS_VOICE_INPUT_TIMEOUT_MS = 15_000;

interface VoiceInputButtonProps {
  voice: UseVoiceInputReturn;
  onTranscript: (text: string) => void;
  onNativeVoiceStart?: () => void;
  disabled?: boolean;
}

type VoiceInputMode = "web-speech" | "windows-native";

function detectVoiceInputMode(): VoiceInputMode {
  if (typeof window === "undefined") return "web-speech";
  const nav = window.navigator as Navigator & {
    brave?: unknown;
    userAgentData?: { brands?: Array<{ brand: string; version: string }> };
  };
  const ua = nav.userAgent || "";
  const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
  if (isMobile) return "web-speech";

  const isWindows = /Windows NT/i.test(ua);
  if (!isWindows) return "web-speech";

  const brands = nav.userAgentData?.brands?.map((b) => b.brand) ?? [];
  const isEdge = /Edg\//i.test(ua) || brands.some((b) => /Microsoft Edge/i.test(b));
  const isBrave = !!nav.brave;
  const isChrome =
    !isEdge &&
    !isBrave &&
    !/OPR\//i.test(ua) &&
    !/Vivaldi/i.test(ua) &&
    (/Chrome\//i.test(ua) || brands.some((b) => b === "Google Chrome"));

  return isChrome || isEdge ? "web-speech" : "windows-native";
}

export function VoiceInputButton({
  voice,
  onTranscript,
  onNativeVoiceStart,
  disabled = false,
}: VoiceInputButtonProps) {
  const [stopping, setStopping] = useState(false);
  const [stopError, setStopError] = useState<string | null>(null);
  const [mode, setMode] = useState<VoiceInputMode>("web-speech");
  const [nativeBusy, setNativeBusy] = useState(false);
  const [nativeError, setNativeError] = useState<string | null>(null);
  const nativeBusyRef = useRef(false);
  const stoppingRef = useRef(false);
  const mountedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    setMode(detectVoiceInputMode());
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const isWindowsNative = mode === "windows-native";
  const busy = isWindowsNative ? nativeBusy : voice.busy || stopping;

  if (!isWindowsNative && !voice.supported) return null;

  const handleWindowsVoiceInput = () => {
    if (nativeBusyRef.current) return;
    nativeBusyRef.current = true;
    setNativeBusy(true);
    setNativeError(null);
    void (async () => {
      try {
        // Focus the composer before the host injects Win+H; a short settle
        // reduces races where another window still owns focus.
        onNativeVoiceStart?.();
        await new Promise((r) => setTimeout(r, 50));
        onNativeVoiceStart?.();
        const res = await timedFetch("/api/host/voice-input", {
          method: "POST",
          timeoutMs: WINDOWS_VOICE_INPUT_TIMEOUT_MS,
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(data.error || `Windows 音声入力を起動できませんでした。(${res.status})`);
        }
      } catch (error) {
        if (mountedRef.current) setNativeError(
          error instanceof Error
            ? error.message
            : "Windows 音声入力を起動できませんでした。",
        );
      } finally {
        nativeBusyRef.current = false;
        if (mountedRef.current) setNativeBusy(false);
      }
    })();
  };

  const handleClick = () => {
    if (disabled || busy) return;
    if (isWindowsNative) {
      handleWindowsVoiceInput();
      return;
    }
    if (voice.listening) {
      // stop() returns a Promise that resolves once the engine fires its
      // final `result` + `end` events, so the last utterance finalized by
      // the stop is not lost. Forward the resolved transcript to the parent.
      if (stoppingRef.current) return;
      stoppingRef.current = true;
      setStopping(true);
      void (async () => {
        try {
          const transcript = await voice.stop();
          if (mountedRef.current) onTranscript(transcript);
        } catch (error) {
          if (mountedRef.current) setStopError(
            error instanceof Error
              ? error.message
              : "音声入力を停止できませんでした。もう一度お試しください。",
          );
        } finally {
          stoppingRef.current = false;
          if (mountedRef.current) setStopping(false);
        }
      })();
    } else {
      setStopError(null);
      voice.clearError();
      voice.start();
    }
  };

  const label = isWindowsNative
    ? "Windows 音声入力"
    : voice.listening
      ? "音声入力を停止"
      : "音声入力";
  const error = isWindowsNative ? nativeError : stopError ?? voice.error;

  return (
    <div className="relative">
      <button
        type="button"
        aria-label={label}
        aria-pressed={!isWindowsNative && voice.listening}
        aria-busy={busy}
        disabled={disabled || busy}
        onClick={handleClick}
        className="flex h-8 shrink-0 items-center justify-center rounded-lg border border-border bg-bg px-2 text-muted transition-colors hover:bg-surface-2 hover:text-text disabled:opacity-40"
      >
        {!isWindowsNative && voice.listening ? (
          <MicOff className="h-3.5 w-3.5" aria-hidden="true" />
        ) : (
          <Mic className="h-3.5 w-3.5" aria-hidden="true" />
        )}
      </button>
      {!isWindowsNative && voice.listening && (
        <span
          aria-live="polite"
          className="absolute -bottom-4 left-1/2 -translate-x-1/2 whitespace-nowrap text-[10px] text-danger"
        >
          認識中
        </span>
      )}
      {error && (
        <p role="alert" className="mt-1 text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
