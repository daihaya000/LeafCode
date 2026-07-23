"use client";

import { Mic, MicOff } from "lucide-react";
import { useState } from "react";
import type { UseVoiceInputReturn } from "@/lib/use-voice-input";

interface VoiceInputButtonProps {
  voice: UseVoiceInputReturn;
  onTranscript: (text: string) => void;
  disabled?: boolean;
}

export function VoiceInputButton({
  voice,
  onTranscript,
  disabled = false,
}: VoiceInputButtonProps) {
  const [stopping, setStopping] = useState(false);

  if (!voice.supported) return null;

  const handleClick = () => {
    if (disabled || stopping) return;
    if (voice.listening) {
      // stop() returns a Promise that resolves once the engine fires its
      // final `result` + `end` events, so the last utterance finalized by
      // the stop is not lost. Forward the resolved transcript to the parent.
      setStopping(true);
      void (async () => {
        try {
          onTranscript(await voice.stop());
        } catch (error) {
          console.error("音声入力の停止に失敗しました。", error);
        } finally {
          setStopping(false);
        }
      })();
    } else {
      voice.start();
    }
  };

  return (
    <div className="relative">
      <button
        type="button"
        aria-label={voice.listening ? "音声入力を停止" : "音声入力"}
        aria-pressed={voice.listening}
        aria-busy={stopping}
        disabled={disabled || stopping}
        onClick={handleClick}
        className="flex h-8 shrink-0 items-center justify-center rounded-lg px-2 text-muted transition-colors hover:bg-accent hover:text-fg disabled:opacity-40"
      >
        {voice.listening ? (
          <MicOff className="h-3.5 w-3.5" aria-hidden="true" />
        ) : (
          <Mic className="h-3.5 w-3.5" aria-hidden="true" />
        )}
      </button>
      {voice.listening && (
        <span
          aria-live="polite"
          className="absolute -bottom-4 left-1/2 -translate-x-1/2 whitespace-nowrap text-[10px] text-danger"
        >
          認識中
        </span>
      )}
      {voice.error && (
        <p role="alert" className="mt-1 text-xs text-danger">
          {voice.error}
        </p>
      )}
    </div>
  );
}
