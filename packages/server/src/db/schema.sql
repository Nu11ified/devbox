-- Patchwork application schema
-- DBOS manages its own system tables; these are application tables.

CREATE TABLE IF NOT EXISTS devbox_templates (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL UNIQUE,
  base_image      TEXT NOT NULL,
  tool_bundles    JSONB NOT NULL DEFAULT '[]',
  env_vars        JSONB NOT NULL DEFAULT '{}',
  bootstrap       JSONB NOT NULL DEFAULT '[]',
  resource_limits JSONB NOT NULL,
  network_policy  TEXT NOT NULL DEFAULT 'restricted',
  repos           JSONB NOT NULL DEFAULT '[]',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS runs (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status           TEXT NOT NULL DEFAULT 'pending',
  blueprint_id     TEXT NOT NULL,
  repo             TEXT NOT NULL,
  base_sha         TEXT,
  branch           TEXT,
  task_description TEXT NOT NULL,
  created_by       TEXT,
  devbox_id        UUID,
  pr_url           TEXT,
  config           JSONB NOT NULL DEFAULT '{}',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS devboxes (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id   UUID REFERENCES devbox_templates(id),
  status        TEXT NOT NULL DEFAULT 'provisioning',
  container_id  TEXT,
  host          TEXT,
  repo_checkout TEXT,
  run_id        UUID,
  last_seen_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS run_steps (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id        UUID NOT NULL REFERENCES runs(id),
  node_id       TEXT NOT NULL,
  node_type     TEXT NOT NULL,
  agent_backend TEXT,
  agent_role    TEXT,
  status        TEXT NOT NULL DEFAULT 'pending',
  iteration     INTEGER DEFAULT 0,
  started_at    TIMESTAMPTZ,
  ended_at      TIMESTAMPTZ,
  duration_ms   INTEGER,
  output        JSONB,
  error         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS patches (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id         UUID NOT NULL REFERENCES runs(id),
  step_id        UUID REFERENCES run_steps(id),
  agent_role     TEXT NOT NULL,
  base_sha       TEXT NOT NULL,
  files          JSONB NOT NULL,
  intent_summary TEXT,
  confidence     TEXT DEFAULT 'medium',
  risks          JSONB DEFAULT '[]',
  patch_path     TEXT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS transcript_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id        UUID NOT NULL REFERENCES runs(id),
  step_id       UUID REFERENCES run_steps(id),
  event_type    TEXT NOT NULL,
  agent_backend TEXT,
  content       JSONB NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS artifacts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id      UUID NOT NULL REFERENCES runs(id),
  step_id     UUID REFERENCES run_steps(id),
  kind        TEXT NOT NULL,
  file_path   TEXT NOT NULL,
  metadata    JSONB DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Issues (orchestrator issue board)
DO $$ BEGIN
  CREATE SEQUENCE issue_seq START 1;
EXCEPTION WHEN duplicate_table THEN
  NULL;
END $$;

CREATE TABLE IF NOT EXISTS issues (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  identifier       TEXT NOT NULL UNIQUE,  -- PW-1, PW-2, ...
  title            TEXT NOT NULL,
  body             TEXT NOT NULL DEFAULT '',
  repo             TEXT NOT NULL,
  branch           TEXT NOT NULL DEFAULT 'main',
  status           TEXT NOT NULL DEFAULT 'open',
  priority         INTEGER NOT NULL DEFAULT 2,  -- 0=urgent, 1=high, 2=medium, 3=low
  blueprint_id     TEXT NOT NULL DEFAULT 'simple',
  template_id      UUID REFERENCES devbox_templates(id),
  assignee         TEXT,
  run_id           UUID REFERENCES runs(id),
  labels           JSONB NOT NULL DEFAULT '[]',
  retry_count      INTEGER NOT NULL DEFAULT 0,
  last_error       TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status);
CREATE INDEX IF NOT EXISTS idx_runs_created_by ON runs(created_by);
CREATE INDEX IF NOT EXISTS idx_run_steps_run_id ON run_steps(run_id);
CREATE INDEX IF NOT EXISTS idx_patches_run_id ON patches(run_id);
CREATE INDEX IF NOT EXISTS idx_transcript_run_id ON transcript_events(run_id);
CREATE INDEX IF NOT EXISTS idx_transcript_created ON transcript_events(created_at);
CREATE INDEX IF NOT EXISTS idx_artifacts_run_id ON artifacts(run_id);
CREATE INDEX IF NOT EXISTS idx_issues_status ON issues(status);
CREATE INDEX IF NOT EXISTS idx_issues_priority ON issues(priority);
