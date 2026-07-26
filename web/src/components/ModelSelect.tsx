"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Check, Cpu } from "lucide-react";
import { providerIconSrcForOpencodeId } from "@addons/codexbar";
import { cx } from "@/components/ui";
import type { ModelOption } from "@/lib/model-options";

function providerIDFromValue(value: string): string {
  return value ? value.split("::")[0] ?? "" : "";
}

function ModelProviderIcon({ value }: { value: string }) {
  const providerID = providerIDFromValue(value);
  const src = providerIconSrcForOpencodeId(providerID);
  const [broken, setBroken] = useState(false);

  useEffect(() => setBroken(false), [src]);

  if (src && !broken) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt=""
        width={14}
        height={14}
        className="h-3.5 w-3.5 shrink-0 rounded-[3px] object-contain"
        onError={() => setBroken(true)}
      />
    );
  }

  return <Cpu aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />;
}

export function ModelSelect({
  value,
  options,
  disabled,
  onChange,
  className,
  title,
}: {
  value: string;
  options: ModelOption[];
  disabled?: boolean;
  onChange: (value: string) => void;
  className?: string;
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<{
    top: number;
    left: number;
    minWidth: number;
  } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const selected = options.find((option) => option.value === value);
  const groupedOptions = useMemo(
    () =>
      [...new Set(options.map((option) => option.group))].map((group) => ({
        group,
        options: options.filter((option) => option.group === group),
      })),
    [options],
  );

  const updateMenuPosition = useCallback(() => {
    const root = rootRef.current;
    if (!root || typeof window === "undefined") return;
    const rect = root.getBoundingClientRect();
    const menuRect = menuRef.current?.getBoundingClientRect();
    const viewportPadding = 16;
    const gap = 4;
    const menuWidth = Math.min(
      menuRect?.width || Math.max(rect.width, 224),
      window.innerWidth - viewportPadding * 2,
    );
    const menuHeight = Math.min(
      menuRect?.height || 320,
      window.innerHeight - viewportPadding * 2,
    );
    const topAbove = rect.top - menuHeight - gap;
    const topBelow = rect.bottom + gap;
    const top =
      topAbove >= viewportPadding
        ? topAbove
        : Math.min(topBelow, window.innerHeight - viewportPadding - menuHeight);
    setMenuPosition({
      top: Math.max(viewportPadding, top),
      left: Math.max(
        viewportPadding,
        Math.min(
          rect.right - menuWidth,
          window.innerWidth - viewportPadding - menuWidth,
        ),
      ),
      minWidth: rect.width,
    });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    updateMenuPosition();
  }, [open, groupedOptions, updateMenuPosition]);

  useEffect(() => {
    if (!open) return;
    updateMenuPosition();

    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (
        !rootRef.current?.contains(target) &&
        !menuRef.current?.contains(target)
      ) {
        setOpen(false);
      }
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", updateMenuPosition);
    window.addEventListener("scroll", updateMenuPosition, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", updateMenuPosition);
      window.removeEventListener("scroll", updateMenuPosition, true);
    };
  }, [open, updateMenuPosition]);

  const menu = open && !disabled && (
    <div
      ref={menuRef}
      role="listbox"
      aria-label="モデル"
      className="fixed z-50 max-h-80 w-max max-w-[min(22rem,calc(100vw-2rem))] overflow-y-auto rounded-xl border border-border bg-surface p-1 text-xs shadow-xl"
      style={{
        top: menuPosition?.top ?? 0,
        left: menuPosition?.left ?? 0,
        minWidth: menuPosition?.minWidth,
        visibility: menuPosition ? undefined : "hidden",
      }}
    >
      {groupedOptions.map(({ group, options: groupOptions }) => (
        <div key={group}>
          <div className="px-2 py-1 text-[11px] font-semibold text-faint">
            {group}
          </div>
          {groupOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              role="option"
              aria-selected={option.value === value}
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
              className={cx(
                "flex w-full appearance-none items-center gap-2 rounded-lg border-0 bg-transparent px-2 py-1.5 text-left text-muted hover:bg-surface-2 hover:text-text focus:bg-surface-2 focus:text-text focus:outline-none",
                option.value === value && "bg-surface-2 text-text",
              )}
            >
              <ModelProviderIcon value={option.value} />
              <span className="min-w-0 flex-1 truncate">{option.label}</span>
              {option.value === value && (
                <Check aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-primary" />
              )}
            </button>
          ))}
        </div>
      ))}
    </div>
  );

  return (
    <div ref={rootRef} className={cx("relative inline-flex min-w-0", className)}>
      <button
        type="button"
        value={value}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="モデル"
        title={title ?? selected?.label ?? "モデル"}
        onClick={() => setOpen((current) => !current)}
        className={cx(
          "group inline-flex h-8 min-w-0 appearance-none items-center gap-1.5 rounded-lg border border-border bg-bg px-2 text-xs font-medium text-muted shadow-sm transition-colors focus:ring-2 focus:ring-primary/30 focus:outline-none hover:bg-surface-2 hover:text-text focus:border-border-strong focus:bg-surface-2 focus:text-text",
          disabled && "cursor-not-allowed opacity-40",
        )}
      >
        <ModelProviderIcon value={value} />
        <span className="min-w-0 truncate">{selected?.label ?? "モデル"}</span>
        <ChevronDown aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-faint" />
      </button>

      {menu && createPortal(menu, document.body)}
    </div>
  );
}
