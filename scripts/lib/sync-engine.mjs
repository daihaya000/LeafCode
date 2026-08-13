import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { readJsonc } from "./jsonc.mjs";
import { buildTargets, replaceCodexMcpTables } from "./sync-utils.mjs";

/**
 * Sync plan/apply shared by the web UI (via `sync-engine.d.mts`) and the CLI
 * (REFACTORING_PLAN P1-b / IMPROVEMENT 6-1). `paths` is injected so the CLI
 * can keep its own config resolution while sharing the whole plan/apply logic.
 */

function parseJsonSettings(text) {
  if (text.trim() === "") return {};
  return JSON.parse(text);
}

export function planSync({ paths, isDistributable = () => true }) {
  if (!existsSync(paths.opencode)) {
    return {
      ok: false,
      error: `master not found: ${paths.opencode}`,
      masterServers: [],
      targets: {},
    };
  }
  const master = readJsonc(paths.opencode);
  const mcp = master.mcp || {};
  const { codexBlocks, claudeServers, cursorServers, names } = buildTargets(mcp, {
    isDistributable,
  });

  const targets = {};

  if (existsSync(paths.codex)) {
    const original = readFileSync(paths.codex, "utf8");
    const next = replaceCodexMcpTables(original, codexBlocks);
    const inSync = next === original;
    targets.codex = {
      exists: true,
      inSync,
      wouldChange: !inSync,
      message: inSync
        ? `already in sync (${names.length} servers)`
        : `would rewrite mcp_servers (${names.length} servers)`,
    };
  } else {
    targets.codex = {
      exists: false,
      inSync: false,
      wouldChange: false,
      message: `skip: ${paths.codex} not found`,
    };
  }

  if (existsSync(paths.claude)) {
    const original = readFileSync(paths.claude, "utf8");
    let settings;
    try {
      settings = parseJsonSettings(original);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      targets.claude = {
        exists: true,
        inSync: false,
        wouldChange: false,
        message: `skip: ${paths.claude} is not valid JSON (${detail})`,
      };
    }
    if (settings !== undefined) {
      const before = JSON.stringify(settings.mcpServers ?? null);
      settings.mcpServers = claudeServers;
      const after = JSON.stringify(settings.mcpServers);
      const inSync = before === after;
      targets.claude = {
        exists: true,
        inSync,
        wouldChange: !inSync,
        message: inSync
          ? `already in sync (${names.length} servers)`
          : `would rewrite mcpServers (${names.length} servers)`,
      };
    }
  } else {
    targets.claude = {
      exists: false,
      inSync: false,
      wouldChange: false,
      message: `skip: ${paths.claude} not found`,
    };
  }

  if (existsSync(paths.cursor)) {
    const original = readFileSync(paths.cursor, "utf8");
    let settings;
    try {
      settings = parseJsonSettings(original);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      targets.cursor = {
        exists: true,
        inSync: false,
        wouldChange: false,
        message: `skip: ${paths.cursor} is not valid JSON (${detail})`,
      };
    }
    if (settings !== undefined) {
      const before = JSON.stringify(settings.mcpServers ?? null);
      settings.mcpServers = cursorServers;
      const after = JSON.stringify(settings.mcpServers);
      const inSync = before === after;
      targets.cursor = {
        exists: true,
        inSync,
        wouldChange: !inSync,
        message: inSync
          ? `already in sync (${names.length} servers)`
          : `would rewrite mcpServers (${names.length} servers)`,
      };
    }
  } else {
    targets.cursor = {
      exists: false,
      inSync: false,
      wouldChange: false,
      message: `skip: ${paths.cursor} not found`,
    };
  }

  return {
    ok: true,
    masterServers: names,
    targets,
  };
}

export function applySync({ paths, isDistributable = () => true }) {
  if (!existsSync(paths.opencode)) {
    return {
      ok: false,
      error: `master not found: ${paths.opencode}`,
      masterServers: [],
      changedFiles: 0,
      targets: {},
    };
  }
  const master = readJsonc(paths.opencode);
  const mcp = master.mcp || {};
  const { codexBlocks, claudeServers, cursorServers, names } = buildTargets(mcp, {
    isDistributable,
  });

  const targets = {};
  let changed = 0;

  if (existsSync(paths.codex)) {
    const original = readFileSync(paths.codex, "utf8");
    const next = replaceCodexMcpTables(original, codexBlocks);
    if (next !== original) {
      writeFileSync(paths.codex, next, "utf8");
      changed++;
      targets.codex = {
        exists: true,
        updated: true,
        message: `wrote ${names.length} mcp_servers`,
      };
    } else {
      targets.codex = {
        exists: true,
        updated: false,
        message: `already in sync (${names.length} servers)`,
      };
    }
  } else {
    targets.codex = {
      exists: false,
      updated: false,
      message: `skip: ${paths.codex} not found`,
    };
  }

  if (existsSync(paths.claude)) {
    const original = readFileSync(paths.claude, "utf8");
    let settings;
    try {
      settings = parseJsonSettings(original);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      targets.claude = {
        exists: true,
        updated: false,
        message: `skip: ${paths.claude} is not valid JSON (${detail})`,
      };
    }
    if (settings !== undefined) {
      const before = JSON.stringify(settings.mcpServers ?? null);
      settings.mcpServers = claudeServers;
      const after = JSON.stringify(settings.mcpServers);
      if (before !== after) {
        writeFileSync(paths.claude, JSON.stringify(settings, null, 2) + "\n", "utf8");
        changed++;
        targets.claude = {
          exists: true,
          updated: true,
          message: `wrote ${names.length} mcpServers`,
        };
      } else {
        targets.claude = {
          exists: true,
          updated: false,
          message: `already in sync (${names.length} servers)`,
        };
      }
    }
  } else {
    targets.claude = {
      exists: false,
      updated: false,
      message: `skip: ${paths.claude} not found`,
    };
  }

  if (existsSync(paths.cursor)) {
    const original = readFileSync(paths.cursor, "utf8");
    let settings;
    try {
      settings = parseJsonSettings(original);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      targets.cursor = {
        exists: true,
        updated: false,
        message: `skip: ${paths.cursor} is not valid JSON (${detail})`,
      };
    }
    if (settings !== undefined) {
      const before = JSON.stringify(settings.mcpServers ?? null);
      settings.mcpServers = cursorServers;
      const after = JSON.stringify(settings.mcpServers);
      if (before !== after) {
        writeFileSync(paths.cursor, JSON.stringify(settings, null, 2) + "\n", "utf8");
        changed++;
        targets.cursor = {
          exists: true,
          updated: true,
          message: `wrote ${names.length} mcpServers`,
        };
      } else {
        targets.cursor = {
          exists: true,
          updated: false,
          message: `already in sync (${names.length} servers)`,
        };
      }
    }
  } else {
    targets.cursor = {
      exists: false,
      updated: false,
      message: `skip: ${paths.cursor} not found`,
    };
  }

  return {
    ok: true,
    masterServers: names,
    changedFiles: changed,
    targets,
  };
}
