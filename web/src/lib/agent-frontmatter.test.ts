import { describe, expect, it } from "vitest";
import {
  isAgentDisabled,
  isAgentEnabled,
  parseAgentFrontmatter,
  setAgentDisabled,
} from "./agent-frontmatter";

describe("isAgentDisabled", () => {
  it("treats a missing frontmatter or key as enabled", () => {
    expect(isAgentDisabled("# no frontmatter")).toBe(false);
    expect(isAgentDisabled("---\ndescription: x\n---\n")).toBe(false);
    expect(isAgentEnabled("---\ndescription: x\n---\n")).toBe(true);
  });

  it("accepts the YAML truthy spellings", () => {
    for (const value of ["true", "True", "yes", "on", "1", '"true"']) {
      expect(isAgentDisabled(`---\ndisable: ${value}\n---\n`)).toBe(true);
    }
    expect(isAgentDisabled("---\ndisable: false\n---\n")).toBe(false);
  });

  it("ignores a nested disable key", () => {
    // `permission.disable` is not the agent-level flag.
    expect(
      isAgentDisabled("---\npermission:\n  disable: true\n---\n"),
    ).toBe(false);
  });

  it("ignores a `---` rule in the body", () => {
    expect(
      isAgentDisabled("---\ndisable: true\n---\n\nbody\n\n---\n\nmore\n"),
    ).toBe(true);
  });
});

describe("setAgentDisabled", () => {
  it("adds the key to existing frontmatter", () => {
    expect(setAgentDisabled("---\ndescription: x\n---\nbody\n", true)).toBe(
      "---\ndescription: x\ndisable: true\n---\nbody\n",
    );
  });

  it("removes the key instead of writing `false`", () => {
    expect(
      setAgentDisabled("---\ndescription: x\ndisable: true\n---\nbody\n", false),
    ).toBe("---\ndescription: x\n---\nbody\n");
  });

  it("round-trips a definition that was never disabled", () => {
    const original = "---\ndescription: x\n---\nbody\n";
    expect(setAgentDisabled(setAgentDisabled(original, true), false)).toBe(
      original,
    );
  });

  it("preserves CRLF line endings", () => {
    expect(setAgentDisabled("---\r\ndescription: x\r\n---\r\nbody", true)).toBe(
      "---\r\ndescription: x\r\ndisable: true\r\n---\r\nbody",
    );
  });

  it("creates frontmatter when the file has none", () => {
    expect(setAgentDisabled("body\n", true)).toBe(
      "---\ndisable: true\n---\n\nbody\n",
    );
    expect(setAgentDisabled("body\n", false)).toBe("body\n");
  });

  it("rewrites an existing false into true", () => {
    expect(setAgentDisabled("---\ndisable: false\n---\n", true)).toBe(
      "---\ndisable: true\n---\n",
    );
  });
});

describe("parseAgentFrontmatter", () => {
  it("reads description, mode, model, and disable", () => {
    expect(
      parseAgentFrontmatter(
        '---\ndescription: "Reviews code"\nmode: subagent\nmodel: openai/gpt-5\ndisable: true\n---\nbody\n',
      ),
    ).toEqual({
      description: "Reviews code",
      mode: "subagent",
      model: { providerID: "openai", modelID: "gpt-5" },
      disabled: true,
    });
  });

  it("keeps slashes inside the model id", () => {
    expect(
      parseAgentFrontmatter("---\nmodel: openrouter/anthropic/claude\n---\n")
        .model,
    ).toEqual({ providerID: "openrouter", modelID: "anthropic/claude" });
  });

  it("ignores unknown mode values and missing frontmatter", () => {
    expect(parseAgentFrontmatter("---\nmode: weird\n---\n").mode).toBeUndefined();
    expect(parseAgentFrontmatter("plain")).toEqual({ disabled: false });
  });
});
