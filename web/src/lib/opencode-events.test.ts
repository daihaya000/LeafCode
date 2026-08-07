import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  HANDLED_EVENT_TYPES,
  HANDLED_V1_EVENT_TYPES,
  HANDLED_V2_EVENT_TYPES,
  RESOLVED_REQUEST_EVENT_TYPES,
  SESSION_NEXT_EVENT_PREFIX,
  eventGeneration,
  isResolvedRequestEventType,
  isSessionNextEvent,
} from "./opencode-events";

const SCHEMA_PATH = join(process.cwd(), "src/lib/opencode-schema.d.ts");
const STREAM_PATH = join(process.cwd(), "src/lib/useSessionStream.ts");

function read(path: string): string {
  return readFileSync(path, "utf8");
}

/** Every `type: "..."` string literal the generated schema declares. */
function schemaEventTypes(): Set<string> {
  const out = new Set<string>();
  for (const m of read(SCHEMA_PATH).matchAll(/\btype:\s*"([^"]+)"/g)) {
    out.add(m[1]);
  }
  return out;
}

describe("opencode-events drift detection", () => {
  /**
   * The point of the whole module: after `npm run gen:types` pulls a newer
   * engine spec, an event we still branch on that no longer exists upstream
   * must fail here instead of silently never firing at runtime.
   */
  it("every handled event type still exists in the generated schema", () => {
    const declared = schemaEventTypes();
    const missing = HANDLED_EVENT_TYPES.filter((t) => !declared.has(t));
    expect(missing).toEqual([]);
  });

  it("finds a non-trivial number of event literals in the schema", () => {
    // Guards the regex itself: if the generator changes its output shape the
    // test above would pass vacuously by finding nothing to compare against.
    expect(schemaEventTypes().size).toBeGreaterThan(50);
  });

  /**
   * The registry is only useful if it matches what the reducer actually
   * branches on. This scans the stream module for the literals it compares
   * against and requires each one to be declared here.
   */
  it("covers every event literal useSessionStream branches on", () => {
    const source = read(STREAM_PATH);
    const compared = new Set<string>();
    for (const m of source.matchAll(/\btype\s*===\s*"([a-z][a-z0-9.]*)"/g)) {
      compared.add(m[1]);
    }
    // `session.status` payloads carry their own `status.type` ("busy"/"idle"/
    // "retry"), and parts carry `part.type`; neither is an SSE event name.
    const notEventNames = new Set([
      "busy",
      "idle",
      "retry",
      "text",
      "reasoning",
      "tool",
    ]);
    const unregistered = [...compared]
      .filter((t) => !notEventNames.has(t))
      .filter((t) => !(HANDLED_EVENT_TYPES as readonly string[]).includes(t));
    expect(unregistered).toEqual([]);
  });

  it("keeps the session.next prefix in sync with the handled v2 events", () => {
    const streamed = HANDLED_V2_EVENT_TYPES.filter(isSessionNextEvent);
    expect(streamed.length).toBeGreaterThan(0);
    for (const t of streamed) {
      expect(t.startsWith(SESSION_NEXT_EVENT_PREFIX)).toBe(true);
    }
    expect(read(STREAM_PATH)).toContain(`"${SESSION_NEXT_EVENT_PREFIX}"`);
  });
});

describe("opencode-events classification", () => {
  it("assigns each handled event to exactly one generation", () => {
    for (const t of HANDLED_V1_EVENT_TYPES) expect(eventGeneration(t)).toBe("v1");
    for (const t of HANDLED_V2_EVENT_TYPES) expect(eventGeneration(t)).toBe("v2");
    expect(eventGeneration("some.unknown.event")).toBeNull();
    const overlap = HANDLED_V1_EVENT_TYPES.filter((t) =>
      (HANDLED_V2_EVENT_TYPES as readonly string[]).includes(t),
    );
    expect(overlap).toEqual([]);
  });

  it("recognises resolution events from both generations", () => {
    for (const t of RESOLVED_REQUEST_EVENT_TYPES) {
      expect(isResolvedRequestEventType(t)).toBe(true);
    }
    expect(isResolvedRequestEventType("permission.asked")).toBe(false);
    expect(isResolvedRequestEventType("question.v2.asked")).toBe(false);
    // Both generations must be represented, otherwise a card raised by one API
    // could never be cleared by the other.
    expect(
      RESOLVED_REQUEST_EVENT_TYPES.some((t) => eventGeneration(t) === "v1"),
    ).toBe(true);
    expect(
      RESOLVED_REQUEST_EVENT_TYPES.some((t) => eventGeneration(t) === "v2"),
    ).toBe(true);
  });

  it("treats only session.next.* as streaming events", () => {
    expect(isSessionNextEvent("session.next.text.delta")).toBe(true);
    expect(isSessionNextEvent("session.status")).toBe(false);
    expect(isSessionNextEvent("")).toBe(false);
  });
});
