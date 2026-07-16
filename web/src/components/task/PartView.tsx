"use client";

import { memo, useState } from "react";
import {
  Bot,
  Brain,
  Check,
  ChevronRight,
  CircleAlert,
  FileDiff,
  FilePen,
  FileText,
  Globe,
  ListTodo,
  Loader2,
  Paperclip,
  Search,
  Terminal,
  Wrench,
} from "lucide-react";
import { cx } from "@/components/ui";
import type { Part, ToolState } from "@/lib/types";
import { Markdown } from "./Markdown";

function toolIcon(tool: string) {
  const t = tool.toLowerCase();
  if (t.includes("bash") || t.includes("shell")) return Terminal;
  if (t.includes("edit") || t.includes("write") || t.includes("patch")) return FilePen;
  if (t.includes("read")) return FileText;
  if (t.includes("glob") || t.includes("grep") || t.includes("find")) return Search;
  if (t.includes("web") || t.includes("fetch")) return Globe;
  if (t.includes("todo")) return ListTodo;
  if (t.includes("task") || t.includes("agent")) return Bot;
  return Wrench;
}

function asString(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function toolSummary(tool: string, state: ToolState | undefined): string {
  if (state?.title) return state.title;
  const input = state?.input ?? {};
  const t = tool.toLowerCase();
  if (t.includes("bash") || t.includes("shell")) {
    return (
      asString(input.description) ?? asString(input.command)?.slice(0, 120) ?? tool
    );
  }
  const filePath =
    asString(input.filePath) ?? asString(input.file_path) ?? asString(input.path);
  if (filePath) return filePath;
  return (
    asString(input.pattern) ??
    asString(input.url) ??
    asString(input.query) ??
    asString(input.description) ??
    tool
  );
}

function compactJson(value: unknown, max = 600): string {
  try {
    const text = JSON.stringify(value, null, 1);
    return text.length > max ? text.slice(0, max) + "…" : text;
  } catch {
    return String(value);
  }
}

const ToolPartView = memo(function ToolPartView({ part }: { part: Part }) {
  const [open, setOpen] = useState(false);
  const state = part.state;
  const status = state?.status ?? "pending";
  const Icon = toolIcon(part.tool ?? "");
  const summary = toolSummary(part.tool ?? "tool", state);
  const output = state?.output ?? state?.error ?? "";
  const hasDetail = Boolean(output || state?.input);

  return (
    <div
      className={cx(
        "overflow-hidden rounded-lg border text-sm",
        status === "error" ? "border-danger/40" : "border-border",
      )}
    >
      <button
        type="button"
        onClick={() => hasDetail && setOpen((v) => !v)}
        className={cx(
          "flex w-full items-center gap-2.5 bg-surface-2 px-3 py-2 text-left",
          hasDetail && "cursor-pointer hover:bg-surface-3",
        )}
      >
        <Icon className="h-4 w-4 shrink-0 text-muted" />
        <span className="shrink-0 font-mono text-xs font-medium text-muted">
          {part.tool}
        </span>
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-faint">
          {summary}
        </span>
        {status === "running" || status === "pending" ? (
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-working" />
        ) : status === "error" ? (
          <CircleAlert className="h-3.5 w-3.5 shrink-0 text-danger" />
        ) : (
          <Check className="h-3.5 w-3.5 shrink-0 text-success/70" />
        )}
        {hasDetail && (
          <ChevronRight
            className={cx(
              "h-3.5 w-3.5 shrink-0 text-faint transition-transform",
              open && "rotate-90",
            )}
          />
        )}
      </button>
      {open && (
        <div className="max-h-72 space-y-2 overflow-y-auto border-t border-border bg-surface px-3 py-2">
          {state?.input !== undefined && Object.keys(state.input).length > 0 && (
            <pre className="whitespace-pre-wrap font-mono text-xs text-muted">
              {compactJson(state.input)}
            </pre>
          )}
          {output && (
            <pre
              className={cx(
                "whitespace-pre-wrap font-mono text-xs",
                status === "error" ? "text-danger" : "text-text/80",
              )}
            >
              {output.length > 6000 ? output.slice(0, 6000) + "\n…" : output}
            </pre>
          )}
        </div>
      )}
    </div>
  );
});

const ReasoningView = memo(function ReasoningView({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  if (!text.trim()) return null;
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex cursor-pointer items-center gap-1.5 text-xs text-faint hover:text-muted"
      >
        <Brain className="h-3.5 w-3.5" />
        思考
        <ChevronRight
          className={cx("h-3 w-3 transition-transform", open && "rotate-90")}
        />
      </button>
      {open && (
        <div className="mt-1.5 border-l-2 border-border pl-3 text-sm text-muted">
          <Markdown text={text} />
        </div>
      )}
    </div>
  );
});

export const PartView = memo(function PartView({
  part,
  role,
  onFileClick,
}: {
  part: Part;
  role: "user" | "assistant";
  onFileClick?: (path: string) => void;
}) {
  switch (part.type) {
    case "text": {
      const text = part.text ?? "";
      if (!text.trim()) return null;
      if (role === "user") {
        return (
          <div className="ml-auto max-w-[88%] rounded-2xl rounded-br-md bg-surface-3 px-4 py-2.5">
            <div className="md text-[0.925rem] whitespace-pre-wrap">{text}</div>
          </div>
        );
      }
      return <Markdown text={text} />;
    }
    case "reasoning":
      return <ReasoningView text={part.text ?? ""} />;
    case "tool":
      return <ToolPartView part={part} />;
    case "file": {
      const name = part.filename ?? "file";
      return (
        <button
          type="button"
          onClick={() => onFileClick?.(name)}
          className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-border bg-surface-2 px-3 py-1 font-mono text-xs text-muted hover:text-text"
        >
          <Paperclip className="h-3 w-3" />
          {name}
        </button>
      );
    }
    case "patch": {
      const files = part.files ?? [];
      if (files.length === 0) return null;
      return (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="inline-flex items-center gap-1 text-xs text-faint">
            <FileDiff className="h-3.5 w-3.5" />
            変更:
          </span>
          {files.map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => onFileClick?.(f)}
              className="cursor-pointer rounded-full border border-border bg-surface-2 px-2.5 py-0.5 font-mono text-xs text-muted hover:text-text"
            >
              {f.split(/[\\/]/).pop()}
            </button>
          ))}
        </div>
      );
    }
    case "agent":
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-2 px-3 py-1 text-xs text-muted">
          <Bot className="h-3 w-3" />
          {part.name ?? "agent"}
        </span>
      );
    // step-start / step-finish / snapshot are internal markers — not rendered
    default:
      return null;
  }
});
