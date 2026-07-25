import { describe, expect, it } from "vitest";
import {
  directoryHeaders,
  isHeaderSafeValue,
  withDirectoryQuery,
} from "./directory-header";

describe("isHeaderSafeValue", () => {
  it("accepts ASCII strings", () => {
    expect(isHeaderSafeValue("C:\\repo")).toBe(true);
    expect(isHeaderSafeValue("/home/user/project")).toBe(true);
    expect(isHeaderSafeValue("")).toBe(true);
  });

  it("accepts Latin-1 non-ASCII characters (e.g. é)", () => {
    expect(isHeaderSafeValue("C:\\répo")).toBe(true);
    expect(isHeaderSafeValue("café")).toBe(true);
  });

  it("rejects Japanese / non-Latin-1 characters", () => {
    expect(isHeaderSafeValue("C:\\Users\\会議\\project")).toBe(false);
    expect(isHeaderSafeValue("プロジェクト")).toBe(false);
  });

  it("rejects CR / LF / NUL", () => {
    expect(isHeaderSafeValue("a\rb")).toBe(false);
    expect(isHeaderSafeValue("a\nb")).toBe(false);
    expect(isHeaderSafeValue("a\0b")).toBe(false);
  });
});

describe("directoryHeaders", () => {
  it("attaches the header for an ASCII path", () => {
    expect(directoryHeaders("C:\\repo")).toEqual({
      "x-opencode-directory": "C:\\repo",
    });
  });

  it("attaches the header for a Latin-1 non-ASCII path (é)", () => {
    expect(directoryHeaders("C:\\répo")).toEqual({
      "x-opencode-directory": "C:\\répo",
    });
  });

  it("returns {} for a Japanese path without throwing", () => {
    expect(() => directoryHeaders("C:\\Users\\会議\\project")).not.toThrow();
    expect(directoryHeaders("C:\\Users\\会議\\project")).toEqual({});
  });

  it("returns {} for CR / LF / NUL values", () => {
    expect(directoryHeaders("a\rb")).toEqual({});
    expect(directoryHeaders("a\nb")).toEqual({});
    expect(directoryHeaders("a\0b")).toEqual({});
  });

  it("returns {} for null / undefined / empty string", () => {
    expect(directoryHeaders(null)).toEqual({});
    expect(directoryHeaders(undefined)).toEqual({});
    expect(directoryHeaders("")).toEqual({});
  });
});

describe("withDirectoryQuery", () => {
  it("sets the directory query for an ASCII path", () => {
    const url = new URL("http://localhost/api/opencode/session");
    withDirectoryQuery(url, "C:\\repo");
    expect(url.searchParams.get("directory")).toBe("C:\\repo");
  });

  it("percent-encodes a Japanese path and does not throw", () => {
    const url = new URL("http://localhost/api/opencode/session");
    expect(() => withDirectoryQuery(url, "C:\\Users\\会議\\project")).not.toThrow();
    expect(url.searchParams.get("directory")).toBe("C:\\Users\\会議\\project");
    // The serialized form must be percent-encoded (no raw multibyte).
    expect(url.search).not.toContain("会議");
  });

  it("does not set the query for null / undefined / empty", () => {
    const url = new URL("http://localhost/api/opencode/session");
    withDirectoryQuery(url, null);
    withDirectoryQuery(url, undefined);
    withDirectoryQuery(url, "");
    expect(url.searchParams.has("directory")).toBe(false);
  });

  it("returns the same URL instance", () => {
    const url = new URL("http://localhost/api/opencode/session");
    expect(withDirectoryQuery(url, "C:\\repo")).toBe(url);
  });
});