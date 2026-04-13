ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS phone_number TEXT;

CREATE TABLE IF NOT EXISTS school_classes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  grade_level TEXT,
  class_label TEXT,
  academic_year INTEGER,
  class_code TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_school_classes_teacher_year_label
  ON school_classes(teacher_id, academic_year, class_label);

CREATE UNIQUE INDEX IF NOT EXISTS idx_school_classes_class_code
  ON school_classes(class_code)
  WHERE class_code IS NOT NULL;

CREATE TABLE IF NOT EXISTS subjects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_subjects_code
  ON subjects(code)
  WHERE code IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_subjects_name
  ON subjects(name);

INSERT INTO subjects (name, code)
VALUES
  ('국어', 'kor'),
  ('수학', 'math'),
  ('영어', 'eng'),
  ('과학', 'sci'),
  ('사회', 'soc'),
  ('통합사회', 'intsoc'),
  ('생명과학', 'bio'),
  ('체육', 'pe'),
  ('음악', 'music'),
  ('미술', 'art')
ON CONFLICT (name) DO NOTHING;

ALTER TABLE courses
  ADD COLUMN IF NOT EXISTS school_class_id UUID REFERENCES school_classes(id) ON DELETE SET NULL;

ALTER TABLE courses
  ADD COLUMN IF NOT EXISTS subject_id UUID REFERENCES subjects(id) ON DELETE SET NULL;

ALTER TABLE courses
  ADD COLUMN IF NOT EXISTS academic_year INTEGER;

ALTER TABLE courses
  ADD COLUMN IF NOT EXISTS grade_level TEXT;

ALTER TABLE courses
  ADD COLUMN IF NOT EXISTS class_label TEXT;

ALTER TABLE courses
  ADD COLUMN IF NOT EXISTS subject_name TEXT;

CREATE INDEX IF NOT EXISTS idx_courses_teacher_class_subject
  ON courses(teacher_id, school_class_id, subject_id);

CREATE INDEX IF NOT EXISTS idx_courses_subject_name
  ON courses(subject_name);

CREATE TABLE IF NOT EXISTS teacher_settings (
  teacher_id UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  school_name TEXT,
  school_email TEXT,
  phone_number TEXT,
  verification_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (verification_status IN ('pending', 'verified', 'manual_review')),
  verification_method TEXT,
  subject_names TEXT[] NOT NULL DEFAULT '{}',
  grade_levels TEXT[] NOT NULL DEFAULT '{}',
  class_labels TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS student_settings (
  student_id UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  phone_number TEXT,
  student_number TEXT,
  school_class_id UUID REFERENCES school_classes(id) ON DELETE SET NULL,
  class_label TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS teacher_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  student_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  course_id UUID REFERENCES courses(id) ON DELETE CASCADE,
  school_class_id UUID REFERENCES school_classes(id) ON DELETE SET NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_teacher_notes_teacher_student
  ON teacher_notes(teacher_id, student_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_teacher_notes_class_scope
  ON teacher_notes(teacher_id, school_class_id, updated_at DESC);

ALTER TABLE school_classes ENABLE ROW LEVEL SECURITY;
ALTER TABLE subjects ENABLE ROW LEVEL SECURITY;
ALTER TABLE teacher_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE teacher_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Teacher manages own school classes" ON school_classes
  FOR ALL USING (auth.uid() = teacher_id);

CREATE POLICY "Authenticated users view subjects" ON subjects
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Teacher manages own settings" ON teacher_settings
  FOR ALL USING (auth.uid() = teacher_id);

CREATE POLICY "Student manages own settings" ON student_settings
  FOR ALL USING (auth.uid() = student_id);

CREATE POLICY "Teacher manages own notes" ON teacher_notes
  FOR ALL USING (auth.uid() = teacher_id);
