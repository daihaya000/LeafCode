import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentSuggestMenu } from "./AgentSuggestMenu";

afterEach(cleanup);

describe("AgentSuggestMenu", () => {
  it("renders agents with blue names and hover titles", () => {
    render(
      <AgentSuggestMenu
        items={[
          {
            name: "build",
            label: "build",
            description: "Default primary agent",
          },
        ]}
        activeIndex={0}
        onHover={vi.fn()}
        onSelect={vi.fn()}
      />,
    );

    const name = screen.getByText("build");
    expect(name.className).toContain("text-accent");
    expect(screen.getByRole("option").getAttribute("title")).toBe(
      "Default primary agent",
    );
  });

  it("renders nothing when the list is empty", () => {
    const { container } = render(
      <AgentSuggestMenu
        items={[]}
        activeIndex={0}
        onHover={vi.fn()}
        onSelect={vi.fn()}
      />,
    );
    expect(container.firstChild).toBeNull();
  });
});