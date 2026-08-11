import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  ShellProvider,
  useShellActiveScope,
  useShellExtras,
  useShellSetActiveScope,
} from "./ShellContext";

function Harness() {
  const { extras, setExtras } = useShellExtras();
  const activeScope = useShellActiveScope();
  const setActiveScope = useShellSetActiveScope();
  return (
    <>
      <output aria-label="directory">{extras.directory ?? "none"}</output>
      <output aria-label="session">{activeScope?.sessionId ?? "none"}</output>
      <button
        type="button"
        onClick={() => {
          setExtras({ directory: "/a" }, "a");
          setActiveScope({ directory: "/a", sessionId: "session-a" }, "a");
        }}
      >
        claim a
      </button>
      <button
        type="button"
        onClick={() => {
          setExtras({ directory: "/b" }, "b");
          setActiveScope({ directory: "/b", sessionId: "session-b" }, "b");
        }}
      >
        claim b
      </button>
      <button
        type="button"
        onClick={() => {
          setExtras({}, "a");
          setActiveScope(null, "a");
        }}
      >
        clear a
      </button>
      <button
        type="button"
        onClick={() => {
          setExtras({}, "b");
          setActiveScope(null, "b");
        }}
      >
        clear b
      </button>
    </>
  );
}

describe("ShellContext ownership", () => {
  it("does not let an inactive task clear the active task state", () => {
    render(
      <ShellProvider>
        <Harness />
      </ShellProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "claim a" }));
    fireEvent.click(screen.getByRole("button", { name: "claim b" }));
    fireEvent.click(screen.getByRole("button", { name: "clear a" }));

    expect(screen.getByLabelText("directory").textContent).toBe("/b");
    expect(screen.getByLabelText("session").textContent).toBe("session-b");

    fireEvent.click(screen.getByRole("button", { name: "clear b" }));
    expect(screen.getByLabelText("directory").textContent).toBe("none");
    expect(screen.getByLabelText("session").textContent).toBe("none");
  });
});
