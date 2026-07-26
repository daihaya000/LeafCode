import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DiffPane } from "./DiffPane";
import type { DiffFilesPayload } from "@/lib/types";

const { getJson, postJson } = vi.hoisted(() => ({
  getJson: vi.fn(),
  postJson: vi.fn(),
}));

vi.mock("@/lib/client", () => ({
  getJson,
  postJson,
}));

function payload(label: string): DiffFilesPayload {
  return {
    git: true,
    branch: "main",
    additions: 1,
    deletions: 0,
    files: [
      {
        path: `src/${label}.ts`,
        additions: 1,
        deletions: 0,
        binary: false,
        untracked: false,
        hunks: [],
      },
    ],
  };
}

describe("DiffPane directory race", () => {
  beforeEach(() => {
    getJson.mockReset();
    postJson.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("drops a stale diff response after the directory changes", async () => {
    let resolveOld: (value: DiffFilesPayload) => void = () => undefined;
    const oldPending = new Promise<DiffFilesPayload>((resolve) => {
      resolveOld = resolve;
    });
    let diffCalls = 0;
    getJson.mockImplementation((url: string) => {
      if (String(url).includes("/api/diff/files")) {
        diffCalls += 1;
        if (diffCalls === 1) return oldPending;
        return Promise.resolve(payload("new"));
      }
      if (String(url).includes("/api/git/branches")) {
        return Promise.resolve({
          branches: [],
          current: "main",
          defaultTarget: "main",
        });
      }
      if (String(url).includes("/api/git/pr")) {
        return Promise.resolve({ available: false });
      }
      return Promise.resolve({});
    });

    const { rerender } = render(
      <DiffPane directory="/repo-a" refreshKey={0} />,
    );
    await act(async () => {
      await Promise.resolve();
    });

    rerender(<DiffPane directory="/repo-b" refreshKey={0} />);
    await screen.findByText("new.ts");

    await act(async () => {
      resolveOld(payload("stale"));
      await Promise.resolve();
    });

    expect(screen.queryByText("stale.ts")).toBeNull();
    expect(screen.getByText("new.ts")).toBeTruthy();
  });
});
