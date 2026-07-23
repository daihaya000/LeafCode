import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { getJson, ocJson, sendJson } = vi.hoisted(() => ({
  getJson: vi.fn(),
  ocJson: vi.fn(),
  sendJson: vi.fn(),
}));

vi.mock("@/lib/client", () => ({ getJson, ocJson, sendJson }));

import { SessionSwitcher } from "./SessionSwitcher";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("SessionSwitcher controlled snap-back", () => {
  it("keeps the selected session after onChange without external reset", async () => {
    getJson.mockResolvedValue({
      sessions: [
        { opencodeSessionId: "ses_1", title: "Session 1", updatedAt: "t1" },
        { opencodeSessionId: "ses_2", title: "Session 2", updatedAt: "t2" },
      ],
    });
    sendJson.mockResolvedValue({});
    ocJson.mockResolvedValue({ id: "ses_new" });

    const onSwitch = vi.fn();
    render(
      <SessionSwitcher
        workspaceId="ws1"
        directory="/repo"
        currentSessionId="ses_1"
        onSwitch={onSwitch}
      />,
    );

    const select = await screen.findByRole("combobox", { name: "セッション切替" });
    expect((select as HTMLSelectElement).value).toBe("ses_1");

    fireEvent.change(select, { target: { value: "ses_2" } });

    await waitFor(() => {
      expect((select as HTMLSelectElement).value).toBe("ses_2");
    });
    expect(onSwitch).toHaveBeenCalled();
  });
});
