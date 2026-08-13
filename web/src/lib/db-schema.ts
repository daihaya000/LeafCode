/**
 * WebUI SQLite schema (single source of truth, REFACTORING_PLAN P2-a).
 *
 * 23 tables + indexes + FTS triggers in their LATEST form. Existing databases
 * are upgraded to this shape by the migrations in getDb() (ALTER TABLE /
 * backfills); new databases get the whole schema at once.
 *
 * Keep this definition in sync with the migration steps: a column added via
 * ALTER TABLE below must exist here too.
 */

/**
 * Schema version recorded via `PRAGMA user_version`. Databases at a lower
 * version run the migration steps in getDb() before being stamped with the
 * current version (REFACTORING_PLAN P2-d/P2-e / IMPROVEMENT 3-2).
 */
export const CURRENT_SCHEMA_VERSION = 1;

export const SCHEMA_SQL = `
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS allowed_roots (
      id TEXT PRIMARY KEY,
      path TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      root_path TEXT NOT NULL UNIQUE,
      favorite INTEGER NOT NULL DEFAULT 0,
      archived INTEGER NOT NULL DEFAULT 0,
      last_opened_at TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      display_name TEXT NOT NULL,
      absolute_path TEXT NOT NULL,
      isolation TEXT NOT NULL,
      base_branch TEXT,
      worktree_path TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      execution_mode TEXT NOT NULL DEFAULT 'standard',
      primary_session_id TEXT,
      revision INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS session_bindings (
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      opencode_session_id TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      favorite INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (workspace_id, opencode_session_id)
    );
    CREATE TABLE IF NOT EXISTS goal_loops (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      opencode_session_id TEXT NOT NULL,
      status TEXT NOT NULL,
      goal TEXT NOT NULL,
      acceptance TEXT NOT NULL DEFAULT '[]',
      max_turns INTEGER NOT NULL DEFAULT 10,
      turn_count INTEGER NOT NULL DEFAULT 0,
      last_message_id TEXT,
      last_prompt_at TEXT,
      agent TEXT,
      provider_id TEXT,
      model_id TEXT,
      variant TEXT,
      progress TEXT NOT NULL DEFAULT '[]',
      summary TEXT NOT NULL DEFAULT '',
      evidence TEXT NOT NULL DEFAULT '',
      blocked_reason TEXT NOT NULL DEFAULT '',
      error TEXT NOT NULL DEFAULT '',
      revision INTEGER NOT NULL DEFAULT 0,
      turn_kind TEXT NOT NULL DEFAULT 'goal',
      pause_reason TEXT NOT NULL DEFAULT '',
      rejected_claims INTEGER NOT NULL DEFAULT 0,
      pause_requested INTEGER NOT NULL DEFAULT 0,
      force_full_run INTEGER NOT NULL DEFAULT 0,
      dismissed INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS workflow_runs (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      template_key TEXT NOT NULL,
      definition_snapshot TEXT NOT NULL,
      task_context_snapshot TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL,
      cycle_count INTEGER NOT NULL DEFAULT 0,
      max_cycles INTEGER NOT NULL DEFAULT 3,
      primary_node_key TEXT NOT NULL DEFAULT 'implement_ui',
      revision INTEGER NOT NULL DEFAULT 0,
      pause_reason TEXT NOT NULL DEFAULT '',
      error TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS workflow_node_runs (
      id TEXT PRIMARY KEY,
      workflow_run_id TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
      node_key TEXT NOT NULL,
      kind TEXT NOT NULL,
      config TEXT NOT NULL DEFAULT '{}',
      latest_attempt_no INTEGER NOT NULL DEFAULT 0,
      revision INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (workflow_run_id, node_key)
    );
    CREATE TABLE IF NOT EXISTS workflow_node_attempts (
      id TEXT PRIMARY KEY,
      node_run_id TEXT NOT NULL REFERENCES workflow_node_runs(id) ON DELETE CASCADE,
      attempt_no INTEGER NOT NULL,
      opencode_session_id TEXT,
      session_create_marker TEXT,
      status TEXT NOT NULL,
      outcome TEXT,
      config_snapshot TEXT NOT NULL DEFAULT '{}',
      input TEXT,
      result TEXT,
      error TEXT NOT NULL DEFAULT '',
      last_message_id TEXT,
      prompt_marker TEXT,
      prompt_template_version TEXT,
      output_schema_version TEXT,
      input_hash TEXT,
      input_truncated TEXT NOT NULL DEFAULT '{"omittedCount":0}',
      output_mode TEXT NOT NULL DEFAULT 'fenced_json',
      prompt_generated_at TEXT,
      dispatch_status TEXT NOT NULL DEFAULT 'not_sent',
      base_head TEXT,
      start_head TEXT,
      finish_head TEXT,
      dirty_fingerprint TEXT,
      usage_snapshot TEXT NOT NULL DEFAULT '{}',
      revision INTEGER NOT NULL DEFAULT 0,
      started_at TEXT,
      finished_at TEXT,
      UNIQUE (node_run_id, attempt_no)
    );
    CREATE TABLE IF NOT EXISTS workflow_artifacts (
      id TEXT PRIMARY KEY,
      workflow_run_id TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
      node_attempt_id TEXT REFERENCES workflow_node_attempts(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      label TEXT NOT NULL,
      opaque_ref TEXT,
      expires_at TEXT,
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS workflow_graphs (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      schema_version TEXT NOT NULL,
      registry_version TEXT NOT NULL,
      graph_revision INTEGER NOT NULL DEFAULT 1,
      viewport TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (workspace_id),
      CHECK (graph_revision >= 1)
    );
    CREATE TABLE IF NOT EXISTS workflow_graph_nodes (
      graph_id TEXT NOT NULL REFERENCES workflow_graphs(id) ON DELETE CASCADE,
      id TEXT NOT NULL,
      node_type TEXT NOT NULL,
      node_type_version INTEGER NOT NULL,
      label TEXT NOT NULL,
      position_x REAL NOT NULL,
      position_y REAL NOT NULL,
      config TEXT NOT NULL,
      disabled INTEGER NOT NULL DEFAULT 0 CHECK (disabled IN (0, 1)),
      presentation TEXT,
      node_revision INTEGER NOT NULL DEFAULT 1 CHECK (node_revision >= 1),
      PRIMARY KEY (graph_id, id),
      CHECK (position_x BETWEEN -100000 AND 100000),
      CHECK (position_y BETWEEN -100000 AND 100000),
      CHECK (node_type_version >= 1)
    );
    CREATE TABLE IF NOT EXISTS workflow_graph_edges (
      graph_id TEXT NOT NULL REFERENCES workflow_graphs(id) ON DELETE CASCADE,
      id TEXT NOT NULL,
      source_node_id TEXT NOT NULL,
      source_handle TEXT NOT NULL,
      target_node_id TEXT NOT NULL,
      target_handle TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('dependency', 'success', 'feedback', 'control')),
      label TEXT,
      edge_revision INTEGER NOT NULL DEFAULT 1 CHECK (edge_revision >= 1),
      PRIMARY KEY (graph_id, id),
      FOREIGN KEY (graph_id, source_node_id)
        REFERENCES workflow_graph_nodes(graph_id, id) ON DELETE CASCADE,
      FOREIGN KEY (graph_id, target_node_id)
        REFERENCES workflow_graph_nodes(graph_id, id) ON DELETE CASCADE
    );
    -- Server-side hang watchdog. One row per session = the newest turn that is
    -- eligible for automatic stop + single resume.
    -- See docs/specs/hang-watchdog-server-side.md.
    CREATE TABLE IF NOT EXISTS session_hang_watches (
      session_id TEXT PRIMARY KEY,
      directory TEXT NOT NULL,
      request_path TEXT NOT NULL,
      request_body TEXT NOT NULL,
      request_timeout_ms INTEGER NOT NULL,
      resume_allowed INTEGER NOT NULL DEFAULT 1,
      started_at INTEGER NOT NULL,
      last_progress_at INTEGER NOT NULL,
      progress_fingerprint TEXT NOT NULL DEFAULT '',
      retry_used INTEGER NOT NULL DEFAULT 0,
      state TEXT NOT NULL DEFAULT 'armed' CHECK (state IN ('armed', 'resolving')),
      updated_at INTEGER NOT NULL
    );
    -- Session-crossing persistent memory. See docs/specs/memory-layer.md.
    -- created_at / updated_at are epoch milliseconds (INTEGER) so the search
    -- bump and ordering play well with the FTS layer.
    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      kind TEXT NOT NULL,              -- 'fact' | 'preference' | 'lesson' | 'reference'
      content TEXT NOT NULL,
      source_session_id TEXT,
      provenance TEXT NOT NULL,        -- 'agent' | 'auto-extract' | 'auto-extract-retrospective' | 'manual'
      approved INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      last_used_at INTEGER,
      use_count INTEGER NOT NULL DEFAULT 0,
      revision INTEGER NOT NULL DEFAULT 0,
      -- Retrieval scope. workspace_id records the origin of a row, but a
      -- workspace is created per task in this product (hundreds of workspaces
      -- over a handful of directories), so a workspace-scoped store loses all
      -- prior knowledge on every new task. Retrieval therefore keys on
      -- scope_key (the project id); NULL means "not yet resolved".
      scope_kind TEXT,                 -- 'project' | 'workspace'
      scope_key TEXT,
      -- Canonical dedupe key (see memory-key.ts). NULL means "not yet computed".
      norm_key TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_memories_ws ON memories(workspace_id, approved);
    CREATE TABLE IF NOT EXISTS memory_audit_log (
      id INTEGER PRIMARY KEY,
      action TEXT NOT NULL,
      workspace_id TEXT,
      memory_id TEXT,
      session_id TEXT,
      detail TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_memory_audit_workspace
      ON memory_audit_log(workspace_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS memory_extraction_runs (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      source_session_id TEXT NOT NULL,
      assistant_message_id TEXT,
      trigger_type TEXT NOT NULL CHECK (trigger_type IN ('assistant-completed', 'goal-completed', 'idle', 'manual')),
      status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed')),
      created_count INTEGER NOT NULL DEFAULT 0,
      saved_count INTEGER NOT NULL DEFAULT 0,
      candidate_count INTEGER NOT NULL DEFAULT 0,
      rejected_count INTEGER NOT NULL DEFAULT 0,
      skipped_count INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      started_at INTEGER NOT NULL,
      completed_at INTEGER,
      read_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_memory_extraction_runs_workspace
      ON memory_extraction_runs(workspace_id, started_at DESC);
    CREATE INDEX IF NOT EXISTS idx_memory_extraction_runs_unread
      ON memory_extraction_runs(workspace_id, read_at, started_at DESC);
    -- FTS5 access path. id is carried as an UNINDEXED column (TEXT PK does not
    -- align with SQLite rowid), so the sync never relies on rowid.
    CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(id UNINDEXED, content);
    DROP TRIGGER IF EXISTS memories_fts_insert;
    CREATE TRIGGER memories_fts_insert AFTER INSERT ON memories BEGIN
      INSERT INTO memories_fts(id, content) VALUES (new.id, new.content);
    END;
    DROP TRIGGER IF EXISTS memories_fts_update;
    CREATE TRIGGER memories_fts_update AFTER UPDATE ON memories BEGIN
      UPDATE memories_fts SET content = new.content WHERE id = new.id;
    END;
    DROP TRIGGER IF EXISTS memories_fts_delete;
    CREATE TRIGGER memories_fts_delete AFTER DELETE ON memories BEGIN
      DELETE FROM memories_fts WHERE id = old.id;
    END;
    -- Idle-extraction ledger: which (workspace, session) pairs have already been
    -- extracted by the idle sweep (docs/specs/memory-layer.md 「自動抽出」).
    -- Deliberately NOT keyed to source content so a session is extracted at most
    -- once for its lifetime, preventing duplicate background work.
    CREATE TABLE IF NOT EXISTS memory_idle_extracts (
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      session_id TEXT NOT NULL,
      extracted_at INTEGER NOT NULL,
      PRIMARY KEY (workspace_id, session_id)
    );
    -- Assistant-message extraction ledger. Claims are short-lived so a
    -- crashed/aborted extraction can be retried, while completed rows make
    -- duplicate global-event deliveries idempotent.
    CREATE TABLE IF NOT EXISTS memory_assistant_extracts (
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      session_id TEXT NOT NULL,
      assistant_message_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'in_flight'
        CHECK (status IN ('in_flight', 'completed')),
      claimed_at INTEGER NOT NULL,
      extracted_at INTEGER,
      PRIMARY KEY (workspace_id, session_id, assistant_message_id)
    );
    CREATE INDEX IF NOT EXISTS idx_memory_assistant_extracts_status
      ON memory_assistant_extracts(status, claimed_at);
    -- Incremental-extraction state, one row per (workspace, session).
    -- last_message_id is the newest transcript message already digested, so a
    -- later run only feeds the delta to the model instead of re-submitting the
    -- same 16k tail (the v1 behaviour that produced 358 runs / 634 paraphrased
    -- rows for a single session). last_extracted_at drives the cooldown.
    CREATE TABLE IF NOT EXISTS memory_session_extract_state (
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      session_id TEXT NOT NULL,
      last_message_id TEXT,
      last_extracted_at INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (workspace_id, session_id)
    );
    CREATE TABLE IF NOT EXISTS memory_session_injections (
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      session_id TEXT NOT NULL,
      injected_at INTEGER NOT NULL,
      PRIMARY KEY (workspace_id, session_id)
    );
    CREATE INDEX IF NOT EXISTS idx_memory_session_injections_workspace
      ON memory_session_injections(workspace_id, injected_at DESC);
    -- Collaboration-context snapshot dedupe. One row per (workspace, session):
    -- the last injected peer/file snapshot and its fingerprint, so unchanged
    -- peer state is not re-injected on every prompt_async.
    CREATE TABLE IF NOT EXISTS collaboration_snapshots (
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      session_id TEXT NOT NULL,
      fingerprint TEXT NOT NULL DEFAULT '',
      snapshot TEXT NOT NULL DEFAULT '',
      injected_at INTEGER NOT NULL,
      compacted_at INTEGER,
      PRIMARY KEY (workspace_id, session_id)
    );
    -- Session-level compaction lock shared by all WebUI tabs/processes.
    -- Expired rows are removed atomically by tryAcquireSessionCompactionLock.
    CREATE TABLE IF NOT EXISTS session_compaction_locks (
      session_id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      acquired_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_session_compaction_locks_expiry
      ON session_compaction_locks(expires_at);
    CREATE INDEX IF NOT EXISTS idx_workspaces_project ON workspaces(project_id);
    CREATE INDEX IF NOT EXISTS idx_goal_loops_workspace ON goal_loops(workspace_id);
    CREATE INDEX IF NOT EXISTS idx_goal_loops_status ON goal_loops(status);
    CREATE INDEX IF NOT EXISTS idx_workflow_runs_workspace ON workflow_runs(workspace_id);
    CREATE INDEX IF NOT EXISTS idx_workflow_runs_status ON workflow_runs(status);
    CREATE INDEX IF NOT EXISTS idx_workflow_node_runs_workflow ON workflow_node_runs(workflow_run_id);
    CREATE INDEX IF NOT EXISTS idx_workflow_node_attempts_node ON workflow_node_attempts(node_run_id);
    CREATE INDEX IF NOT EXISTS idx_workflow_artifacts_attempt ON workflow_artifacts(node_attempt_id);
    CREATE INDEX IF NOT EXISTS idx_workflow_graphs_workspace ON workflow_graphs(workspace_id);
    CREATE INDEX IF NOT EXISTS idx_workflow_graph_nodes_graph ON workflow_graph_nodes(graph_id);
    CREATE INDEX IF NOT EXISTS idx_workflow_graph_edges_graph ON workflow_graph_edges(graph_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_workflow_runs_one_active
      ON workflow_runs(workspace_id)
      WHERE status NOT IN ('completed', 'failed', 'stopped', 'detached');
    CREATE UNIQUE INDEX IF NOT EXISTS idx_workflow_attempts_one_active
      ON workflow_node_attempts(node_run_id)
      WHERE status IN ('creating_session', 'dispatching', 'running');
  `;
