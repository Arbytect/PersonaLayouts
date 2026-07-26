BEGIN;

CREATE TABLE protocol_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  revision_id uuid NOT NULL UNIQUE REFERENCES project_revisions(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'generating' CHECK (status IN ('generating', 'ready', 'failed')),
  model text,
  prompt_version text NOT NULL DEFAULT 'admin-full-v1',
  provider_response_id text,
  content jsonb NOT NULL DEFAULT '{}'::jsonb,
  quality_gate_result jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_message text,
  generated_by uuid NOT NULL REFERENCES users(id),
  generated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_protocol_drafts_project ON protocol_drafts(project_id, updated_at DESC);
CREATE TRIGGER protocol_drafts_set_updated_at
BEFORE UPDATE ON protocol_drafts
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;
