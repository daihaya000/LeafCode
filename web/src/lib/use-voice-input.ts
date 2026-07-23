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
  // Generation counter: bumped on every session boundary (start, stop/end,
  // disabled-interrupt). `result`/`error` handlers only process events whose
  // originating session generation still matches the current generation, so
  // late-arriving events from an already-interrupted session are dropped.
  const generationRef = useRef(0);
  const activeSessionGenRef = useRef(-1);
  // Resolvers waiting for the `end` event after `stop()` is called.
  const stopResolversRef = useRef<Array<(text: string) => void>>([]);
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
      // Advance generation so any late `result`/`error` events from this
      // session are ignored.
      generationRef.current += 1;
      activeSessionGenRef.current = -1;
      // Resolve any pending stop() promises with the finalized transcript.
      const text = transcriptRef.current;
      const resolvers = stopResolversRef.current;
      stopResolversRef.current = [];
      for (const resolve of resolvers) resolve(text);
    });

    recognition.addEventListener("result", (event) => {
      // Drop events from an already-closed/interrupted session.
      if (activeSessionGenRef.current !== generationRef.current) return;
      const e = event as SpeechRecognitionEvent;
      const results = e.results;
      if (!results) return;
      // `results` is cumulative for the whole session; `resultIndex` is the
      // first index that changed in this event. Start there to avoid
      // re-appending already-finalized results.
      const start = typeof e.resultIndex === "number" ? e.resultIndex : 0;
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
    });

    recognition.addEventListener("error", (event) => {
      // Drop errors from an already-closed/interrupted session.
      if (activeSessionGenRef.current !== generationRef.current) return;
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
    // New session generation.
    generationRef.current += 1;
    activeSessionGenRef.current = generationRef.current;
    try {
      recognition.start();
    } catch {
      // Already started — ignore.
    }
  }, [disabled, getRecognition]);

  const stop = useCallback((): Promise<string> => {
    const recognition = recognitionRef.current;
    // Not listening (never started, or already ended): resolve immediately
    // with whatever transcript is currently finalized.
    if (!recognition || !listeningRef.current) {
      return Promise.resolve(transcriptRef.current);
    }
    return new Promise<string>((resolve) => {
      stopResolversRef.current.push(resolve);
      try {
        recognition.stop();
      } catch {
        // stop() threw — resolve immediately with current transcript.
        const idx = stopResolversRef.current.indexOf(resolve);
        if (idx >= 0) stopResolversRef.current.splice(idx, 1);
        resolve(transcriptRef.current);
      }
    });
  }, []);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  // Auto-stop when disabled becomes true while listening.
  useEffect(() => {
    if (disabled && listeningRef.current) {
      const recognition = recognitionRef.current;
      // Advance generation so late result/error events from this session are
      // dropped before they can revive the transcript.
      generationRef.current += 1;
      activeSessionGenRef.current = -1;
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
      // Drop any pending stop() resolvers — the session was interrupted, not
      // finalized normally.
      stopResolversRef.current = [];
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