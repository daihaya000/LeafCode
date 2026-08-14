import { spawn } from "node:child_process";

/**
 * Launching a terminal that runs a CLI's interactive login.
 *
 * The browser never supplies an executable or arguments: it only names one of
 * the three CLI Proxy providers, and the command comes from the fixed table
 * below. Everything after the terminal appears (device code, browser consent,
 * pasting a key) stays with the user in that terminal.
 */
export type CliLoginProvider = "cursor" | "claude" | "commandcode";

const LOGIN_COMMANDS = {
  cursor: ["cursor-agent", "login"],
  claude: ["claude", "login"],
  commandcode: ["command-code", "login"],
} as const satisfies Record<CliLoginProvider, readonly string[]>;

export function isCliLoginProvider(value: unknown): value is CliLoginProvider {
  // `in` would also accept prototype keys such as "toString", which would then
  // resolve to a function instead of a command.
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(LOGIN_COMMANDS, value)
  );
}

/** The command as the user would type it — also shown in the UI. */
export function cliLoginCommand(provider: CliLoginProvider): string {
  return LOGIN_COMMANDS[provider].join(" ");
}

/** Injectable I/O so unit tests never spawn real terminals. */
export type CliLoginIo = {
  platform: NodeJS.Platform;
  spawn(command: string, args: string[]): void;
};

export const defaultCliLoginIo: CliLoginIo = {
  platform: process.platform,
  spawn: (command, args) => {
    const child = spawn(command, args, {
      detached: true,
      stdio: "ignore",
      // The whole point is a visible, interactive window.
      windowsHide: false,
    });
    // The terminal outlives this request; a failed launch must not crash the
    // route, the UI always shows the command for manual entry.
    child.on("error", () => undefined);
    child.unref();
  },
};

export type CliLoginResult = { command: string; terminal: string };

export class CliLoginUnsupportedError extends Error {
  constructor(platform: string) {
    super(`terminal launch is not supported on ${platform}`);
    this.name = "CliLoginUnsupportedError";
  }
}

/**
 * Open a terminal window that has already run the provider's login command.
 *
 * Windows: `cmd.exe /c start "" cmd.exe /k <program> <args>`. The empty title
 * argument is required — `start` treats a bare first token as the program to
 * run, not as a title — and `/k` keeps the console open for the interactive
 * part of the login.
 */
export function launchCliLogin(
  provider: CliLoginProvider,
  io: CliLoginIo = defaultCliLoginIo,
): CliLoginResult {
  const [program, ...args] = LOGIN_COMMANDS[provider];
  const command = cliLoginCommand(provider);

  if (io.platform === "win32") {
    io.spawn("cmd.exe", ["/c", "start", "", "cmd.exe", "/k", program, ...args]);
    return { command, terminal: "cmd.exe" };
  }
  if (io.platform === "darwin") {
    io.spawn("osascript", [
      "-e",
      `tell application "Terminal" to do script "${command}"`,
      "-e",
      'tell application "Terminal" to activate',
    ]);
    return { command, terminal: "Terminal.app" };
  }
  if (io.platform === "linux") {
    io.spawn("x-terminal-emulator", ["-e", program, ...args]);
    return { command, terminal: "x-terminal-emulator" };
  }
  throw new CliLoginUnsupportedError(io.platform);
}
