BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  password_hash text,
  display_name text NOT NULL,
  role text NOT NULL DEFAULT 'admin' CHECK (role IN ('admin', 'viewer')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE auth_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name text NOT NULL,
  email text,
  phone text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_code text NOT NULL UNIQUE,
  client_id uuid REFERENCES clients(id) ON DELETE SET NULL,
  name text NOT NULL,
  space_type text NOT NULL,
  output_language text NOT NULL DEFAULT 'tr' CHECK (output_language IN ('tr', 'en')),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'in_review', 'approved', 'archived')),
  current_revision_number integer NOT NULL DEFAULT 1 CHECK (current_revision_number > 0),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE project_members (
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('admin', 'viewer')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, user_id)
);

CREATE TABLE project_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  revision_number integer NOT NULL CHECK (revision_number > 0),
  state text NOT NULL DEFAULT 'draft' CHECK (state IN ('draft', 'approved', 'superseded')),
  change_reason text,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  approved_at timestamptz,
  UNIQUE (project_id, revision_number)
);

CREATE TABLE project_intakes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  revision_id uuid NOT NULL UNIQUE REFERENCES project_revisions(id) ON DELETE CASCADE,
  client_narrative text NOT NULL,
  measurements jsonb NOT NULL DEFAULT '{}'::jsonb,
  fixed_elements jsonb NOT NULL DEFAULT '[]'::jsonb,
  report_level text NOT NULL DEFAULT 'full_audit' CHECK (report_level IN ('diagnostic', 'full_audit')),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE source_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  revision_id uuid REFERENCES project_revisions(id) ON DELETE SET NULL,
  source_type text NOT NULL CHECK (source_type IN ('measured_plan', 'photo', 'uploaded_document')),
  original_filename text NOT NULL,
  object_key text NOT NULL UNIQUE,
  content_type text NOT NULL,
  byte_size bigint NOT NULL CHECK (byte_size > 0),
  sha256 text NOT NULL,
  file_revision integer NOT NULL DEFAULT 1 CHECK (file_revision > 0),
  uploaded_by uuid NOT NULL REFERENCES users(id),
  ai_review_status text NOT NULL DEFAULT 'pending' CHECK (ai_review_status IN ('pending', 'processing', 'completed', 'failed', 'not_requested')),
  extracted_content jsonb NOT NULL DEFAULT '{}'::jsonb,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, original_filename, file_revision)
);

CREATE TABLE evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  revision_id uuid NOT NULL REFERENCES project_revisions(id) ON DELETE CASCADE,
  source_type text NOT NULL CHECK (source_type IN ('client_statement', 'measured_plan', 'photo', 'admin_entry', 'uploaded_document')),
  source_file_id uuid REFERENCES source_files(id) ON DELETE SET NULL,
  source_page integer CHECK (source_page IS NULL OR source_page > 0),
  source_image_index integer CHECK (source_image_index IS NULL OR source_image_index >= 0),
  statement text NOT NULL,
  category text NOT NULL CHECK (category IN ('dimension', 'fixed_element', 'behavior', 'routine', 'emotional_objective', 'future_scenario', 'contradiction', 'preference', 'constraint', 'other')),
  confidence text NOT NULL CHECK (confidence IN ('confirmed', 'strong_inference', 'assumption', 'unknown')),
  verification_status text NOT NULL DEFAULT 'not_required' CHECK (verification_status IN ('not_required', 'pending', 'field_verification_required', 'verified', 'failed')),
  created_by_type text NOT NULL CHECK (created_by_type IN ('ai', 'admin', 'import')),
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  reviewed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  structured_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (source_type NOT IN ('measured_plan', 'photo', 'uploaded_document') OR source_file_id IS NOT NULL)
);

