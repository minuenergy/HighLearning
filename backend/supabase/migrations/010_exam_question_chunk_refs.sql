ALTER TABLE exam_questions
  ADD COLUMN IF NOT EXISTS source_chunk_ids UUID[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_exam_questions_source_chunk_ids
  ON exam_questions
  USING GIN (source_chunk_ids);
