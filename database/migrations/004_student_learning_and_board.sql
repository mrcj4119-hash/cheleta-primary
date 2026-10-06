CREATE TABLE users_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('ADMIN', 'TEACHER', 'PARENT', 'CSR_PARTNER', 'STUDENT', 'BOARD', 'STAFF')),
  teacher_id INTEGER REFERENCES teachers(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO users_new (id, name, email, password_hash, role, teacher_id, created_at)
SELECT id, name, email, password_hash, role, teacher_id, created_at FROM users;

DROP TABLE users;
ALTER TABLE users_new RENAME TO users;
CREATE INDEX IF NOT EXISTS idx_users_role_status ON users(role, status);

CREATE TABLE learning_resources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL CHECK (category IN ('SUBJECT_NOTES', 'CAREER_READINESS', 'CODING_BOOTCAMP')),
  subject TEXT NOT NULL,
  grade INTEGER CHECK (grade BETWEEN 1 AND 9),
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (category, subject, grade, title)
);

CREATE TABLE revision_questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  resource_id INTEGER NOT NULL REFERENCES learning_resources(id) ON DELETE CASCADE,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE mentorship_programs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  mentor TEXT NOT NULL,
  grade INTEGER CHECK (grade BETWEEN 1 AND 9),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE mentorship_enrollments (
  program_id INTEGER NOT NULL REFERENCES mentorship_programs(id) ON DELETE CASCADE,
  learner_id INTEGER NOT NULL REFERENCES learners(id) ON DELETE CASCADE,
  enrolled_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (program_id, learner_id)
);

CREATE TABLE student_suggestions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  learner_id INTEGER NOT NULL REFERENCES learners(id) ON DELETE CASCADE,
  subject TEXT NOT NULL,
  suggestion TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'NEW' CHECK (status IN ('NEW', 'IN_REVIEW', 'RESOLVED')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_learning_resources_grade_category ON learning_resources(grade, category);
CREATE UNIQUE INDEX IF NOT EXISTS idx_learning_resource_unique
  ON learning_resources(category, subject, COALESCE(grade, 0), title);
CREATE INDEX IF NOT EXISTS idx_revision_questions_resource ON revision_questions(resource_id, position);
CREATE INDEX IF NOT EXISTS idx_mentorship_status_grade ON mentorship_programs(status, grade);
CREATE INDEX IF NOT EXISTS idx_mentorship_enrollments_learner ON mentorship_enrollments(learner_id);
CREATE INDEX IF NOT EXISTS idx_student_suggestions_created ON student_suggestions(created_at);
