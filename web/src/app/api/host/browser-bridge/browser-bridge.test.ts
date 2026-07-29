import { beforeEach, describe, expect, it, vi } from "vitest";

const { browserBrokerFetch } = vi.hoisted(() => ({
  browserBrokerFetch: vi.fn(),
}));
vi.mock("@/lib/browser-bridge", () => ({ browserBrokerFetch }));

import { GET as listApprovals } from "./approvals/route";
import { POST as decideApproval } from "./approvals/[id]/route";
import { POST as createPairing } from "./pairing/route";

const local = (url: string, init?: RequestInit) =>
  new Request(url, {
    ...init,
    headers: { host: "127.0.0.1:3000", ...init?.headers },
  });
const remote = (url: string, init?: RequestInit) =>
  new Request(url, {
    ...init,
    headers: { host: "192.168.1.5:3000", ...init?.headers },
  });
const approvalId = "approval_abcdefghijklmnopqrstuvwxyz";

describe("Browser Bridge host-only routes", () => {
  beforeEach(() => browserBrokerFetch.mockReset());

  it("rejects remote approval and pairing requests before contacting the Broker", async () => {
    expect(
      (
        await listApprovals(
          remote("http://example.test/api/host/browser-bridge/approvals"),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await createPairing(
          remote("http://example.test/api/host/browser-bridge/pairing", {
            method: "POST",
          }),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await decideApproval(
          remote(
            `http://example.test/api/host/browser-bridge/approvals/${approvalId}`,
            { method: "POST", body: JSON.stringify({ decision: "allow" }) },
          ),
          { params: Promise.resolve({ id: approvalId }) },
        )
      ).status,
    ).toBe(403);
    expect(browserBrokerFetch).not.toHaveBeenCalled();
  });

  it("forwards a valid local decision without exposing the Broker token", async () => {
    browserBrokerFetch.mockResolvedValue(
      new Response(JSON.stringify({ approvalId, decision: "allow" }), {
        status: 200,
      }),
    );
    const res = await decideApproval(
      local(
        `http://127.0.0.1:3000/api/host/browser-bridge/approvals/${approvalId}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ decision: "allow" }),
        },
      ),
      { params: Promise.resolve({ id: approvalId }) },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ approvalId, decision: "allow" });
    expect(browserBrokerFetch).toHaveBeenCalledWith(
      `/internal/approvals/${approvalId}`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ decision: "allow" }),
      }),
    );
  });

  it("generalizes unavailable and malformed Broker approval-list responses", async () => {
    browserBrokerFetch.mockResolvedValueOnce(new Response("unavailable", { status: 503 }));
    const unavailable = await listApprovals(
      local("http://127.0.0.1:3000/api/host/browser-bridge/approvals"),
    );
    expect(unavailable.status).toBe(502);
    expect(await unavailable.json()).toEqual({ error: "browser broker unavailable" });

    browserBrokerFetch.mockResolvedValueOnce(new Response("not json", { status: 200 }));
    const malformed = await listApprovals(
      local("http://127.0.0.1:3000/api/host/browser-bridge/approvals"),
    );
    expect(malformed.status).toBe(502);
    expect(await malformed.json()).toEqual({ error: "browser broker unavailable" });
  });
});
