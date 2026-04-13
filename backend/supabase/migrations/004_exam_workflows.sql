ALTER TABLE exams
  ADD COLUMN IF NOT EXISTS source_name TEXT;

ALTER TABLE exams
  ADD COLUMN IF NOT EXISTS source_format TEXT NOT NULL DEFAULT 'manual'
  CHECK (source_format IN ('manual', 'markdown_upload', 'preset', 'simulation'));

ALTER TABLE exams
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES profiles(id) ON DELETE SET NULL;

ALTER TABLE exam_answers
  ADD COLUMN IF NOT EXISTS corrected_choice TEXT;

ALTER TABLE exam_answers
  ADD COLUMN IF NOT EXISTS resolved_via_tutor BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE exam_answers
  ADD COLUMN IF NOT EXISTS review_completed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_exams_course_source
  ON exams(course_id, source_format, source_name);

CREATE INDEX IF NOT EXISTS idx_exam_answers_review_status
  ON exam_answers(resolved_via_tutor, review_completed_at DESC);
