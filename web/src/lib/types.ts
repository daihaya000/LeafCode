/** Shared types between BFF routes and client components.
 *  Shapes follow docs/opencode/openapi.json (OpenCode 1.17.11). */

export type SessionStatusType = "idle" | "busy" | "retry";

export type SessionStatus = {
  type: SessionStatusType;
  attempt?: number;
  message?: string;
};

export type ToolState = {
  status: "pending" | "running" | "completed" | "error";
  input?: Record<string, unknown>;
  output?: string;
  title?: string;
  error?: string;
  metadata?: Record<string, unknown>;
  time?: { start?: number; end?: number };
};

/** Loose part shape covering Text/Reasoning/Tool/File/Patch/StepStart/StepFinish/Agent. */
export type Part = {
  id: string;
  messageID: string;
  sessionID?: string;
  type: string;
  text?: string;
  synthetic?: boolean;
  tool?: string;
  callID?: string;
  state?: ToolState;
  filename?: string;
  mime?: string;
  url?: string;
  hash?: string;
  files?: string[];
  name?: string;
  source?: unknown;
  time?: { start?: number; end?: number };
};

export type MessageInfo = {
  id: string;
  sessionID?: string;
  role: "user" | "assistant";
  time?: { created?: number; completed?: number };
  error?: { name?: string; data?: { message?: string } };
  summary?: boolean;
  cost?: number;
  modelID?: string;
  providerID?: string;
};

export type MessageWithParts = {
  info: MessageInfo;
  parts: Part[];
};

export type PermissionRequest = {
  id: string;
  version: "v1" | "v2";
  sessionID: string;
  /** v1 permission name or v2 action */
  permission: string;
  patterns: string[];
  metadata?: Record<string, unknown>;
  always?: string[];
  receivedAt: number;
};

export type Todo = {
  id?: string;
  content?: string;
  status?: "pending" | "in_progress" | "completed" | "cancelled";
};

export type TaskStatus =
  | "working"
  | "ready"
  | "idle"
  | "error"
  | "orphaned"
  | "unknown";

export type TaskSummary = {
  id: string; // workspace id
  projectId: string;
  projectName: string;
  title: string;
  directory: string;
  isolation: "current_folder" | "git_worktree" | "temporary_copy" | "devcontainer";
  status: TaskStatus;
  sessionId: string | null;
  branch: string | null;
  additions: number;
  deletions: number;
  filesChanged: number;
  createdAt: string;
  updatedAt: string;
};

export type DiffLine = {
  t: " " | "+" | "-";
  text: string;
};

export type DiffHunk = {
  header: string;
  lines: DiffLine[];
};

export type DiffFile = {
  path: string;
  oldPath?: string;
  additions: number;
  deletions: number;
  binary: boolean;
  untracked: boolean;
  hunks: DiffHunk[];
};

export type DiffFilesPayload = {
  git: boolean;
  branch: string | null;
  files: DiffFile[];
  additions: number;
  deletions: number;
  error?: string;
};

export type ProjectDto = {
  id: string;
  name: string;
  rootPath: string;
  favorite: boolean;
  lastOpenedAt: string | null;
};

export type HealthDto = {
  webui: { ok: boolean };
  opencode: { ok: boolean; version?: string; error?: string };
};
