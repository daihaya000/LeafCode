import { describe, expect, it, vi } from "vitest";
import {
  CliLoginUnsupportedError,
  cliLoginCommand,
  isCliLoginProvider,
  launchCliLogin,
  type CliLoginIo,
} from "./cli-login";

function io(platform: NodeJS.Platform) {
  const spawn = vi.fn();
  return { io: { platform, spawn } satisfies CliLoginIo, spawn };
}

describe("isCliLoginProvider", () => {
  it("accepts the three CLI Proxy providers", () => {
    expect(isCliLoginProvider("cursor")).toBe(true);
    expect(isCliLoginProvider("claude")).toBe(true);
    expect(isCliLoginProvider("commandcode")).toBe(true);
  });

  it("rejects anything else, including prototype keys", () => {
    expect(isCliLoginProvider("openai")).toBe(false);
    expect(isCliLoginProvider("")).toBe(false);
    expect(isCliLoginProvider(undefined)).toBe(false);
    expect(isCliLoginProvider("toString")).toBe(false);
  });
});

describe("cliLoginCommand", () => {
  it("renders the command as typed in a terminal", () => {
    expect(cliLoginCommand("cursor")).toBe("cursor-agent login");
    expect(cliLoginCommand("claude")).toBe("claude login");
    expect(cliLoginCommand("commandcode")).toBe("command-code login");
  });
});

describe("launchCliLogin", () => {
  it("opens a persistent console on Windows", () => {
    const { io: win, spawn } = io("win32");

    expect(launchCliLogin("claude", win)).toEqual({
      command: "claude login",
      terminal: "cmd.exe",
    });
    // The empty title is required: `start` reads a bare first token as the
    // program to run. `/k` keeps the console open for the interactive login.
    expect(spawn).toHaveBeenCalledWith("cmd.exe", [
      "/c",
      "start",
      "",
      "cmd.exe",
      "/k",
      "claude",
      "login",
    ]);
  });

  it("drives Terminal.app on macOS", () => {
    const { io: mac, spawn } = io("darwin");

    expect(launchCliLogin("cursor", mac).terminal).toBe("Terminal.app");
    const args = spawn.mock.calls[0]?.[1] as string[];
    expect(spawn.mock.calls[0]?.[0]).toBe("osascript");
    expect(args[1]).toContain("cursor-agent login");
  });

  it("uses the generic terminal entry point on Linux", () => {
    const { io: linux, spawn } = io("linux");

    expect(launchCliLogin("commandcode", linux).terminal).toBe("x-terminal-emulator");
    expect(spawn).toHaveBeenCalledWith("x-terminal-emulator", [
      "-e",
      "command-code",
      "login",
    ]);
  });

  it("reports platforms without a known terminal instead of spawning", () => {
    const { io: other, spawn } = io("aix");

    expect(() => launchCliLogin("claude", other)).toThrow(CliLoginUnsupportedError);
    expect(spawn).not.toHaveBeenCalled();
  });
});
