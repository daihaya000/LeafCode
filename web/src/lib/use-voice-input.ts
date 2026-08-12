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
  busy: boolean;
  start: () => void;
  stop: () => Promise<string>;
  transcript: string;
  error: string | null;
  clearError: () => void;
  clearTranscript: () => void;
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
  network:
    "音声認識サービスに接続できません。インターネット接続、ブラウザの音声認識設定、またはファイアウォールを確認してください。",
  "bad-grammar":
    "音声認識の文法設定でエラーが発生しました。",
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
  const [busy, setBusy] = useState(false);
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
    // Clear transcript after capturing it for the return value, so the next
    // recording session starts fresh (R51#2).
    transcriptRef.current = "";
    setTranscript("");
    processedResultIndexRef.current = 0;
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
      setBusy(false);
      setError(null);
    });

    recognition.addEventListener("end", () => {
      if (stateRef.current === "idle") return;
      // Keep any finalized text even after a soft interrupt (e.g. no-speech).
      // Disabled/unmount paths clear the transcript before end arrives, so
      // those discards still resolve empty. Forcing "" here used to drop speech
      // that ended on no-speech before the user could click stop.
      const text = transcriptRef.current;
      stateRef.current = "idle";
      listeningRef.current = false;
      setListening(false);
      setBusy(false);
      if (pendingStopResolveRef.current) {
        settlePendingStop(text);
      }
      // Soft end without stop(): leave transcript for VoiceInputButton to
      // auto-commit, then clear via clearTranscript().
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
      let processedUntil = processedResultIndexRef.current;
      for (let i = start; i < results.length; i++) {
        const result = results[i];
        if (!result.isFinal) {
          // Do not advance past a non-final slot. Some engines can surface a
          // provisional result even when interimResults=false; if it later
          // becomes final at the same index, advancing here would drop it.
          break;
        }
        const text = result[0]?.transcript ?? "";
        if (text) {
          transcriptRef.current = transcriptRef.current
            ? `${transcriptRef.current} ${text}`
            : text;
          setTranscript(transcriptRef.current);
        }
        processedUntil = i + 1;
      }
      processedResultIndexRef.current = Math.max(
        processedResultIndexRef.current,
        processedUntil,
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
      setBusy(true);
      // Only settle a user stop() here. Spontaneous errors (no-speech after
      // speech, network, …) must keep finalized text until `end` so the UI can
      // commit it; settlePendingStop would wipe it with no listener.
      if (pendingStopResolveRef.current) {
        settlePendingStop(transcriptRef.current);
      }
      if (SILENT_ERRORS.has(code)) {
        setError(null);
        return;
      }
      const message = ERROR_MESSAGES[code];
      if (!message) {
        console.warn("Speech recognition error", { code });
      }
      setError(
        message ?? `音声認識でエラーが発生しました。（${code || "unknown"}）`,
      );
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
    setBusy(true);
    transcriptRef.current = "";
    processedResultIndexRef.current = 0;
    setTranscript("");
    try {
      recognition.start();
    } catch {
      stateRef.current = "idle";
      listeningRef.current = false;
      setListening(false);
      setBusy(false);
    }
  }, [disabled, getRecognition]);

  const stop = useCallback((): Promise<string> => {
    const recognition = recognitionRef.current;
    if (stateRef.current === "stopping" && pendingStopPromiseRef.current) {
      return pendingStopPromiseRef.current;
    }
    // Not listening (never started, or already ended): resolve immediately
    // with whatever transcript is currently finalized.
    if (
      !recognition ||
      (stateRef.current !== "starting" && stateRef.current !== "listening")
    ) {
      return Promise.resolve(transcriptRef.current);
    }
    stateRef.current = "stopping";
    setBusy(true);
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
      setBusy(true);
      settlePendingStop(transcriptRef.current);
      try {
        recognition.abort();
      } catch {
        stateRef.current = "idle";
        setBusy(false);
      }
    }
    return pendingStop;
  }, [settlePendingStop]);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const clearTranscript = useCallback(() => {
    transcriptRef.current = "";
    setTranscript("");
    processedResultIndexRef.current = 0;
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
      setBusy(true);
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
            setBusy(false);
          }
        }
      }
    }
  }, [disabled, settlePendingStop]);

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      const recognition = recognitionRef.current;
      const activeSession =
        stateRef.current === "starting" ||
        stateRef.current === "listening" ||
        stateRef.current === "stopping";
      if (recognition && activeSession) {
        stateRef.current = "interrupted";
        listeningRef.current = false;
        transcriptRef.current = "";
        settlePendingStop("");
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
    busy,
    start,
    stop,
    transcript,
    error,
    clearError,
    clearTranscript,
  };
}