CREATE TABLE rooms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  revision_id uuid NOT NULL REFERENCES project_revisions(id) ON DELETE CASCADE,
  name text NOT NULL,
  room_type text NOT NULL,
  geometry_status text NOT NULL DEFAULT 'unverified' CHECK (geometry_status IN ('unverified', 'partial', 'measured')),
  dimensions jsonb NOT NULL DEFAULT '{}'::jsonb,
  fixed_elements jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE spatial_frictions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  revision_id uuid NOT NULL REFERENCES project_revisions(id) ON DELETE CASCADE,
  room_id uuid REFERENCES rooms(id) ON DELETE CASCADE,
  title text NOT NULL,
  statement text NOT NULL,
  behavioral_impact text NOT NULL,
  priority text NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'critical')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE evidence_frictions (
  evidence_id uuid NOT NULL REFERENCES evidence(id) ON DELETE CASCADE,
  friction_id uuid NOT NULL REFERENCES spatial_frictions(id) ON DELETE CASCADE,
  PRIMARY KEY (evidence_id, friction_id)
);

CREATE TABLE persona_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  revision_id uuid NOT NULL REFERENCES project_revisions(id) ON DELETE CASCADE,
  room_id uuid REFERENCES rooms(id) ON DELETE CASCADE,
  scope text NOT NULL CHECK (scope IN ('project', 'room')),
  persona text NOT NULL CHECK (persona IN ('sovereign', 'sage', 'alchemist', 'weaver')),
  variant text,
  percentage numeric(5,2) NOT NULL CHECK (percentage >= 0 AND percentage <= 100),
  rationale text NOT NULL,
  deviation_rationale text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((scope = 'project' AND room_id IS NULL) OR (scope = 'room' AND room_id IS NOT NULL))
);

CREATE TABLE persona_allocation_evidence (
  persona_allocation_id uuid NOT NULL REFERENCES persona_allocations(id) ON DELETE CASCADE,
  evidence_id uuid NOT NULL REFERENCES evidence(id) ON DELETE CASCADE,
  PRIMARY KEY (persona_allocation_id, evidence_id)
);

CREATE TABLE spatial_signatures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  revision_id uuid NOT NULL REFERENCES project_revisions(id) ON DELETE CASCADE,
  statement text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE spatial_signature_evidence (
  spatial_signature_id uuid NOT NULL REFERENCES spatial_signatures(id) ON DELETE CASCADE,
  evidence_id uuid NOT NULL REFERENCES evidence(id) ON DELETE CASCADE,
  PRIMARY KEY (spatial_signature_id, evidence_id)
);

CREATE TABLE identity_anchors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  revision_id uuid NOT NULL REFERENCES project_revisions(id) ON DELETE CASCADE,
  label text NOT NULL,
  description text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE identity_anchor_evidence (
  identity_anchor_id uuid NOT NULL REFERENCES identity_anchors(id) ON DELETE CASCADE,
  evidence_id uuid NOT NULL REFERENCES evidence(id) ON DELETE CASCADE,
  PRIMARY KEY (identity_anchor_id, evidence_id)
);

