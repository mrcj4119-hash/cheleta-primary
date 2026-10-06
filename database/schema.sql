PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS teachers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  phone TEXT,
  qualification TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS learners (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  grade INTEGER NOT NULL CHECK (grade BETWEEN 1 AND 9),
  class_name TEXT NOT NULL,
  stream TEXT NOT NULL DEFAULT 'A',
  support TEXT NOT NULL DEFAULT 'On track',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('ADMIN', 'TEACHER', 'PARENT', 'CSR_PARTNER')),
  teacher_id INTEGER REFERENCES teachers(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_learners (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  learner_id INTEGER NOT NULL REFERENCES learners(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, learner_id)
);

CREATE TABLE IF NOT EXISTS teacher_classes (
  teacher_id INTEGER NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  class_name TEXT NOT NULL,
  PRIMARY KEY (teacher_id, class_name)
);

CREATE TABLE IF NOT EXISTS classes (
  class_name TEXT PRIMARY KEY,
  grade INTEGER NOT NULL CHECK (grade BETWEEN 1 AND 9),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS parent_comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  parent_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  learner_id INTEGER NOT NULL REFERENCES learners(id) ON DELETE CASCADE,
  comment TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (parent_id, learner_id)
);

CREATE TABLE IF NOT EXISTS assessments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  learner_id INTEGER NOT NULL REFERENCES learners(id) ON DELETE CASCADE,
  subject TEXT NOT NULL,
  strand TEXT NOT NULL,
  sub_strand TEXT NOT NULL,
  competency TEXT NOT NULL,
  level TEXT NOT NULL CHECK (level IN ('EE', 'ME', 'AE', 'BE')),
  teacher_id INTEGER NOT NULL REFERENCES teachers(id),
  term TEXT NOT NULL,
  assessment_date TEXT NOT NULL,
  comment TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS attendance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  learner_id INTEGER NOT NULL REFERENCES learners(id) ON DELETE CASCADE,
  class_name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PRESENT', 'ABSENT', 'LATE', 'EXCUSED')),
  attendance_date TEXT NOT NULL,
  client_record_id TEXT NOT NULL UNIQUE,
  recorded_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (learner_id, attendance_date)
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  resource TEXT NOT NULL,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_learners_class ON learners(class_name);
CREATE INDEX IF NOT EXISTS idx_assessments_learner ON assessments(learner_id, assessment_date);
CREATE INDEX IF NOT EXISTS idx_assessments_term_subject ON assessments(term, subject);
CREATE INDEX IF NOT EXISTS idx_attendance_date_class ON attendance(attendance_date, class_name);
CREATE INDEX IF NOT EXISTS idx_attendance_learner ON attendance(learner_id, attendance_date);
CREATE INDEX IF NOT EXISTS idx_parent_comments_learner ON parent_comments(learner_id, created_at);
