ALTER TABLE exams
  DROP CONSTRAINT IF EXISTS exams_source_format_check;

ALTER TABLE exams
  ADD CONSTRAINT exams_source_format_check
  CHECK (source_format IN ('manual', 'markdown_upload', 'preset', 'simulation', 'textbook_generated'));

ALTER TABLE exams
  ADD COLUMN IF NOT EXISTS workflow_status TEXT NOT NULL DEFAULT 'published'
  CHECK (workflow_status IN ('draft', 'reviewed', 'published', 'archived'));

ALTER TABLE exams
  ADD COLUMN IF NOT EXISTS assignment_type TEXT NOT NULL DEFAULT 'exam'
  CHECK (assignment_type IN ('exam', 'homework'));

ALTER TABLE exams
  ADD COLUMN IF NOT EXISTS due_at TIMESTAMPTZ;

ALTER TABLE exams
  ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ;

ALTER TABLE exams
  ADD COLUMN IF NOT EXISTS textbook_slug TEXT;

ALTER TABLE exams
  ADD COLUMN IF NOT EXISTS textbook_title TEXT;

ALTER TABLE exams
  ADD COLUMN IF NOT EXISTS section_title TEXT;

ALTER TABLE exams
  ADD COLUMN IF NOT EXISTS section_page_start INTEGER;

ALTER TABLE exams
  ADD COLUMN IF NOT EXISTS section_page_end INTEGER;

ALTER TABLE exams
  ADD COLUMN IF NOT EXISTS assignment_note TEXT;

ALTER TABLE exam_questions
  ADD COLUMN IF NOT EXISTS source_pages INTEGER[] NOT NULL DEFAULT '{}';

ALTER TABLE exam_questions
  ADD COLUMN IF NOT EXISTS evidence_excerpt TEXT;

ALTER TABLE exam_questions
  ADD COLUMN IF NOT EXISTS source_textbook_slug TEXT;

ALTER TABLE exam_questions
  ADD COLUMN IF NOT EXISTS source_section_title TEXT;

CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id UUID REFERENCES courses(id) ON DELETE CASCADE,
  student_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  exam_id UUID REFERENCES exams(id) ON DELETE CASCADE,
  notification_type TEXT NOT NULL
    CHECK (notification_type IN ('assignment_assigned', 'assignment_overdue')),
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'read')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  sent_at TIMESTAMPTZ,
  UNIQUE(exam_id, student_id, notification_type)
);

CREATE INDEX IF NOT EXISTS idx_exams_workflow_due
  ON exams(course_id, workflow_status, due_at DESC);

CREATE INDEX IF NOT EXISTS idx_exam_questions_textbook_source
  ON exam_questions(source_textbook_slug, source_section_title);

CREATE INDEX IF NOT EXISTS idx_notifications_student_status
  ON notifications(student_id, status, created_at DESC);

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Teacher views class notifications" ON notifications
  FOR SELECT USING (
    EXISTS (
      SELECT 1
      FROM courses
      WHERE courses.id = course_id
        AND courses.teacher_id = auth.uid()
    )
  );

CREATE POLICY "Student views own notifications" ON notifications
  FOR SELECT USING (auth.uid() = student_id);
