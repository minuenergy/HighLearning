CREATE TABLE IF NOT EXISTS invite_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL
    CHECK (role IN ('teacher', 'student')),
  purpose TEXT NOT NULL
    CHECK (purpose IN ('teacher_onboarding', 'student_onboarding')),
  created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  school_class_id UUID REFERENCES school_classes(id) ON DELETE SET NULL,
  course_id UUID REFERENCES courses(id) ON DELETE CASCADE,
  label TEXT,
  subject_names TEXT[] NOT NULL DEFAULT '{}',
  max_uses INTEGER NOT NULL DEFAULT 1,
  used_count INTEGER NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_invite_codes_owner_role
  ON invite_codes(created_by, role, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_invite_codes_scope
  ON invite_codes(course_id, school_class_id, role, active);

ALTER TABLE invite_codes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Teacher manages own invite codes" ON invite_codes
  FOR ALL USING (auth.uid() = created_by);

ALTER TABLE student_settings
  ADD COLUMN IF NOT EXISTS verification_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (verification_status IN ('pending', 'verified', 'manual_review'));

ALTER TABLE student_settings
  ADD COLUMN IF NOT EXISTS verification_method TEXT;

ALTER TABLE student_settings
  ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;

ALTER TABLE student_settings
  ADD COLUMN IF NOT EXISTS invite_code_used TEXT;

ALTER TABLE teacher_settings
  ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;

ALTER TABLE teacher_settings
  ADD COLUMN IF NOT EXISTS invite_code_used TEXT;

ALTER TABLE teacher_settings
  ADD COLUMN IF NOT EXISTS verification_note TEXT;

ALTER TABLE materials
  ADD COLUMN IF NOT EXISTS processing_status TEXT NOT NULL DEFAULT 'uploaded'
    CHECK (processing_status IN ('uploaded', 'queued', 'parsing', 'indexing', 'completed', 'failed'));

ALTER TABLE materials
  ADD COLUMN IF NOT EXISTS processing_stage TEXT;

ALTER TABLE materials
  ADD COLUMN IF NOT EXISTS parser_used TEXT;

ALTER TABLE materials
  ADD COLUMN IF NOT EXISTS chunk_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE materials
  ADD COLUMN IF NOT EXISTS extracted_char_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE materials
  ADD COLUMN IF NOT EXISTS error_message TEXT;

ALTER TABLE materials
  ADD COLUMN IF NOT EXISTS processing_started_at TIMESTAMPTZ;

ALTER TABLE materials
  ADD COLUMN IF NOT EXISTS processing_completed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_materials_course_processing
  ON materials(course_id, processing_status, created_at DESC);
