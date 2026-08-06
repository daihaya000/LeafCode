import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { LoginGate, LoginForm } from "./LoginGate";

const { login, logout, fetchAuthRequirement } = vi.hoisted(() => ({
  login: vi.fn(),
  logout: vi.fn(),
  fetchAuthRequirement: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  currentUser: vi.fn(),
  isLoggedIn: vi.fn(),
  fetchAuthRequirement,
  login,
  logout,
  listAuthUsers: vi.fn(),
  upsertAuthUser: vi.fn(),
  deleteAuthUser: vi.fn(),
}));

import * as auth from "@/lib/auth";

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  login.mockReset();
  logout.mockReset();
  fetchAuthRequirement.mockReset();
  // Default: remote caller with users registered and no valid cookie, so the
  // gate applies. `authenticated` comes from the server-verified cookie — the
  // client cannot decide this from localStorage.
  fetchAuthRequirement.mockResolvedValue({
    local: false,
    hasUsers: true,
    loginRequired: true,
    authenticated: false,
    username: null,
  });
  (auth.currentUser as unknown as ReturnType<typeof vi.fn>).mockReturnValue(null);
  (auth.isLoggedIn as unknown as ReturnType<typeof vi.fn>).mockReturnValue(false);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("LoginForm", () => {
  it("submits username and password", async () => {
    login.mockResolvedValue({ ok: true });
    const onLogin = vi.fn();
    render(<LoginForm onLogin={onLogin} />);

    fireEvent.change(screen.getByLabelText("ユーザー名"), { target: { value: "alice" } });
    fireEvent.change(screen.getByLabelText("パスワード"), { target: { value: "secret" } });
    fireEvent.click(screen.getByRole("button", { name: "ログイン" }));

    await waitFor(() => expect(login).toHaveBeenCalledWith("alice", "secret"));
    await waitFor(() => expect(onLogin).toHaveBeenCalledWith("alice"));
  });

  it("shows an error when login fails", async () => {
    login.mockResolvedValue({ ok: false, error: "invalid credentials" });
    render(<LoginForm onLogin={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("ユーザー名"), { target: { value: "alice" } });
    fireEvent.change(screen.getByLabelText("パスワード"), { target: { value: "wrong" } });
    fireEvent.click(screen.getByRole("button", { name: "ログイン" }));

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("invalid credentials"),
    );
  });

  it("does not submit when fields are empty", async () => {
    render(<LoginForm onLogin={vi.fn()} />);
    const button = screen.getByRole("button", { name: "ログイン" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });
});

describe("LoginGate", () => {
  it("renders children when the server confirms the session cookie", async () => {
    fetchAuthRequirement.mockResolvedValue({
      local: false,
      hasUsers: true,
      loginRequired: true,
      authenticated: true,
      username: "alice",
    });
    render(
      <LoginGate>
        <div>protected content</div>
      </LoginGate>,
    );
    await waitFor(() => expect(screen.getByText("protected content")).toBeTruthy());
  });

  it("shows the gate when localStorage claims a session the server rejects", async () => {
    // A host restart regenerates the signing secret, invalidating the cookie
    // while localStorage still holds a session. The server must win.
    (auth.currentUser as unknown as ReturnType<typeof vi.fn>).mockReturnValue("alice");
    render(
      <LoginGate>
        <div>protected content</div>
      </LoginGate>,
    );
    await waitFor(() => expect(screen.getByRole("button", { name: "ログイン" })).toBeTruthy());
    expect(screen.queryByText("protected content")).toBeNull();
  });

  it("shows the login form when not logged in", async () => {
    render(
      <LoginGate>
        <div>protected content</div>
      </LoginGate>,
    );
    await waitFor(() => expect(screen.getByRole("button", { name: "ログイン" })).toBeTruthy());
    expect(screen.queryByText("protected content")).toBeNull();
  });

  it("renders children after successful login", async () => {
    login.mockResolvedValue({ ok: true });
    render(
      <LoginGate>
        <div>protected content</div>
      </LoginGate>,
    );

    // The gate resolves loginRequired asynchronously, so wait for the form.
    await waitFor(() => expect(screen.getByLabelText("ユーザー名")).toBeTruthy());
    fireEvent.change(screen.getByLabelText("ユーザー名"), { target: { value: "alice" } });
    fireEvent.change(screen.getByLabelText("パスワード"), { target: { value: "secret" } });
    fireEvent.click(screen.getByRole("button", { name: "ログイン" }));

    await waitFor(() => expect(screen.getByText("protected content")).toBeTruthy());
  });

  it("skips the gate entirely for loopback callers", async () => {
    fetchAuthRequirement.mockResolvedValue({
      local: true,
      hasUsers: true,
      loginRequired: false,
    });
    render(
      <LoginGate>
        <div>protected content</div>
      </LoginGate>,
    );

    await waitFor(() => expect(screen.getByText("protected content")).toBeTruthy());
    expect(screen.queryByRole("button", { name: "ログイン" })).toBeNull();
    // No session to end, so the logout affordance stays hidden.
    expect(screen.queryByRole("button", { name: "ログアウト" })).toBeNull();
  });

  it("skips the gate for remote callers while no users are registered", async () => {
    fetchAuthRequirement.mockResolvedValue({
      local: false,
      hasUsers: false,
      loginRequired: false,
    });
    render(
      <LoginGate>
        <div>protected content</div>
      </LoginGate>,
    );

    await waitFor(() => expect(screen.getByText("protected content")).toBeTruthy());
    expect(screen.queryByRole("button", { name: "ログイン" })).toBeNull();
  });

  it("shows the logout affordance and username from the verified session", async () => {
    fetchAuthRequirement.mockResolvedValue({
      local: false,
      hasUsers: true,
      loginRequired: true,
      authenticated: true,
      username: "alice",
    });
    render(
      <LoginGate>
        <div>protected content</div>
      </LoginGate>,
    );

    await waitFor(() => expect(screen.getByText("protected content")).toBeTruthy());
    expect(screen.getByRole("button", { name: "ログアウト" })).toBeTruthy();
    expect(screen.getByText("alice")).toBeTruthy();
  });
});