CREATE TABLE protocol_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  revision_id uuid NOT NULL REFERENCES project_revisions(id) ON DELETE CASCADE,
  rule_number integer NOT NULL CHECK (rule_number > 0),
  trigger text NOT NULL,
  abstract_prescription text NOT NULL,
  concrete_prescription text NOT NULL,
  success_test text NOT NULL,
  confidence text NOT NULL CHECK (confidence IN ('confirmed', 'strong_inference', 'assumption', 'unknown')),
  verification_status text NOT NULL DEFAULT 'not_required' CHECK (verification_status IN ('not_required', 'pending', 'field_verification_required', 'verified', 'failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (revision_id, rule_number)
);

CREATE TABLE protocol_rule_evidence (
  protocol_rule_id uuid NOT NULL REFERENCES protocol_rules(id) ON DELETE CASCADE,
  evidence_id uuid NOT NULL REFERENCES evidence(id) ON DELETE CASCADE,
  PRIMARY KEY (protocol_rule_id, evidence_id)
);

CREATE TABLE room_protocols (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  revision_id uuid NOT NULL REFERENCES project_revisions(id) ON DELETE CASCADE,
  room_id uuid NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  personal_moment text,
  target text NOT NULL,
  abstract_prescription text NOT NULL,
  concrete_prescription text NOT NULL,
  success_test text NOT NULL,
  confidence text NOT NULL CHECK (confidence IN ('confirmed', 'strong_inference', 'assumption', 'unknown')),
  verification_status text NOT NULL DEFAULT 'not_required' CHECK (verification_status IN ('not_required', 'pending', 'field_verification_required', 'verified', 'failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE room_protocol_evidence (
  room_protocol_id uuid NOT NULL REFERENCES room_protocols(id) ON DELETE CASCADE,
  evidence_id uuid NOT NULL REFERENCES evidence(id) ON DELETE CASCADE,
  PRIMARY KEY (room_protocol_id, evidence_id)
);

CREATE TABLE design_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  revision_id uuid NOT NULL REFERENCES project_revisions(id) ON DELETE CASCADE,
  room_id uuid REFERENCES rooms(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('requirement', 'recommendation', 'option', 'rejected', 'open')),
  decision_type text NOT NULL CHECK (decision_type IN ('layout', 'circulation', 'storage', 'lighting', 'material', 'furniture', 'acoustic', 'structural', 'plumbing', 'electrical', 'other')),
  title text NOT NULL,
  abstract_need text NOT NULL,
  concrete_decision text NOT NULL,
  success_test text NOT NULL,
  tradeoff text,
  confidence text NOT NULL CHECK (confidence IN ('confirmed', 'strong_inference', 'assumption', 'unknown')),
  verification_status text NOT NULL DEFAULT 'not_required' CHECK (verification_status IN ('not_required', 'pending', 'field_verification_required', 'verified', 'failed')),
  dimension_dependent boolean NOT NULL DEFAULT false,
  required_measurements jsonb NOT NULL DEFAULT '[]'::jsonb,
  structural_or_service_change boolean NOT NULL DEFAULT false,
  cost_min numeric(14,2),
  cost_max numeric(14,2),
  cost_currency char(3),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (cost_min IS NULL OR cost_max IS NULL OR cost_max >= cost_min)
);

CREATE TABLE decision_evidence (
  decision_id uuid NOT NULL REFERENCES design_decisions(id) ON DELETE CASCADE,
  evidence_id uuid NOT NULL REFERENCES evidence(id) ON DELETE CASCADE,
  PRIMARY KEY (decision_id, evidence_id)
);

CREATE TABLE decision_frictions (
  decision_id uuid NOT NULL REFERENCES design_decisions(id) ON DELETE CASCADE,
  friction_id uuid NOT NULL REFERENCES spatial_frictions(id) ON DELETE CASCADE,
  PRIMARY KEY (decision_id, friction_id)
);

CREATE TABLE decision_material_references (
  decision_id uuid NOT NULL REFERENCES design_decisions(id) ON DELETE CASCADE,
  source_file_id uuid NOT NULL REFERENCES source_files(id) ON DELETE CASCADE,
  PRIMARY KEY (decision_id, source_file_id)
);

CREATE TABLE open_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  revision_id uuid NOT NULL REFERENCES project_revisions(id) ON DELETE CASCADE,
  room_id uuid REFERENCES rooms(id) ON DELETE CASCADE,
  statement text NOT NULL,
  blocking boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'verified', 'failed', 'waived')),
  resolution text,
  resolved_by uuid REFERENCES users(id) ON DELETE SET NULL,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE verification_decisions (
  open_verification_id uuid NOT NULL REFERENCES open_verifications(id) ON DELETE CASCADE,
  decision_id uuid NOT NULL REFERENCES design_decisions(id) ON DELETE CASCADE,
  PRIMARY KEY (open_verification_id, decision_id)
);

