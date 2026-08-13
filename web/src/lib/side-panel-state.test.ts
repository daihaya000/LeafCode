import { beforeEach, describe, expect, it } from "vitest";
import {
  readChatTab,
  readShowDiff,
  readSidePanel,
  writeChatTab,
  writeShowDiff,
  writeSidePanel,
} from "./side-panel-state";

describe("side-panel-state", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("uses the default side panel when nothing is stored", () => {
    expect(readSidePanel()).toBe("graph");
    expect(readShowDiff()).toBe(true);
    expect(readChatTab()).toBe("chat");
  });

  it("writes and reads with the webui:side-panel: prefix", () => {
    writeSidePanel("pty");
    expect(readSidePanel()).toBe("pty");
    expect(localStorage.getItem("webui:side-panel:kind")).toBe("pty");

    writeShowDiff(false);
    expect(readShowDiff()).toBe(false);
    expect(localStorage.getItem("webui:side-panel:show-diff")).toBe("0");

    writeChatTab("diff");
    expect(readChatTab()).toBe("diff");
    expect(localStorage.getItem("webui:side-panel:tab")).toBe("diff");
  });

  it("falls back to legacy flat keys", () => {
    localStorage.setItem("webui:side-panel", "files");
    localStorage.setItem("webui:side-show", "0");
    localStorage.setItem("webui:side-tab", "diff");
    expect(readSidePanel()).toBe("files");
    expect(readShowDiff()).toBe(false);
    expect(readChatTab()).toBe("diff");
  });

  it("prefers the new keys over legacy fallbacks", () => {
    localStorage.setItem("webui:side-panel", "files");
    localStorage.setItem("webui:side-panel:kind", "pty");
    expect(readSidePanel()).toBe("pty");
  });

  it("ignores unknown stored values", () => {
    localStorage.setItem("webui:side-panel:kind", "unknown");
    localStorage.setItem("webui:side-panel:tab", "graph");
    expect(readSidePanel()).toBe("graph");
    expect(readChatTab()).toBe("chat");
  });
});
