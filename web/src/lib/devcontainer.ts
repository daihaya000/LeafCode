import fs from "node:fs";
import path from "node:path";

export type DevcontainerInfo = {
  present: boolean;
  configPath: string | null;
  name: string | null;
  mode: "host-fallback" | "unsupported";
  message: string;
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
      message: "No .devcontainer config found",
    };
  }

  let name: string | null = null;
  try {
    const raw = fs.readFileSync(configPath, "utf8");
    // strip simple // comments for lenient JSONC
    const json = JSON.parse(raw.replace(/\/\/.*$/gm, ""));
    if (typeof json.name === "string") name = json.name;
  } catch {
    /* ignore parse errors */
  }

  return {
    present: true,
    configPath,
    name,
    mode: "host-fallback",
    message:
      "Dev Container detected. OpenCode WebUI Phase 3 attaches the host project path for now; full container lifecycle is not implemented yet.",
  };
}
