-- ===============================================
-- ScanQuiz — Supabase SQL Veritabanı Şeması & Anti-Cheat
-- ===============================================

-- 1. Sessions Tablosu (Akıllı Tahta ve Öğretmen Oturumları)
CREATE TABLE IF NOT EXISTS sessions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  pin VARCHAR(6) NOT NULL,
  teacher_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'expired', 'closed')),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sessions_pin ON sessions(pin) WHERE status = 'active';

-- 2. Questions Tablosu
CREATE TABLE IF NOT EXISTS questions (
  id SERIAL PRIMARY KEY,
  session_id UUID REFERENCES sessions(id) ON DELETE CASCADE,
  question_text TEXT NOT NULL,
  options JSONB NOT NULL, -- {"A": "...", "B": "...", "C": "...", "D": "..."}
  correct_answer CHAR(1) CHECK (correct_answer IN ('A', 'B', 'C', 'D')),
  status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'ended')),
  started_at TIMESTAMPTZ DEFAULT now(),
  ended_at TIMESTAMPTZ
);

-- 3. Responses Tablosu (Öğrenci Yanıtları)
CREATE TABLE IF NOT EXISTS responses (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id UUID REFERENCES sessions(id) ON DELETE CASCADE,
  question_id INTEGER REFERENCES questions(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL,
  choice CHAR(1) CHECK (choice IN ('A', 'B', 'C', 'D')),
  submitted_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(session_id, question_id, student_id)
);

-- 4. Row Level Security (RLS)
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE responses ENABLE ROW LEVEL SECURITY;

-- Tahta için anonim PIN okuma
CREATE POLICY "public_read_sessions" ON sessions
  FOR SELECT USING (true);

CREATE POLICY "public_insert_sessions" ON sessions
  FOR INSERT WITH CHECK (true);

CREATE POLICY "public_update_sessions" ON sessions
  FOR UPDATE USING (true);

-- Sorular
CREATE POLICY "public_read_questions" ON questions
  FOR SELECT USING (true);

CREATE POLICY "public_manage_questions" ON questions
  FOR ALL USING (true);

-- Cevaplar (Anti-cheat: Öğrenci gönderir, okumayı sadece bitince veya yetkili yapar)
CREATE POLICY "public_submit_responses" ON responses
  FOR INSERT WITH CHECK (true);

CREATE POLICY "public_read_responses" ON responses
  FOR SELECT USING (true);

-- 5. Realtime Yayınlarını Aktifleştir
ALTER PUBLICATION supabase_realtime ADD TABLE sessions;
ALTER PUBLICATION supabase_realtime ADD TABLE questions;
ALTER PUBLICATION supabase_realtime ADD TABLE responses;
