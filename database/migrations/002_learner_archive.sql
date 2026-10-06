ALTER TABLE learners
  ADD COLUMN status TEXT NOT NULL DEFAULT 'ACTIVE'
  CHECK (status IN ('ACTIVE', 'INACTIVE'));

CREATE INDEX IF NOT EXISTS idx_learners_status ON learners(status);
