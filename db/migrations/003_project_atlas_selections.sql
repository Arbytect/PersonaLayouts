BEGIN;

CREATE TABLE project_atlas_selections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  revision_id uuid NOT NULL UNIQUE REFERENCES project_revisions(id) ON DELETE CASCADE,
  primary_lens_slug text NOT NULL,
  supporting_lens_slug text,
  alternative_lens_slug text,
  rationale text NOT NULL DEFAULT '',
  updated_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT project_atlas_distinct_supporting
    CHECK (supporting_lens_slug IS NULL OR supporting_lens_slug <> primary_lens_slug),
  CONSTRAINT project_atlas_distinct_alternative
    CHECK (alternative_lens_slug IS NULL OR alternative_lens_slug <> primary_lens_slug),
  CONSTRAINT project_atlas_distinct_secondary
    CHECK (alternative_lens_slug IS NULL OR supporting_lens_slug IS NULL OR alternative_lens_slug <> supporting_lens_slug)
);

CREATE INDEX idx_project_atlas_selections_project
  ON project_atlas_selections(project_id, updated_at DESC);

CREATE TRIGGER project_atlas_selections_set_updated_at
BEFORE UPDATE ON project_atlas_selections
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;
