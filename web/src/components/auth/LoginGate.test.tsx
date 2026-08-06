import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { LoginGate, LoginForm } from "./LoginGate";

const { login, logout } = vi.hoisted(() => ({
  login: vi.fn(),
  logout: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  currentUser: vi.fn(),
  isLoggedIn: vi.fn(),
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
  it("renders children when already logged in", async () => {
    (auth.currentUser as unknown as ReturnType<typeof vi.fn>).mockReturnValue("alice");
    render(
      <LoginGate>
        <div>protected content</div>
      </LoginGate>,
    );
    await waitFor(() => expect(screen.getByText("protected content")).toBeTruthy());
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

    fireEvent.change(screen.getByLabelText("ユーザー名"), { target: { value: "alice" } });
    fireEvent.change(screen.getByLabelText("パスワード"), { target: { value: "secret" } });
    fireEvent.click(screen.getByRole("button", { name: "ログイン" }));

    await waitFor(() => expect(screen.getByText("protected content")).toBeTruthy());
  });
});