CREATE TABLE approval_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  revision_id uuid NOT NULL UNIQUE REFERENCES project_revisions(id) ON DELETE RESTRICT,
  snapshot jsonb NOT NULL,
  snapshot_sha256 text NOT NULL,
  quality_gate_result jsonb NOT NULL,
  approved_by uuid NOT NULL REFERENCES users(id),
  approved_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION prevent_approval_snapshot_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Approved snapshots are immutable; create a new project revision.';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER approval_snapshots_immutable_update
BEFORE UPDATE ON approval_snapshots
FOR EACH ROW EXECUTE FUNCTION prevent_approval_snapshot_mutation();

CREATE TRIGGER approval_snapshots_immutable_delete
BEFORE DELETE ON approval_snapshots
FOR EACH ROW EXECUTE FUNCTION prevent_approval_snapshot_mutation();

CREATE TABLE generated_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  approval_snapshot_id uuid REFERENCES approval_snapshots(id) ON DELETE RESTRICT,
  revision_id uuid NOT NULL REFERENCES project_revisions(id) ON DELETE RESTRICT,
  report_type text NOT NULL CHECK (report_type IN ('draft_html', 'draft_pdf', 'approved_html', 'approved_pdf')),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'processing', 'completed', 'failed')),
  object_key text,
  sha256 text,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CHECK (report_type NOT IN ('approved_html', 'approved_pdf') OR approval_snapshot_id IS NOT NULL)
);

CREATE TABLE audit_log (
  id bigserial PRIMARY KEY,
  project_id uuid REFERENCES projects(id) ON DELETE SET NULL,
  revision_id uuid REFERENCES project_revisions(id) ON DELETE SET NULL,
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  actor_type text NOT NULL CHECK (actor_type IN ('admin', 'viewer', 'ai', 'system', 'integration')),
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text,
  old_value jsonb,
  new_value jsonb,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE integration_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid REFERENCES projects(id) ON DELETE CASCADE,
  revision_id uuid REFERENCES project_revisions(id) ON DELETE CASCADE,
  target text NOT NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'dead_letter')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  available_at timestamptz NOT NULL DEFAULT now(),
  last_error text,
  external_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_projects_client ON projects(client_id);
CREATE INDEX idx_project_revisions_project ON project_revisions(project_id, revision_number DESC);
CREATE INDEX idx_source_files_project ON source_files(project_id, created_at DESC);
CREATE INDEX idx_evidence_revision ON evidence(revision_id, category);
CREATE INDEX idx_frictions_revision ON spatial_frictions(revision_id);
CREATE INDEX idx_persona_revision_scope ON persona_allocations(revision_id, scope, room_id);
CREATE INDEX idx_decisions_revision ON design_decisions(revision_id, status);
CREATE INDEX idx_verifications_revision_status ON open_verifications(revision_id, status);
CREATE INDEX idx_reports_revision ON generated_reports(revision_id, report_type);
CREATE INDEX idx_audit_project_created ON audit_log(project_id, created_at DESC);
CREATE INDEX idx_integration_jobs_status ON integration_jobs(status, available_at);

CREATE TRIGGER users_set_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER clients_set_updated_at BEFORE UPDATE ON clients FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER projects_set_updated_at BEFORE UPDATE ON projects FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER project_intakes_set_updated_at BEFORE UPDATE ON project_intakes FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER evidence_set_updated_at BEFORE UPDATE ON evidence FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER rooms_set_updated_at BEFORE UPDATE ON rooms FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER frictions_set_updated_at BEFORE UPDATE ON spatial_frictions FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER persona_set_updated_at BEFORE UPDATE ON persona_allocations FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER signatures_set_updated_at BEFORE UPDATE ON spatial_signatures FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER rules_set_updated_at BEFORE UPDATE ON protocol_rules FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER room_protocols_set_updated_at BEFORE UPDATE ON room_protocols FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER decisions_set_updated_at BEFORE UPDATE ON design_decisions FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER integration_jobs_set_updated_at BEFORE UPDATE ON integration_jobs FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;
