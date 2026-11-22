CREATE TABLE study_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  form_id TEXT NOT NULL,
  corpus_version TEXT NOT NULL,
  started_at TEXT NOT NULL
);

CREATE INDEX study_sessions_user_started ON study_sessions(user_id, started_at DESC);

CREATE TABLE attempts (
  session_id TEXT NOT NULL REFERENCES study_sessions(id),
  position INTEGER NOT NULL CHECK (position > 0),
  item_id TEXT NOT NULL,
  item_group TEXT NOT NULL,
  category TEXT NOT NULL,
  choice TEXT NOT NULL CHECK (choice IN ('ア', 'イ', 'ウ', 'エ')),
  confidence TEXT CHECK (confidence IN ('sure', 'unsure')),
  correct INTEGER NOT NULL CHECK (correct IN (0, 1)),
  client_attempt_id TEXT NOT NULL,
  answered_at TEXT NOT NULL,
  PRIMARY KEY (session_id, position),
  UNIQUE (session_id, client_attempt_id)
);

CREATE INDEX attempts_answered ON attempts(answered_at DESC, session_id);

CREATE TABLE review_marks (
  user_id TEXT NOT NULL,
  item_group TEXT NOT NULL,
  PRIMARY KEY (user_id, item_group)
);
