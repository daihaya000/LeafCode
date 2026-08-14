import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ launchCliLogin: vi.fn() }));

vi.mock("@/lib/cli-login", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/cli-login")>();
  return { ...actual, launchCliLogin: h.launchCliLogin };
});

import { CliLoginUnsupportedError } from "@/lib/cli-login";
import { POST } from "./route";

/** Loopback request so the shared API guard and the host-only guard pass. */
function localReq(body: unknown) {
  return new Request("http://127.0.0.1:3000/api/provider/cli-login", {
    method: "POST",
    headers: { host: "127.0.0.1:3000", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function lanReq(body: unknown) {
  return new Request("http://192.168.1.50:3000/api/provider/cli-login", {
    method: "POST",
    headers: { host: "192.168.1.50:3000", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  h.launchCliLogin.mockReset();
  h.launchCliLogin.mockReturnValue({ command: "claude login", terminal: "cmd.exe" });
});

describe("POST /api/provider/cli-login", () => {
  it("launches the login terminal for a known provider", async () => {
    const response = await POST(localReq({ provider: "claude" }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      command: "claude login",
      terminal: "cmd.exe",
    });
    expect(h.launchCliLogin).toHaveBeenCalledWith("claude");
  });

  it("rejects providers outside the fixed table", async () => {
    const response = await POST(localReq({ provider: "openai" }));

    expect(response.status).toBe(400);
    expect(h.launchCliLogin).not.toHaveBeenCalled();
  });

  it("never accepts a caller-supplied command", async () => {
    const response = await POST(
      localReq({ provider: "claude; rm -rf /", command: "curl evil" }),
    );

    expect(response.status).toBe(400);
    expect(h.launchCliLogin).not.toHaveBeenCalled();
  });

  it("does not open windows on the host for remote callers", async () => {
    const response = await POST(lanReq({ provider: "claude" }));

    expect(response.ok).toBe(false);
    expect(h.launchCliLogin).not.toHaveBeenCalled();
  });

  it("reports unsupported platforms", async () => {
    h.launchCliLogin.mockImplementation(() => {
      throw new CliLoginUnsupportedError("aix");
    });

    const response = await POST(localReq({ provider: "cursor" }));

    expect(response.status).toBe(501);
  });
});
