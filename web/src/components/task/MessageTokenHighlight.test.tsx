import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MessageTokenHighlight } from "./MessageTokenHighlight";

afterEach(cleanup);

describe("MessageTokenHighlight", () => {
  it("renders known skill tokens in accent blue with hover title", () => {
    const skills = new Map([
      ["powershell-japanese-encoding".toLowerCase(), "PowerShell Japanese encoding skill"],
    ]);
    render(
      <MessageTokenHighlight
        text="修正してください /powershell-japanese-encoding"
        skills={skills}
      />,
    );

    const token = screen.getByText("/powershell-japanese-encoding");
    expect(token.className).toContain("text-accent");
    expect(token.getAttribute("title")).toBe("PowerShell Japanese encoding skill");
  });

  it("renders known agent tokens in accent blue with hover title", () => {
    const agents = new Map([
      ["build".toLowerCase(), "Default primary agent"],
    ]);
    render(
      <MessageTokenHighlight
        text="please @build review"
        agents={agents}
      />,
    );

    const token = screen.getByText("@build");
    expect(token.className).toContain("text-accent");
    expect(token.getAttribute("title")).toBe("Default primary agent");
  });

  it("leaves unknown slash and at tokens as plain text", () => {
    render(<MessageTokenHighlight text="/unknown @nobody" />);
    const container = screen.getByText("/unknown @nobody");
    expect(container.querySelectorAll(".text-accent").length).toBe(0);
  });

  it("preserves surrounding text unchanged", () => {
    const skills = new Map([["bug-hunt".toLowerCase(), "Hunt bugs"]]);
    const { container } = render(
      <MessageTokenHighlight text="before /bug-hunt after" skills={skills} />,
    );
    expect(container.textContent).toBe("before /bug-hunt after");
    expect(screen.getByText("/bug-hunt").className).toContain("text-accent");
  });

  it("renders plain text verbatim when no tokens are present", () => {
    render(<MessageTokenHighlight text="普通のメッセージ" />);
    expect(screen.getByText("普通のメッセージ")).toBeTruthy();
  });
});