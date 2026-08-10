"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowLeft, FileText } from "lucide-react";
import { MobileMenuHeader } from "@/components/shell/MobileMenuHeader";
import { useMobileScrollTarget } from "@/components/shell/MobileScrollTargetContext";
import { Button, cx, Spinner } from "@/components/ui";
import { getJson, sendJson } from "@/lib/client";
import type {
  ProjectSettingFileDto,
  ProjectSettingFileKey,
} from "@/lib/project-settings";

type ProjectSettingsResponse = {
  project: { id: string; name: string; rootPath: string };
  files: ProjectSettingFileDto[];
};

export function ProjectSettingsView({ projectId }: { projectId: string }) {
  const [data, setData] = useState<ProjectSettingsResponse | null>(null);
  const [activeFile, setActiveFile] = useState<ProjectSettingFileKey>("AGENTS.md");
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const setScrollTarget = useMobileScrollTarget();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void getJson<ProjectSettingsResponse>(
      `/api/projects/${encodeURIComponent(projectId)}/settings`,
    )
      .then((result) => {
        if (cancelled) return;
        setData(result);
        const selected = result.files.find((file) => file.key === "AGENTS.md") ?? result.files[0];
        if (selected) {
          setActiveFile(selected.key);
          setDraft(selected.content);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "プロジェクト設定の読み込みに失敗しました",
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const selectFile = (key: ProjectSettingFileKey) => {
    const file = data?.files.find((candidate) => candidate.key === key);
    if (!file) return;
    setActiveFile(key);
    setDraft(file.content);
    setMessage(null);
    setError(null);
  };

  const save = async () => {
    if (saving) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      await sendJson(
        "PATCH",
        `/api/projects/${encodeURIComponent(projectId)}/settings`,
        { file: activeFile, content: draft },
      );
      setData((current) =>
        current
          ? {
              ...current,
              files: current.files.map((file) =>
                file.key === activeFile ? { ...file, exists: true, content: draft } : file,
              ),
            }
          : current,
      );
      setMessage(`${activeFile}を保存しました`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "プロジェクト設定の保存に失敗しました");
    } finally {
      setSaving(false);
    }
  };

  const selected = data?.files.find((file) => file.key === activeFile);

  return (
    <div className="flex h-full flex-col">
      <MobileMenuHeader />
      <div ref={setScrollTarget} className="min-h-0 flex-1 overflow-y-auto">
        <header className="sticky top-0 z-10 border-b border-border bg-bg/90 backdrop-blur">
          <div className="mx-auto flex min-h-14 max-w-6xl items-center gap-3 px-4 py-2">
            <Link
              href="/settings"
              aria-label="全体設定へ戻る"
              className="rounded-lg p-2 text-muted hover:bg-surface-2 hover:text-text"
            >
              <ArrowLeft className="h-4 w-4" />
            </Link>
            <div className="min-w-0">
              <h1 className="truncate text-sm font-semibold">
                {data?.project.name ?? "プロジェクト設定"}
              </h1>
              {data && (
                <p className="truncate font-mono text-[11px] text-faint">
                  {data.project.rootPath}
                </p>
              )}
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-6xl px-4 py-6">
          {loading && (
            <div className="flex items-center gap-2 py-12 text-sm text-muted" role="status">
              <Spinner /> 設定ファイルを読み込み中
            </div>
          )}
          {error && (
            <p
              className="mb-4 rounded-xl border border-danger/30 bg-danger-bg px-4 py-3 text-sm text-danger"
              role="alert"
            >
              {error}
            </p>
          )}
          {message && (
            <p
              className="mb-4 rounded-xl border border-success/30 bg-success-bg px-4 py-3 text-sm text-success"
              role="status"
            >
              {message}
            </p>
          )}

          {data && selected && (
            <div className="grid gap-4 md:grid-cols-[15rem_minmax(0,1fr)]">
              <nav aria-label="プロジェクト設定ファイル" className="space-y-1">
                {data.files.map((file) => (
                  <button
                    key={file.key}
                    type="button"
                    onClick={() => selectFile(file.key)}
                    className={cx(
                      "flex w-full cursor-pointer items-start gap-3 rounded-xl border px-3 py-3 text-left transition-colors",
                      activeFile === file.key
                        ? "border-primary bg-primary/10"
                        : "border-transparent hover:bg-surface-2",
                    )}
                  >
                    <FileText className="mt-0.5 h-4 w-4 shrink-0 text-muted" />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-text">
                        {file.label}
                      </span>
                      <span className="mt-0.5 block text-[11px] text-faint">
                        {file.exists ? "既存ファイル" : "未作成"}
                      </span>
                    </span>
                  </button>
                ))}
              </nav>

              <section className="min-w-0 rounded-xl border border-border bg-surface p-4">
                <div className="mb-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h2 className="font-mono text-sm font-semibold text-text">{selected.key}</h2>
                    <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-faint">
                      {selected.exists ? "編集中" : "保存時に新規作成"}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-faint">{selected.description}</p>
                </div>
                <textarea
                  aria-label={`${selected.label}の内容`}
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  spellCheck={false}
                  className="min-h-[28rem] w-full resize-y rounded-lg border border-border bg-bg px-3 py-3 font-mono text-xs leading-5 text-text outline-none focus:border-primary"
                />
                <div className="mt-3 flex justify-end">
                  <Button type="button" variant="primary" busy={saving} onClick={() => void save()}>
                    {selected.label}を保存
                  </Button>
                </div>
              </section>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
