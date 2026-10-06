CREATE TABLE learners_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  grade INTEGER NOT NULL CHECK (grade BETWEEN 1 AND 9),
  class_name TEXT NOT NULL,
  stream TEXT NOT NULL DEFAULT 'A',
  support TEXT NOT NULL DEFAULT 'On track',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE'))
);

INSERT INTO learners_new (id, first_name, last_name, grade, class_name, stream, support, created_at, status)
SELECT id, first_name, last_name, grade, class_name, stream, support, created_at, status FROM learners;

DROP TABLE learners;
ALTER TABLE learners_new RENAME TO learners;

CREATE INDEX IF NOT EXISTS idx_learners_class ON learners(class_name);
CREATE INDEX IF NOT EXISTS idx_learners_status ON learners(status);

CREATE TABLE IF NOT EXISTS classes (
  class_name TEXT PRIMARY KEY,
  grade INTEGER NOT NULL CHECK (grade BETWEEN 1 AND 9),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO classes (class_name, grade)
SELECT DISTINCT class_name, grade FROM learners;

INSERT OR IGNORE INTO classes (class_name, grade) VALUES ('Grade 9A', 9);

CREATE TABLE IF NOT EXISTS parent_comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  parent_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  learner_id INTEGER NOT NULL REFERENCES learners(id) ON DELETE CASCADE,
  comment TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (parent_id, learner_id)
);

CREATE INDEX IF NOT EXISTS idx_parent_comments_learner ON parent_comments(learner_id, created_at);

UPDATE assessments
SET comment = TRIM(SUBSTR(comment, LENGTH('Demo data: ') + 1))
WHERE comment LIKE 'Demo data: %';

UPDATE users SET name = 'Parent Account'
WHERE email = 'parent@cheleta.test' COLLATE NOCASE AND name = 'Parent Demo';
