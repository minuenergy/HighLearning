ALTER TABLE exams
  DROP CONSTRAINT IF EXISTS exams_workflow_status_check;

ALTER TABLE exams
  ADD CONSTRAINT exams_workflow_status_check
  CHECK (workflow_status IN ('draft', 'reviewed', 'scheduled', 'published', 'archived'));

CREATE TABLE IF NOT EXISTS textbooks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  book_title TEXT,
  subject_label TEXT,
  viewer_url TEXT,
  short_url TEXT,
  local_pdf_path TEXT,
  page_count INTEGER NOT NULL DEFAULT 0,
  source_type TEXT NOT NULL DEFAULT 'filesystem'
    CHECK (source_type IN ('filesystem', 'upload', 'external')),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS textbook_toc_nodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  textbook_id UUID NOT NULL REFERENCES textbooks(id) ON DELETE CASCADE,
  parent_id UUID REFERENCES textbook_toc_nodes(id) ON DELETE CASCADE,
  depth INTEGER NOT NULL DEFAULT 1,
  node_order INTEGER NOT NULL DEFAULT 1,
  title TEXT NOT NULL,
  slug TEXT NOT NULL,
  page_start INTEGER,
  page_end INTEGER,
  learning_objective TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(textbook_id, slug)
);

CREATE TABLE IF NOT EXISTS textbook_pages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  textbook_id UUID NOT NULL REFERENCES textbooks(id) ON DELETE CASCADE,
  page_number INTEGER NOT NULL,
  page_label TEXT,
  image_path TEXT,
  text_path TEXT,
  text_preview TEXT,
  text_content TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(textbook_id, page_number)
);

CREATE TABLE IF NOT EXISTS textbook_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  textbook_id UUID NOT NULL REFERENCES textbooks(id) ON DELETE CASCADE,
  page_id UUID REFERENCES textbook_pages(id) ON DELETE CASCADE,
  toc_node_id UUID REFERENCES textbook_toc_nodes(id) ON DELETE SET NULL,
  chunk_order INTEGER NOT NULL DEFAULT 1,
  content TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE exams
  ADD COLUMN IF NOT EXISTS textbook_id UUID REFERENCES textbooks(id) ON DELETE SET NULL;

ALTER TABLE exams
  ADD COLUMN IF NOT EXISTS textbook_toc_node_id UUID REFERENCES textbook_toc_nodes(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_textbooks_subject_slug
  ON textbooks(subject_label, slug);

CREATE INDEX IF NOT EXISTS idx_textbook_toc_nodes_textbook_order
  ON textbook_toc_nodes(textbook_id, node_order);

CREATE INDEX IF NOT EXISTS idx_textbook_pages_textbook_page
  ON textbook_pages(textbook_id, page_number);

CREATE INDEX IF NOT EXISTS idx_textbook_chunks_textbook_toc
  ON textbook_chunks(textbook_id, toc_node_id, page_id);

CREATE INDEX IF NOT EXISTS idx_exams_textbook_scope
  ON exams(textbook_id, textbook_toc_node_id);

ALTER TABLE textbooks ENABLE ROW LEVEL SECURITY;
ALTER TABLE textbook_toc_nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE textbook_pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE textbook_chunks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view textbooks" ON textbooks
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can view textbook toc nodes" ON textbook_toc_nodes
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can view textbook pages" ON textbook_pages
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can view textbook chunks" ON textbook_chunks
  FOR SELECT USING (auth.role() = 'authenticated');
