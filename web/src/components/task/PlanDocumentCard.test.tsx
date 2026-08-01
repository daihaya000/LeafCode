import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlanDocumentCard } from "./PlanDocumentCard";

const { getJson } = vi.hoisted(() => ({ getJson: vi.fn() }));

vi.mock("@/lib/client", () => ({ getJson }));
vi.mock("./Markdown", () => ({
  Markdown: ({ text }: { text: string }) => <div data-testid="plan-markdown">{text}</div>,
}));

describe("PlanDocumentCard", () => {
  beforeEach(() => {
    getJson.mockResolvedValue({ name: "plan.md", content: "計画本文" });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  function renderCard(
    props: Partial<React.ComponentProps<typeof PlanDocumentCard>> = {},
  ) {
    const onApprove = vi.fn().mockResolvedValue(undefined);
    render(
      <PlanDocumentCard
        path="/repo/plan.md"
        directory="/repo"
        actionable
        working={false}
        onApprove={onApprove}
        {...props}
      />,
    );
    return { onApprove };
  }

  it("starts collapsed when requested and expands from the header", async () => {
    renderCard({ initialCollapsed: true });
    const toggle = screen.getByRole("button", { name: /plan\.md/ });

    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByTestId("plan-markdown")).toBeNull();
    expect(screen.queryByRole("button", { name: "承認して実装" })).toBeNull();

    fireEvent.click(toggle);

    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect((await screen.findByTestId("plan-markdown")).textContent).toBe("計画本文");
    expect(screen.getByRole("button", { name: "承認して実装" })).toBeTruthy();

    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByTestId("plan-markdown")).toBeNull();
  });

  it("stays expanded by default and preserves approval behavior", async () => {
    const { onApprove } = renderCard();

    const toggle = screen.getByRole("button", { name: /plan\.md/ });
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(await screen.findByTestId("plan-markdown")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "承認して実装" }));
    await act(async () => {
      await Promise.resolve();
    });

    expect(onApprove).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole("button", { name: "実装を開始しました" }).hasAttribute("disabled"),
    ).toBe(true);
  });

  it("does not apply an approval result after the document changes", async () => {
    let resolveApproval!: () => void;
    const approval = new Promise<void>((resolve) => {
      resolveApproval = resolve;
    });
    const onApprove = vi.fn(() => approval);
    const view = render(
      <PlanDocumentCard
        path="/repo/plan.md"
        directory="/repo"
        actionable
        working={false}
        onApprove={onApprove}
      />,
    );

    await screen.findByTestId("plan-markdown");
    fireEvent.click(screen.getAllByRole("button").at(-1)!);

    view.rerender(
      <PlanDocumentCard
        path="/repo/other-plan.md"
        directory="/repo"
        actionable
        working={false}
        onApprove={onApprove}
      />,
    );
    resolveApproval();
    await act(async () => {
      await approval;
    });

    expect(screen.getAllByRole("button").at(-1)?.hasAttribute("disabled")).toBe(false);
  });
});
