import { useEffect, useRef } from "react";
import { SessionSwitcher } from "./SessionSwitcher";

const FOCUSABLE_SELECTOR =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

type SessionSwitcherDialogProps = {
  workspaceId: string;
  directory: string;
  currentSessionId: string;
  onSwitch: () => Promise<void>;
  onClose: () => void;
};

export function SessionSwitcherDialog({
  workspaceId,
  directory,
  currentSessionId,
  onSwitch,
  onClose,
}: SessionSwitcherDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  const getFocusableElements = () =>
    Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR) ?? [],
    ).filter((element) => !element.matches(":disabled"));

  useEffect(() => {
    previousFocusRef.current = document.activeElement as HTMLElement | null;
    const firstFocusable = getFocusableElements()[0];
    (firstFocusable ?? dialogRef.current)?.focus();

    return () => {
      const previousFocus = previousFocusRef.current;
      if (!previousFocus) return;
      window.setTimeout(() => {
        // Do not steal focus from a replacement dialog or from a user action
        // that happened while React was removing this dialog.
        if (
          previousFocus.isConnected &&
          (document.activeElement === document.body || document.activeElement === null)
        ) {
          previousFocus.focus();
        }
      }, 0);
    };
  }, []);

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4">
      <div
        role="presentation"
        className="fixed inset-0 bg-black/50"
        onClick={onClose}
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="セッションを切り替え・追加"
        aria-describedby="session-switcher-desc"
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onClose();
            return;
          }
          if (event.key !== "Tab") return;

          const focusable = getFocusableElements();
          if (focusable.length === 0) {
            event.preventDefault();
            dialogRef.current?.focus();
            return;
          }

          const first = focusable[0];
          const last = focusable.at(-1)!;
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }}
        className="relative max-h-[calc(100vh-2rem)] max-w-[calc(100vw-2rem)] overflow-y-auto rounded-lg border border-border bg-surface p-4 shadow-lg"
      >
        <p id="session-switcher-desc" className="sr-only">
          セッションを選択するか、新しいセッションを追加します。
        </p>
        <SessionSwitcher
          workspaceId={workspaceId}
          directory={directory}
          currentSessionId={currentSessionId}
          onSwitch={() => void onSwitch()}
        />
      </div>
    </div>
  );
}
