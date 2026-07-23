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
  // Index of the first result that changed in this event. The `results` list
  // is cumulative across the whole session, so iterating from 0 on every
  // `result` event re-processes already-finalized results and duplicates the
  // transcript. Start from `resultIndex` instead.
  resultIndex: number;
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
  stop: () => Promise<string>;
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

type RecognitionState =
  | "idle"
  | "starting"
  | "listening"
  | "stopping"
  | "interrupted";

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
  // One SpeechRecognition instance cannot identify an event's originating
  // session. Keep an interrupted session closed until its `end` arrives, so
  // its delayed events cannot be mistaken for a newly started session.
  const stateRef = useRef<RecognitionState>("idle");
  const processedResultIndexRef = useRef(0);
  const pendingStopPromiseRef = useRef<Promise<string> | null>(null);
  const pendingStopResolveRef = useRef<((text: string) => void) | null>(null);
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Feature detection must run only on the client after mount to keep SSR and
  // first client render identical (avoid hydration mismatch). The result is
  // captured once and never changes for the lifetime of the hook.
  useEffect(() => {
    setSupported(!!detectSpeechRecognition());
  }, []);

  const settlePendingStop = useCallback((text: string) => {
    const resolve = pendingStopResolveRef.current;
    pendingStopResolveRef.current = null;
    pendingStopPromiseRef.current = null;
    resolve?.(text);
  }, []);

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
      if (stateRef.current !== "starting") return;
      stateRef.current = "listening";
      listeningRef.current = true;
      setListening(true);
      setError(null);
    });

    recognition.addEventListener("end", () => {
      if (stateRef.current === "idle") return;
      const interrupted = stateRef.current === "interrupted";
      stateRef.current = "idle";
      listeningRef.current = false;
      setListening(false);
      settlePendingStop(interrupted ? "" : transcriptRef.current);
    });

    recognition.addEventListener("result", (event) => {
      if (
        stateRef.current !== "listening" &&
        stateRef.current !== "stopping"
      ) {
        return;
      }
      const e = event as SpeechRecognitionEvent;
      const results = e.results;
      if (!results) return;
      // `results` is cumulative for the whole session; `resultIndex` is the
      // first index that changed in this event. Start there to avoid
      // re-appending already-finalized results.
      const eventResultIndex =
        typeof e.resultIndex === "number" && e.resultIndex >= 0
          ? e.resultIndex
          : processedResultIndexRef.current;
      const start = Math.max(eventResultIndex, processedResultIndexRef.current);
      for (let i = start; i < results.length; i++) {
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
      processedResultIndexRef.current = Math.max(
        processedResultIndexRef.current,
        results.length,
      );
    });

    recognition.addEventListener("error", (event) => {
      if (
        stateRef.current !== "starting" &&
        stateRef.current !== "listening" &&
        stateRef.current !== "stopping"
      ) {
        return;
      }
      const e = event as SpeechRecognitionErrorEvent;
      const code = e.error;
      // Web Speech API follows error with end. Block a replacement session
      // until that end event has closed this one.
      stateRef.current = "interrupted";
      listeningRef.current = false;
      setListening(false);
      settlePendingStop(transcriptRef.current);
      if (SILENT_ERRORS.has(code)) {
        setError(null);
        return;
      }
      setError(ERROR_MESSAGES[code] ?? "音声認識でエラーが発生しました。");
    });

    recognitionRef.current = recognition;
    return recognition;
  }, [settlePendingStop]);

  const start = useCallback(() => {
    if (disabled) return;
    if (stateRef.current !== "idle") return;
    const recognition = getRecognition();
    if (!recognition) return;
    stateRef.current = "starting";
    transcriptRef.current = "";
    processedResultIndexRef.current = 0;
    setTranscript("");
    try {
      recognition.start();
    } catch {
      stateRef.current = "idle";
      listeningRef.current = false;
      setListening(false);
    }
  }, [disabled, getRecognition]);

  const stop = useCallback((): Promise<string> => {
    const recognition = recognitionRef.current;
    if (stateRef.current === "stopping" && pendingStopPromiseRef.current) {
      return pendingStopPromiseRef.current;
    }
    // Not listening (never started, or already ended): resolve immediately
    // with whatever transcript is currently finalized.
    if (!recognition || stateRef.current !== "listening") {
      return Promise.resolve(transcriptRef.current);
    }
    stateRef.current = "stopping";
    const pendingStop = new Promise<string>((resolve) => {
      pendingStopResolveRef.current = resolve;
    });
    pendingStopPromiseRef.current = pendingStop;
    try {
      recognition.stop();
    } catch {
      // A failed stop cannot safely be followed by a new start until the
      // current native session is ended or aborted.
      stateRef.current = "interrupted";
      listeningRef.current = false;
      setListening(false);
      settlePendingStop(transcriptRef.current);
      try {
        recognition.abort();
      } catch {
        stateRef.current = "idle";
      }
    }
    return pendingStop;
  }, [settlePendingStop]);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  // Auto-stop an active (including not-yet-started) session when disabled.
  useEffect(() => {
    if (disabled && stateRef.current !== "idle") {
      const recognition = recognitionRef.current;
      const shouldStopRecognition =
        stateRef.current === "starting" || stateRef.current === "listening";
      stateRef.current = "interrupted";
      listeningRef.current = false;
      setListening(false);
      transcriptRef.current = "";
      setTranscript("");
      settlePendingStop("");
      if (recognition && shouldStopRecognition) {
        try {
          recognition.stop();
        } catch {
          try {
            recognition.abort();
          } catch {
            stateRef.current = "idle";
          }
        }
      }
    }
  }, [disabled, settlePendingStop]);

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      const recognition = recognitionRef.current;
      stateRef.current = "interrupted";
      listeningRef.current = false;
      transcriptRef.current = "";
      settlePendingStop("");
      if (recognition) {
        try {
          recognition.abort();
        } catch {
          // ignore
        }
        recognitionRef.current = null;
      }
    };
  }, [settlePendingStop]);

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
