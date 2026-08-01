import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PermissionCard } from "./PermissionCard";
import type { PermissionRequest } from "@/lib/types";

const request: PermissionRequest = {
  id: "perm-1",
  version: "v1",
  sessionID: "session-1",
  permission: "edit",
  patterns: [],
  receivedAt: Date.now(),
};

describe("PermissionCard", () => {
  afterEach(() => cleanup());

  it("does not submit duplicate responses from rapid controls", () => {
    let resolveReply: (() => void) | undefined;
    const onReply = vi.fn(
      () => new Promise<void>((resolve) => { resolveReply = resolve; }),
    );

    render(
      <PermissionCard
        request={request}
        onReply={onReply}
        onEnableFullAccess={vi.fn()}
      />,
    );

    const select = screen.getByRole("combobox");
    fireEvent.change(select, { target: { value: "always" } });
    fireEvent.change(select, { target: { value: "always" } });

    expect(onReply).toHaveBeenCalledTimes(1);
    resolveReply?.();
  });
});
