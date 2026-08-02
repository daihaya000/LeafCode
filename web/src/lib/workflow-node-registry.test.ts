import Ajv from "ajv";
import { describe, expect, test } from "vitest";
import {
  WORKFLOW_NODE_DEFINITIONS,
  WORKFLOW_NODE_REGISTRY,
  WORKFLOW_NODE_REGISTRY_VERSION,
  WorkflowNodeRegistry,
  getDefaultWorkflowNodeConfig,
} from "./workflow-node-registry";

function cloneFirstDefinition() {
  return structuredClone(WORKFLOW_NODE_DEFINITIONS[0]);
}

describe("WorkflowNodeRegistry v1", () => {
  test("registers the initial four immutable type versions", () => {
    expect(WORKFLOW_NODE_REGISTRY.version).toBe(WORKFLOW_NODE_REGISTRY_VERSION);
    expect(
      WORKFLOW_NODE_REGISTRY.definitions.map(({ type, version }) => `${type}@${version}`),
    ).toEqual([
      "opencode.implement_ui@1",
      "opencode.code_review@1",
      "opencode.visual_judge@1",
      "control.review_gate@1",
    ]);
    expect(WORKFLOW_NODE_REGISTRY.get("control.review_gate", 1)?.userAddable).toBe(false);
  });

  test("references existing default configs without sharing mutable objects", () => {
    const definition = WORKFLOW_NODE_REGISTRY.get("opencode.implement_ui", 1)!;
    const first = getDefaultWorkflowNodeConfig(definition)!;
    const second = getDefaultWorkflowNodeConfig(definition)!;

    expect(first.agentName).toBe("build");
    first.permissions.write = false;
    expect(second.permissions.write).toBe(true);
    expect(getDefaultWorkflowNodeConfig(WORKFLOW_NODE_REGISTRY.get("control.review_gate", 1)!)).toBeUndefined();
  });

  test("uses Ajv-compatible config and result schemas", () => {
    const ajv = new Ajv({ strict: true });
    for (const definition of WORKFLOW_NODE_REGISTRY.definitions) {
      expect(() => ajv.compile(definition.configSchema)).not.toThrow();
      expect(() => ajv.compile(definition.resultSchema)).not.toThrow();
    }
  });

  test("rejects duplicate type versions", () => {
    const definition = cloneFirstDefinition();
    expect(
      () =>
        new WorkflowNodeRegistry("test", [definition, structuredClone(definition)]),
    ).toThrow(/duplicate node definition/);
  });

  test("rejects invalid type versions", () => {
    expect(
      () =>
        new WorkflowNodeRegistry("test", [
          { ...cloneFirstDefinition(), version: 0 },
        ]),
    ).toThrow(/positive integer version/);
  });

  test("rejects executor and renderer keys outside server allowlists", () => {
    expect(
      () =>
        new WorkflowNodeRegistry("test", [
          { ...cloneFirstDefinition(), executorKey: "dynamic.module.path" },
        ]),
    ).toThrow(/unknown executor key/);
    expect(
      () =>
        new WorkflowNodeRegistry("test", [
          { ...cloneFirstDefinition(), rendererKey: "dynamic-component" },
        ]),
    ).toThrow(/unknown renderer key/);
  });

  test("rejects result parser keys outside the static allowlist", () => {
    expect(
      () =>
        new WorkflowNodeRegistry("test", [
          {
            ...cloneFirstDefinition(),
            resultParserKey: "dynamic-parser" as "implement-result-v1",
          },
        ]),
    ).toThrow(/unknown result parser key/);
  });

  test("rejects duplicate port IDs", () => {
    const definition = cloneFirstDefinition();
    expect(
      () =>
        new WorkflowNodeRegistry("test", [
          { ...definition, outputs: [definition.outputs[0], definition.outputs[0]] },
        ]),
    ).toThrow(/duplicate outputs port/);
  });
});
