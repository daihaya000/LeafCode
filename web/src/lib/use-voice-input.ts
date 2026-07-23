"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// ---------------------------------------------------------------------------
// Minimal local types for Web Speech API (not in TypeScript DOM lib)
// ---------------------------------------------------------------------------

interface SpeechRecognition {
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  addEventListener(
    type: string,
    listener: (event: SpeechRecognitionEvent | SpeechRecognitionErrorEvent) => void,
  ): void;
  removeEventListener(
    type: string,
    listener: (event: SpeechRecognitionEvent | SpeechRecognitionErrorEvent) => void,
  ): void;
}

interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList;
}

interface SpeechRecognitionResultList {
  readonly length: number;
  [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionResult {
  readonly isFinal: boolean;
  readonly length: number;
  [index: number]: SpeechRecognitionAlternative;
}

interface SpeechRecognitionAlternative {
  readonly transcript: string;
  readonly confidence: number;
}

interface SpeechRecognitionErrorEvent extends Event {
  readonly error: string;
}

// ---------------------------------------------------------------------------
// Public interfaces
// ---------------------------------------------------------------------------

export interface UseVoiceInputOptions {
  disabled?: boolean;
}

export interface UseVoiceInputReturn {
  supported: boolean;
  listening: boolean;
  start: () => void;
  stop: () => string;
  transcript: string;
  error: string | null;
  clearError: () => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ERROR_MESSAGES: Record<string, string> = {
  "not-allowed":
    "マイクの使用が許可されていません。ブラウザの設定でマイクを許可してください。",
  "audio-capture":
    "マイクが見つかりません。マイクが接続されているか確認してください。",
  "language-not-supported":
    "この言語は音声認識に対応していません。",
  "service-not-allowed":
    "音声認識サービスが利用できません。",
};

const SILENT_ERRORS = new Set(["no-speech", "aborted"]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function detectSpeechRecognition():
  | { new (): SpeechRecognition }
  | undefined {
  if (typeof window === "undefined") return undefined;
  return (
    (window as unknown as Record<string, unknown>).SpeechRecognition ??
    (window as unknown as Record<string, unknown>).webkitSpeechRecognition
  ) as { new (): SpeechRecognition } | undefined;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useVoiceInput(
  options: UseVoiceInputOptions = {},
): UseVoiceInputReturn {
  const { disabled = false } = options;
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const transcriptRef = useRef("");
  const listeningRef = useRef(false);
  const [supported] = useState(() => !!detectSpeechRecognition());
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Lazily create the SpeechRecognition instance once.
  const getRecognition = useCallback((): SpeechRecognition | null => {
    if (recognitionRef.current) return recognitionRef.current;
    const Ctor = detectSpeechRecognition();
    if (!Ctor) return null;
    const recognition = new Ctor();
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.addEventListener("start", () => {
      listeningRef.current = true;
      setListening(true);
      setError(null);
      transcriptRef.current = "";
      setTranscript("");
    });

    recognition.addEventListener("end", () => {
      listeningRef.current = false;
      setListening(false);
    });

    recognition.addEventListener("result", (event) => {
      const e = event as SpeechRecognitionEvent;
      const results = e.results;
      if (!results) return;
      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        if (result.isFinal) {
          const text = result[0]?.transcript ?? "";
          if (text) {
            transcriptRef.current = transcriptRef.current
              ? `${transcriptRef.current} ${text}`
              : text;
            setTranscript(transcriptRef.current);
          }
        }
      }
    });

    recognition.addEventListener("error", (event) => {
      const e = event as SpeechRecognitionErrorEvent;
      const code = e.error;
      if (SILENT_ERRORS.has(code)) {
        // Reset silently
        listeningRef.current = false;
        setListening(false);
        return;
      }
      setError(ERROR_MESSAGES[code] ?? "音声認識でエラーが発生しました。");
      listeningRef.current = false;
      setListening(false);
    });

    recognitionRef.current = recognition;
    return recognition;
  }, []);

  const start = useCallback(() => {
    if (disabled) return;
    const recognition = getRecognition();
    if (!recognition) return;
    try {
      recognition.start();
    } catch {
      // Already started — ignore.
    }
  }, [disabled, getRecognition]);

  const stop = useCallback((): string => {
    const recognition = recognitionRef.current;
    if (recognition) {
      try {
        recognition.stop();
      } catch {
        // Not started — ignore.
      }
    }
    const text = transcriptRef.current;
    return text;
  }, []);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  // Auto-stop when disabled becomes true while listening.
  useEffect(() => {
    if (disabled && listeningRef.current) {
      const recognition = recognitionRef.current;
      if (recognition) {
        try {
          recognition.stop();
        } catch {
          // ignore
        }
      }
      listeningRef.current = false;
      setListening(false);
      transcriptRef.current = "";
      setTranscript("");
    }
  }, [disabled]);

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      const recognition = recognitionRef.current;
      if (recognition) {
        try {
          recognition.abort();
        } catch {
          // ignore
        }
        recognitionRef.current = null;
      }
    };
  }, []);

  return {
    supported,
    listening,
    start,
    stop,
    transcript,
    error,
    clearError,
  };
}
