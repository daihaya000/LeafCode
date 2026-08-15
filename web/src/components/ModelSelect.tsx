"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Check, Cpu, Eye, ImageIcon } from "lucide-react";
import { providerIconSrcForOpencodeId } from "@addons/codexbar";
import { cx } from "@/components/ui";
import type { ModelOption } from "@/lib/model-options";

function providerIDFromValue(value: string): string {
  return value ? value.split("::")[0] ?? "" : "";
}

const EMPTY_PROVIDER_SET: ReadonlySet<string> = new Set();

function ModelProviderIcon({ value }: { value: string }) {
  const providerID = providerIDFromValue(value);
  const src =
    value === "auto"
      ? "/icon-192.png"
      : providerIconSrcForOpencodeId(providerID);
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
  ariaLabel = "モデル",
  emptyLabel = "モデル",
  limitedProviders,
  imageAnalysisAvailable = false,
  autoImageSupported = false,
}: {
  value: string;
  options: ModelOption[];
  disabled?: boolean;
  onChange: (value: string) => void;
  className?: string;
  title?: string;
  ariaLabel?: string;
  emptyLabel?: string;
  /**
   * OpenCode provider ids whose CodexBar snapshot reports the provider at/over
   * its rate limit. Models under a limited provider render in danger color in
   * the dropdown so the user can avoid picking a model that will 429.
   */
  limitedProviders?: ReadonlySet<string>;
  /** Shows an eye badge on text-only models that can use image pre-analysis. */
  imageAnalysisAvailable?: boolean;
  /**
   * Whether the Auto candidate pool contains at least one image-capable
   * model. Auto has no capabilities of its own, so its entry in the dropdown
   * is marked from the connected pool (the same check the composer uses
   * before sending an image under Auto).
   */
  autoImageSupported?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [menuPosition, setMenuPosition] = useState<{
    top: number;
    left: number;
    minWidth: number;
  } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listboxId = useId();
  const selected = options.find((option) => option.value === value);
  const limitedSet = limitedProviders ?? EMPTY_PROVIDER_SET;
  const groupedOptions = useMemo(
    () =>
      [...new Set(options.map((option) => option.group))].map((group) => ({
        group,
        options: options.filter((option) => option.group === group),
      })),
    [options],
  );
  const flattenedOptions = useMemo(
    () => groupedOptions.flatMap(({ options: groupOptions }) => groupOptions),
    [groupedOptions],
  );
  const selectedIndex = Math.max(
    0,
    flattenedOptions.findIndex((option) => option.value === value),
  );

  useEffect(() => {
    setHighlightedIndex((current) =>
      Math.min(current, Math.max(0, flattenedOptions.length - 1)),
    );
  }, [flattenedOptions.length]);

  const chooseOption = useCallback(
    (option: ModelOption) => {
      onChange(option.value);
      setOpen(false);
      triggerRef.current?.focus();
    },
    [onChange],
  );

  const updateMenuPosition = useCallback(() => {
    const root = rootRef.current;
    if (!root || typeof window === "undefined") return;
    const rect = root.getBoundingClientRect();
    const menuRect = menuRef.current?.getBoundingClientRect();
    const viewportPadding = 16;
    const gap = 4;
    const maxMenuWidth = window.innerWidth - viewportPadding * 2;
    // The menu enforces `min-width: rect.width`, so its laid-out width is at
    // least as wide as the trigger even on the first frame where the content
    // still measures narrower. Clamp that effective width to the viewport.
    const menuWidth = Math.min(
      Math.max(menuRect?.width || Math.max(rect.width, 224), rect.width),
      maxMenuWidth,
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
      minWidth: Math.min(rect.width, maxMenuWidth),
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
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
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
      id={listboxId}
      aria-label={ariaLabel}
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
          {groupOptions.map((option) => {
            const optionIndex = flattenedOptions.findIndex(
              (candidate) => candidate.value === option.value,
            );
            const optionProviderID = providerIDFromValue(option.value);
            const optionLimited =
              option.value !== "auto" && limitedSet.has(optionProviderID);
            const optionImage =
              option.image || (option.value === "auto" && autoImageSupported);
            const usesImageAnalysis = imageAnalysisAvailable && !optionImage;
            return (
            <button
              key={option.value}
              type="button"
              role="option"
              aria-selected={option.value === value}
              id={`${listboxId}-option-${optionIndex}`}
              onMouseEnter={() => setHighlightedIndex(optionIndex)}
              onClick={() => chooseOption(option)}
              title={optionLimited ? "プロバイダが制限中（レートリミット到達）" : undefined}
              className={cx(
                "flex w-full appearance-none items-center gap-2 rounded-lg border-0 bg-transparent px-2 py-1.5 text-left text-muted hover:bg-surface-2 hover:text-text focus:bg-surface-2 focus:text-text focus:outline-none",
                option.value === value && "bg-surface-2 text-text",
                optionIndex === highlightedIndex && "ring-1 ring-primary/40",
                optionLimited && "text-danger",
              )}
            >
              <ModelProviderIcon value={option.value} />
              <span className="min-w-0 flex-1 truncate">{option.label}</span>
              {optionImage && (
                <ImageIcon
                  aria-label="画像入力対応"
                  className="h-3.5 w-3.5 shrink-0 text-primary"
                />
              )}
              {usesImageAnalysis && (
                <Eye
                  aria-label="画像事前解析を使用"
                  className="h-3.5 w-3.5 shrink-0 text-working"
                />
              )}
              {option.value === value && (
                <Check aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-primary" />
              )}
            </button>
            );
          })}
        </div>
      ))}
    </div>
  );

  return (
    <div ref={rootRef} className={cx("relative inline-flex min-w-0", className)}>
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-autocomplete="none"
        aria-activedescendant={
          open && flattenedOptions[highlightedIndex]
            ? `${listboxId}-option-${highlightedIndex}`
            : undefined
        }
        aria-label={ariaLabel}
        value={value}
        title={
          title ??
          (selected && limitedSet.has(providerIDFromValue(selected.value))
            ? `${selected.label ?? "モデル"}（プロバイダ制限中）`
            : selected?.label ?? "モデル")
        }
        onClick={() =>
          setOpen((current) => {
            if (!current) setHighlightedIndex(selectedIndex);
            return !current;
          })
        }
        onKeyDown={(event) => {
          if (event.key === "Escape" && open) {
            event.preventDefault();
            setOpen(false);
            return;
          }
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            if (!open) {
              setHighlightedIndex(selectedIndex);
              setOpen(true);
              return;
            }
            const delta = event.key === "ArrowDown" ? 1 : -1;
            setHighlightedIndex((current) =>
              Math.min(
                Math.max(0, current + delta),
                Math.max(0, flattenedOptions.length - 1),
              ),
            );
            return;
          }
          if ((event.key === "Enter" || event.key === " ") && open) {
            event.preventDefault();
            const option = flattenedOptions[highlightedIndex];
            if (option) chooseOption(option);
          }
        }}
        className={cx(
          "group inline-flex h-8 min-w-0 appearance-none items-center gap-1.5 rounded-lg border border-border bg-bg px-2 text-xs font-medium text-muted transition-colors focus:ring-2 focus:ring-primary/30 focus:outline-none hover:bg-surface-2 hover:text-text focus:border-border-strong focus:bg-surface-2 focus:text-text",
          disabled && "cursor-not-allowed opacity-40",
          value !== "auto" &&
            limitedSet.has(providerIDFromValue(value)) &&
            "text-danger",
        )}
      >
        <ModelProviderIcon value={value} />
        <span className="min-w-0 truncate">{selected?.label ?? emptyLabel}</span>
        {(selected?.image || (value === "auto" && autoImageSupported)) && (
          <ImageIcon
            aria-label="画像入力対応"
            className="h-3.5 w-3.5 shrink-0 text-primary"
          />
        )}
        {imageAnalysisAvailable &&
          !(selected?.image || (value === "auto" && autoImageSupported)) && (
            <Eye
              aria-label="画像事前解析を使用"
              className="h-3.5 w-3.5 shrink-0 text-working"
            />
          )}
        <ChevronDown aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-faint" />
      </button>

      {menu && createPortal(menu, document.body)}
    </div>
  );
}
