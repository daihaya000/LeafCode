import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import {
  MobileScrollTargetProvider,
  useMobileScrollTarget,
} from "./MobileScrollTargetContext";
import { MobileMenuHeader } from "./MobileMenuHeader";
import { ShellProvider } from "./ShellContext";

function TestPage() {
  const setTarget = useMobileScrollTarget();
  return (
    <div>
      <MobileMenuHeader />
      <div
        ref={setTarget}
        data-testid="scroller"
        style={{ height: 200, overflow: "auto" }}
      >
        <div style={{ height: 800 }} />
      </div>
    </div>
  );
}

describe("MobileScrollTargetContext", () => {
  it("exposes a double-tap target that scrolls the registered scroller to top", async () => {
    render(
      <ShellProvider>
        <MobileScrollTargetProvider>
          <TestPage />
        </MobileScrollTargetProvider>
      </ShellProvider>,
    );
    const scroller = screen.getByTestId("scroller");
    await waitFor(() => expect(scroller).toBeTruthy());
    scroller.scrollTop = 300;
    expect(scroller.scrollTop).toBe(300);
    const button = screen.getByLabelText("ダブルタップで最上段へスクロール");
    fireEvent.doubleClick(button);
    await waitFor(() => expect(scroller.scrollTop).toBe(0));
  });
});
