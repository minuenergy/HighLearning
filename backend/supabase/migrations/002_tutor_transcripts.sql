CREATE TABLE tutor_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  course_id UUID REFERENCES courses(id) ON DELETE CASCADE,
  concept_tag TEXT NOT NULL,
  school_level TEXT,
  summary TEXT,
  stuck_count INTEGER DEFAULT 0,
  resolved BOOLEAN DEFAULT FALSE,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  ended_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE tutor_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID REFERENCES tutor_conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('system', 'user', 'assistant')),
  content TEXT NOT NULL,
  message_order INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(conversation_id, message_order)
);

CREATE INDEX idx_tutor_conversations_course_student_started
  ON tutor_conversations(course_id, student_id, started_at DESC);

CREATE INDEX idx_tutor_conversations_student_started
  ON tutor_conversations(student_id, started_at DESC);

CREATE INDEX idx_tutor_messages_conversation_order
  ON tutor_messages(conversation_id, message_order);

ALTER TABLE tutor_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE tutor_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Own tutor conversations" ON tutor_conversations
  FOR SELECT USING (auth.uid() = student_id);

CREATE POLICY "Teacher views class conversations" ON tutor_conversations
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM courses WHERE id = course_id AND teacher_id = auth.uid())
  );

CREATE POLICY "Own tutor messages" ON tutor_messages
  FOR SELECT USING (
    EXISTS (
      SELECT 1
      FROM tutor_conversations
      WHERE tutor_conversations.id = conversation_id
        AND tutor_conversations.student_id = auth.uid()
    )
  );

CREATE POLICY "Teacher views class messages" ON tutor_messages
  FOR SELECT USING (
    EXISTS (
      SELECT 1
      FROM tutor_conversations
      JOIN courses ON courses.id = tutor_conversations.course_id
      WHERE tutor_conversations.id = conversation_id
        AND courses.teacher_id = auth.uid()
    )
  );
