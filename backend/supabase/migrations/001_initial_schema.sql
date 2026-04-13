-- 유저 프로필 (교사/학생 역할 포함)
CREATE TABLE profiles (
  id UUID REFERENCES auth.users(id) PRIMARY KEY,
  email TEXT NOT NULL,
  full_name TEXT,
  role TEXT NOT NULL CHECK (role IN ('teacher', 'student')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 수업 (교사가 생성)
CREATE TABLE courses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id UUID REFERENCES profiles(id),
  title TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 수업-학생 연결
CREATE TABLE enrollments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id UUID REFERENCES courses(id),
  student_id UUID REFERENCES profiles(id),
  enrolled_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(course_id, student_id)
);

-- 강의 자료 (업로드된 파일)
CREATE TABLE materials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id UUID REFERENCES courses(id),
  file_name TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  indexed BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 튜터 세션 로그
CREATE TABLE tutor_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID REFERENCES profiles(id),
  course_id UUID REFERENCES courses(id),
  concept_tag TEXT,
  stuck_count INTEGER DEFAULT 0,
  resolved BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 개념별 이해도 집계
CREATE TABLE concept_stats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id UUID REFERENCES courses(id),
  student_id UUID REFERENCES profiles(id),
  concept TEXT NOT NULL,
  stuck_count INTEGER DEFAULT 0,
  resolved_count INTEGER DEFAULT 0,
  last_updated TIMESTAMPTZ DEFAULT NOW()
);

-- RLS 활성화
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE courses ENABLE ROW LEVEL SECURITY;
ALTER TABLE enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE materials ENABLE ROW LEVEL SECURITY;
ALTER TABLE tutor_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE concept_stats ENABLE ROW LEVEL SECURITY;

-- 유저는 자신의 프로필만 조회
CREATE POLICY "Own profile" ON profiles FOR ALL USING (auth.uid() = id);

-- 교사는 자신의 수업만 관리
CREATE POLICY "Teacher manages courses" ON courses
  FOR ALL USING (auth.uid() = teacher_id);

-- 학생은 자신의 enrollment 조회
CREATE POLICY "Student views own enrollments" ON enrollments
  FOR SELECT USING (auth.uid() = student_id);

-- 교사는 자신의 수업 enrollment 조회
CREATE POLICY "Teacher views course enrollments" ON enrollments
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM courses WHERE id = course_id AND teacher_id = auth.uid())
  );

-- 학생은 수강 중인 수업 조회
CREATE POLICY "Student views enrolled courses" ON courses
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM enrollments
      WHERE enrollments.course_id = courses.id
        AND enrollments.student_id = auth.uid()
    )
  );

-- 학생은 자신의 튜터 세션만 조회
CREATE POLICY "Own tutor sessions" ON tutor_sessions
  FOR ALL USING (auth.uid() = student_id);

-- 학생은 자신의 concept_stats만 조회
CREATE POLICY "Own concept stats" ON concept_stats
  FOR ALL USING (auth.uid() = student_id);

-- 교사는 자신의 수업 concept_stats 조회
CREATE POLICY "Teacher views class stats" ON concept_stats
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM courses WHERE id = course_id AND teacher_id = auth.uid())
  );
