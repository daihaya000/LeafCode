import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AccessModeSelect } from "@/components/AccessModeSelect";
import { SkillPermissionSelect } from "@/components/SkillPermissionSelect";
import { SubagentPermissionSelect } from "@/components/SubagentPermissionSelect";
import { PermissionGhostSelect } from "@/components/PermissionGhostSelect";

afterEach(() => {
  cleanup();
});

function openSelect(ariaLabel: string) {
  fireEvent.click(screen.getByRole("button", { name: ariaLabel }));
}

describe("PermissionGhostSelect", () => {
  it("renders the current option label with the aria label", () => {
    render(
      <PermissionGhostSelect
        value="b"
        onChange={() => {}}
        options={[
          { value: "a", label: "Alpha", title: "A description" },
          { value: "b", label: "Beta", title: "B description" },
        ]}
        ariaLabel="テスト選択"
        icon={<span>icon</span>}
      />,
    );
    const trigger = screen.getByRole("button", { name: "テスト選択" });
    expect(trigger).toBeTruthy();
    expect(within(trigger).getByText("Beta")).toBeTruthy();
  });

  it("fires onChange with the typed option value", () => {
    const onChange = vi.fn();
    render(
      <PermissionGhostSelect
        value="a"
        onChange={onChange}
        options={[
          { value: "a", label: "Alpha" },
          { value: "b", label: "Beta" },
        ]}
        ariaLabel="テスト選択"
        icon={<span>icon</span>}
      />,
    );
    openSelect("テスト選択");
    fireEvent.click(screen.getByText("Beta"));
    expect(onChange).toHaveBeenCalledWith("b");
  });
});

describe("AccessModeSelect", () => {
  it("renders with the current mode label", () => {
    render(<AccessModeSelect value="ask" onChange={() => {}} />);
    expect(
      screen.getByRole("button", { name: "アクセスモード" }),
    ).toBeTruthy();
  });

  it("fires onChange with the selected mode", () => {
    const onChange = vi.fn();
    render(<AccessModeSelect value="ask" onChange={onChange} />);
    openSelect("アクセスモード");
    fireEvent.click(screen.getByText("フルアクセス"));
    expect(onChange).toHaveBeenCalledWith("full");
  });
});

describe("SkillPermissionSelect", () => {
  it("renders with the current skill permission label", () => {
    render(<SkillPermissionSelect value="allow" onChange={() => {}} />);
    expect(
      screen.getByRole("button", { name: /スキル/ }),
    ).toBeTruthy();
  });
});

describe("SubagentPermissionSelect", () => {
  it("renders with the current subagent permission label", () => {
    render(<SubagentPermissionSelect value="allow" onChange={() => {}} />);
    expect(
      screen.getByRole("button", { name: /サブエージェント/ }),
    ).toBeTruthy();
  });
});
