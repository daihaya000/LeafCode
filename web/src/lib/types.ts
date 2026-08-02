/** Shared types between BFF routes and client components.
 *  Shapes follow docs/opencode/openapi.json (OpenCode 1.17.11). */

export type SessionStatusType = "idle" | "busy" | "retry";

export type SessionStatus = {
  type: SessionStatusType;
  attempt?: number;
  message?: string;
};

export type ToolState = {
  status: "pending" | "running" | "completed" | "cancelled" | "error";
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
  metadata?: Record<string, unknown>;
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
  /** OpenCode agent that produced the message (e.g. "plan", "build"). */
  agent?: string;
  time?: { created?: number; completed?: number };
  error?: { name?: string; data?: { message?: string } };
  summary?: boolean;
  cost?: number;
  /** Token usage for this assistant turn (from Message.tokens). */
  tokens?: {
    total?: number;
    input: number;
    output: number;
    reasoning: number;
    cache?: { read: number; write: number };
  };
  /** Structured output payload when a prompt requested an OutputFormatJsonSchema. */
  structured?: unknown;
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

export type QuestionOption = {
  label: string;
  description: string;
};

export type QuestionInfo = {
  question: string;
  header: string;
  options: QuestionOption[];
  multiple?: boolean;
  custom?: boolean;
};

export type QuestionRequest = {
  id: string;
  version: "v1" | "v2";
  sessionID: string;
  questions: QuestionInfo[];
  receivedAt: number;
};

export type Todo = {
  id?: string;
  content?: string;
  status?: "pending" | "in_progress" | "completed" | "cancelled";
};

/** OpenCode soft-revert marker on a session (messages remain until cleanup). */
export type SessionRevert = {
  messageID: string;
  partID?: string;
  snapshot?: string;
  diff?: string;
};

export type TaskStatus =
  | "working"
  | "ready"
  | "idle"
  | "error"
  | "orphaned"
  | "merged"
  | "archived"
  | "unknown";

export type TaskExecutionMode = "standard" | "workflow";

export type TaskSummary = {
  id: string; // workspace id
  projectId: string;
  projectName: string;
  title: string;
  directory: string;
  isolation: "current_folder" | "git_worktree" | "temporary_copy" | "devcontainer";
  status: TaskStatus;
  sessionId: string | null;
  /** Execution mode. Optional for compatibility with existing API fixtures. */
  executionMode?: TaskExecutionMode;
  /** Whether the bound session is marked as a favorite. */
  favorite?: boolean;
  branch: string | null;
  additions: number;
  deletions: number;
  filesChanged: number;
  /** Cumulative USD cost of the bound OpenCode session (from Session.cost), if known. */
  cost?: number;
  /** OpenCode agent bound to the session (e.g. "build", "plan"), if known. */
  agent?: string;
  /** Provider id of the session's current/last model (from Session.model.providerID). */
  providerID?: string;
  /** Model id of the session's current/last model (from Session.model.id). */
  modelID?: string;
  /** Reasoning effort of the session's current/last model (from Session.model.variant). */
  variant?: string;
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
  /** Base ref this diff was computed against (merge-base compare), if any. */
  base?: string | null;
  files: DiffFile[];
  additions: number;
  deletions: number;
  error?: string;
};

/** One commit for the graph panel. */
export type GraphCommit = {
  hash: string;
  shortHash: string;
  parents: string[];
  subject: string;
  author: string;
  authorEmail: string;
  date: string;
};

export type GraphRef = {
  name: string;
  hash: string;
  current?: boolean;
};

export type GraphLogPayload = {
  commits: GraphCommit[];
  refs: GraphRef[];
  currentBranch: string | null;
  hasMore: boolean;
};

export type GraphFileChange = {
  path: string;
  status: "M" | "A" | "D" | "R" | "C" | "T" | "U" | "?";
};

export type GraphShowPayload = {
  commit: string;
  files?: GraphFileChange[];
  diff?: string;
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
