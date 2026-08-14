import fs from "node:fs";
import path from "node:path";

/**
 * Strip `//` line and `/* *\/` block comments from JSONC while preserving any
 * `//` that appears inside a JSON string (e.g. a `https://…` URL value). The
 * naive `raw.replace(/\/\/.*$/gm, "")` used previously truncated such values
 * and produced invalid JSON.
 */
export function stripJsoncComments(input: string): string {
  let out = "";
  let inString = false;
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    const next = input[i + 1];
    if (inString) {
      out += c;
      if (c === "\\") {
        // Copy the escaped character verbatim so an escaped quote or backslash
        // does not prematurely end the string.
        if (i + 1 < input.length) {
          out += input[i + 1];
          i++;
        }
      } else if (c === '"') {
        inString = false;
      }
      continue;
    }
    if (c === '"') {
      inString = true;
      out += c;
      continue;
    }
    if (c === "/" && next === "/") {
      while (i < input.length && input[i] !== "\n") i++;
      out += "\n";
      continue;
    }
    if (c === "/" && next === "*") {
      i += 2;
      while (i < input.length && !(input[i] === "*" && input[i + 1] === "/")) i++;
      i++; // skip the closing '*' ('/' consumed by the loop's i++)
      continue;
    }
    out += c;
  }
  return out;
}

/**
 * Drop a trailing comma before `}`/`]` — common in hand-edited
 * `devcontainer.json` files and otherwise a JSON.parse failure. Runs after
 * comment stripping, so the input has no comments left to misinterpret;
 * the regex still only touches a `,` immediately followed by closing
 * whitespace + bracket, which a string's own content essentially never is.
 */
function stripTrailingCommas(input: string): string {
  return input.replace(/,(\s*[}\]])/g, "$1");
}

export type DevcontainerInfo = {
  present: boolean;
  configPath: string | null;
  name: string | null;
  mode: "host-fallback" | "unsupported";
  message: string;
  /** True when a config file exists but couldn't be read/parsed as JSONC. */
  parseError: boolean;
};

export function detectDevcontainer(projectRoot: string): DevcontainerInfo {
  const candidates = [
    path.join(projectRoot, ".devcontainer", "devcontainer.json"),
    path.join(projectRoot, ".devcontainer.json"),
  ];
  const configPath = candidates.find((p) => fs.existsSync(p)) ?? null;
  if (!configPath) {
    return {
      present: false,
      configPath: null,
      name: null,
      mode: "unsupported",
      parseError: false,
      message: "No .devcontainer config found",
    };
  }

  let name: string | null = null;
  let parseError = false;
  try {
    const raw = fs.readFileSync(configPath, "utf8");
    const json = JSON.parse(stripTrailingCommas(stripJsoncComments(raw)));
    if (typeof json.name === "string") name = json.name;
  } catch {
    parseError = true;
  }

  return {
    present: true,
    configPath,
    name,
    mode: "host-fallback",
    parseError,
    message:
      "Dev Container detected. LeafCode Phase 3 attaches the host project path for now; full container lifecycle is not implemented yet.",
  };
}
