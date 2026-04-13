CREATE TABLE IF NOT EXISTS material_pages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  material_id UUID NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
  page_number INTEGER NOT NULL,
  page_label TEXT,
  text_content TEXT NOT NULL,
  char_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(material_id, page_number)
);

CREATE INDEX IF NOT EXISTS idx_material_pages_material_order
  ON material_pages(material_id, page_number);

ALTER TABLE material_pages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Teacher views own material pages" ON material_pages
  FOR SELECT USING (
    EXISTS (
      SELECT 1
      FROM materials
      JOIN courses ON courses.id = materials.course_id
      WHERE materials.id = material_id
        AND courses.teacher_id = auth.uid()
    )
  );

ALTER TABLE materials
  ADD COLUMN IF NOT EXISTS page_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE materials
  ADD COLUMN IF NOT EXISTS summary_text TEXT;

ALTER TABLE materials
  ADD COLUMN IF NOT EXISTS detected_sections JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE materials
  ADD COLUMN IF NOT EXISTS draft_generation_status TEXT NOT NULL DEFAULT 'idle'
  CHECK (draft_generation_status IN ('idle', 'analyzing', 'generating', 'completed', 'failed'));

ALTER TABLE materials
  ADD COLUMN IF NOT EXISTS draft_generation_stage TEXT;

ALTER TABLE materials
  ADD COLUMN IF NOT EXISTS draft_generation_error TEXT;

ALTER TABLE materials
  ADD COLUMN IF NOT EXISTS draft_generated_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE materials
  ADD COLUMN IF NOT EXISTS last_generated_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_materials_course_generation
  ON materials(course_id, draft_generation_status, created_at DESC);

ALTER TABLE exams
  DROP CONSTRAINT IF EXISTS exams_source_format_check;

ALTER TABLE exams
  ADD CONSTRAINT exams_source_format_check
  CHECK (
    source_format IN (
      'manual',
      'markdown_upload',
      'preset',
      'simulation',
      'textbook_generated',
      'material_generated'
    )
  );

ALTER TABLE exams
  ADD COLUMN IF NOT EXISTS material_id UUID REFERENCES materials(id) ON DELETE SET NULL;

ALTER TABLE exams
  ADD COLUMN IF NOT EXISTS learning_objective TEXT;

CREATE INDEX IF NOT EXISTS idx_exams_material
  ON exams(material_id, created_at DESC);
