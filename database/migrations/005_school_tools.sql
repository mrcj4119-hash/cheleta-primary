ALTER TABLE users ADD COLUMN phone TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN sms_opt_in INTEGER NOT NULL DEFAULT 0 CHECK (sms_opt_in IN (0, 1));

CREATE TABLE IF NOT EXISTS timetable_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  class_name TEXT NOT NULL REFERENCES classes(class_name) ON UPDATE CASCADE ON DELETE RESTRICT,
  teacher_id INTEGER NOT NULL REFERENCES teachers(id) ON DELETE RESTRICT,
  day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 1 AND 5),
  start_time TEXT NOT NULL CHECK (start_time GLOB '[0-2][0-9]:[0-5][0-9]'),
  end_time TEXT NOT NULL CHECK (end_time GLOB '[0-2][0-9]:[0-5][0-9]'),
  subject TEXT NOT NULL,
  room TEXT NOT NULL DEFAULT '',
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (start_time < end_time),
  UNIQUE (class_name, day_of_week, start_time),
  UNIQUE (teacher_id, day_of_week, start_time)
);

CREATE TABLE IF NOT EXISTS lesson_plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  class_name TEXT NOT NULL REFERENCES classes(class_name) ON UPDATE CASCADE ON DELETE RESTRICT,
  teacher_id INTEGER NOT NULL REFERENCES teachers(id) ON DELETE RESTRICT,
  lesson_date TEXT NOT NULL,
  subject TEXT NOT NULL,
  title TEXT NOT NULL,
  objectives TEXT NOT NULL DEFAULT '',
  plan TEXT NOT NULL DEFAULT '',
  progress_status TEXT NOT NULL DEFAULT 'PLANNED'
    CHECK (progress_status IN ('PLANNED', 'IN_PROGRESS', 'COMPLETED')),
  progress_note TEXT NOT NULL DEFAULT '',
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS report_comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  learner_id INTEGER NOT NULL REFERENCES learners(id) ON DELETE CASCADE,
  term TEXT NOT NULL,
  teacher_id INTEGER NOT NULL REFERENCES teachers(id),
  comment TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (learner_id, term)
);

CREATE TABLE IF NOT EXISTS school_announcements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'Normal' CHECK (priority IN ('Low', 'Normal', 'High')),
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  read_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sms_deliveries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  notification_id INTEGER NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  recipient TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'AFRICAS_TALKING',
  status TEXT NOT NULL CHECK (status IN ('NOT_CONFIGURED', 'SENT', 'FAILED')),
  provider_reference TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS wellbeing_cases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  learner_id INTEGER NOT NULL REFERENCES learners(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  concern TEXT NOT NULL,
  follow_up TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'OPEN'
    CHECK (status IN ('OPEN', 'FOLLOW_UP', 'RESOLVED')),
  created_by INTEGER NOT NULL REFERENCES users(id),
  updated_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS inventory_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('BOOK', 'SUPPLY', 'EQUIPMENT')),
  identifier TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT '',
  quantity INTEGER NOT NULL CHECK (quantity >= 0),
  available_count INTEGER NOT NULL CHECK (available_count >= 0 AND available_count <= quantity),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS library_loans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  inventory_item_id INTEGER NOT NULL REFERENCES inventory_items(id) ON DELETE RESTRICT,
  learner_id INTEGER NOT NULL REFERENCES learners(id) ON DELETE RESTRICT,
  checked_out_by INTEGER NOT NULL REFERENCES users(id),
  checkout_date TEXT NOT NULL,
  due_date TEXT NOT NULL,
  returned_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (due_date >= checkout_date)
);

CREATE INDEX IF NOT EXISTS idx_timetable_class_day ON timetable_entries(class_name, day_of_week, start_time);
CREATE INDEX IF NOT EXISTS idx_timetable_teacher_day ON timetable_entries(teacher_id, day_of_week, start_time);
CREATE INDEX IF NOT EXISTS idx_lesson_plans_class_date ON lesson_plans(class_name, lesson_date);
CREATE INDEX IF NOT EXISTS idx_report_comments_learner_term ON report_comments(learner_id, term);
CREATE INDEX IF NOT EXISTS idx_notifications_user_date ON notifications(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sms_deliveries_status ON sms_deliveries(status, created_at);
CREATE INDEX IF NOT EXISTS idx_wellbeing_learner_date ON wellbeing_cases(learner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inventory_category_status ON inventory_items(category, status);
CREATE INDEX IF NOT EXISTS idx_library_loans_learner ON library_loans(learner_id, returned_at, due_date);
