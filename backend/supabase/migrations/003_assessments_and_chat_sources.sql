ALTER TABLE tutor_conversations
  ADD COLUMN IF NOT EXISTS source_type TEXT NOT NULL DEFAULT 'tutor_session'
  CHECK (source_type IN ('tutor_session', 'exam_review', 'exam_result'));

ALTER TABLE tutor_conversations
  ADD COLUMN IF NOT EXISTS source_reference_id UUID;

ALTER TABLE tutor_conversations
  ADD COLUMN IF NOT EXISTS focus_question TEXT;

CREATE TABLE exams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id UUID REFERENCES courses(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  exam_date TIMESTAMPTZ DEFAULT NOW(),
  duration_minutes INTEGER NOT NULL DEFAULT 40,
  total_points INTEGER NOT NULL DEFAULT 100,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE exam_questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_id UUID REFERENCES exams(id) ON DELETE CASCADE,
  question_order INTEGER NOT NULL,
  concept_tag TEXT NOT NULL,
  prompt TEXT NOT NULL,
  choices JSONB NOT NULL,
  correct_choice TEXT NOT NULL,
  explanation TEXT,
  difficulty TEXT NOT NULL DEFAULT 'medium' CHECK (difficulty IN ('easy', 'medium', 'hard')),
  points INTEGER NOT NULL DEFAULT 10,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(exam_id, question_order)
);

CREATE TABLE exam_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_id UUID REFERENCES exams(id) ON DELETE CASCADE,
  course_id UUID REFERENCES courses(id) ON DELETE CASCADE,
  student_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  attempt_number INTEGER NOT NULL DEFAULT 1,
  score INTEGER NOT NULL DEFAULT 0,
  max_score INTEGER NOT NULL DEFAULT 0,
  duration_minutes INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted', 'graded')),
  submitted_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE exam_answers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id UUID REFERENCES exam_attempts(id) ON DELETE CASCADE,
  question_id UUID REFERENCES exam_questions(id) ON DELETE CASCADE,
  concept_tag TEXT NOT NULL,
  selected_choice TEXT,
  is_correct BOOLEAN NOT NULL DEFAULT FALSE,
  tutor_prompt TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(attempt_id, question_id)
);

CREATE INDEX idx_exams_course_date
  ON exams(course_id, exam_date DESC);

CREATE INDEX idx_exam_questions_exam_order
  ON exam_questions(exam_id, question_order);

CREATE INDEX idx_exam_attempts_course_student_submitted
  ON exam_attempts(course_id, student_id, submitted_at DESC);

CREATE INDEX idx_exam_answers_attempt
  ON exam_answers(attempt_id);

ALTER TABLE exams ENABLE ROW LEVEL SECURITY;
ALTER TABLE exam_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE exam_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE exam_answers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Teacher views class exams" ON exams
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM courses WHERE courses.id = course_id AND courses.teacher_id = auth.uid())
  );

CREATE POLICY "Student views enrolled exams" ON exams
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM enrollments WHERE enrollments.course_id = course_id AND enrollments.student_id = auth.uid())
  );

CREATE POLICY "Teacher views class exam questions" ON exam_questions
  FOR SELECT USING (
    EXISTS (
      SELECT 1
      FROM exams
      JOIN courses ON courses.id = exams.course_id
      WHERE exams.id = exam_id
        AND courses.teacher_id = auth.uid()
    )
  );

CREATE POLICY "Student views enrolled exam questions" ON exam_questions
  FOR SELECT USING (
    EXISTS (
      SELECT 1
      FROM exams
      JOIN enrollments ON enrollments.course_id = exams.course_id
      WHERE exams.id = exam_id
        AND enrollments.student_id = auth.uid()
    )
  );

CREATE POLICY "Teacher views class exam attempts" ON exam_attempts
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM courses WHERE courses.id = course_id AND courses.teacher_id = auth.uid())
  );

CREATE POLICY "Student views own exam attempts" ON exam_attempts
  FOR SELECT USING (auth.uid() = student_id);

CREATE POLICY "Teacher views class exam answers" ON exam_answers
  FOR SELECT USING (
    EXISTS (
      SELECT 1
      FROM exam_attempts
      JOIN courses ON courses.id = exam_attempts.course_id
      WHERE exam_attempts.id = attempt_id
        AND courses.teacher_id = auth.uid()
    )
  );

CREATE POLICY "Student views own exam answers" ON exam_answers
  FOR SELECT USING (
    EXISTS (
      SELECT 1
      FROM exam_attempts
      WHERE exam_attempts.id = attempt_id
        AND exam_attempts.student_id = auth.uid()
    )
  );
