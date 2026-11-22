CREATE TABLE ai_requests (
  user_id TEXT NOT NULL,
  id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  payload_hash TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt_version INTEGER NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('pending', 'complete', 'failed')),
  started_at INTEGER NOT NULL,
  lease_until INTEGER NOT NULL,
  day TEXT NOT NULL,
  month TEXT NOT NULL,
  reserved_micros INTEGER NOT NULL CHECK (reserved_micros >= 0),
  charged_micros INTEGER CHECK (charged_micros >= 0),
  input_tokens INTEGER CHECK (input_tokens >= 0),
  output_tokens INTEGER CHECK (output_tokens >= 0),
  finished_at INTEGER,
  question TEXT,
  answer TEXT,
  PRIMARY KEY (user_id, id)
);

CREATE INDEX ai_requests_by_user_day ON ai_requests(user_id, day);
CREATE INDEX ai_requests_by_user_state ON ai_requests(user_id, state, lease_until);
CREATE INDEX ai_requests_by_month ON ai_requests(month);
CREATE INDEX ai_requests_by_thread ON ai_requests(user_id, session_id, position, finished_at DESC)
  WHERE question IS NOT NULL;
