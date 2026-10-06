import express from 'express';
import cors from 'cors';
import {
  createHmac,
  randomUUID,
  timingSafeEqual
} from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { db, hashPassword, verifyPassword } from './database.js';

const app = express();
const port = Number(process.env.PORT || 3001);
const tokenSecret = process.env.JWT_SECRET || 'local-demo-secret-change-before-deploy';
const tokenLifetimeSeconds = 60 * 60 * 8;
const roles = new Set(['ADMIN', 'TEACHER', 'PARENT', 'CSR_PARTNER', 'STUDENT', 'BOARD', 'STAFF']);
const attendanceStatuses = new Set(['PRESENT', 'ABSENT', 'LATE', 'EXCUSED']);
const rubricLevels = new Set(['EE', 'ME', 'AE', 'BE']);
const announcements = [
  { id: 1, title: 'School assembly', message: 'Assembly will be held on Tuesday at 8:00 a.m. with a focus on reading week.', priority: 'High' },
  { id: 2, title: 'Parent meeting', message: 'Grade 5 families are invited to discuss learner progress.', priority: 'Medium' },
  { id: 3, title: 'Library access', message: 'Approved reading resources are available in the digital library.', priority: 'Low' }
];
const resources = [
  { id: 1, title: 'CBC literacy pack', subject: 'English', type: 'PDF' },
  { id: 2, title: 'Numeracy practice worksheets', subject: 'Mathematics', type: 'Worksheet' },
  { id: 3, title: 'Life skills poster set', subject: 'Life Skills', type: 'Image' },
  { id: 4, title: 'Community story prompts', subject: 'Creativity', type: 'Guide' }
];
const notifications = [
  { id: 1, type: 'ANNOUNCEMENT', title: 'Parent meeting', message: 'Grade 5 meeting on Saturday at 9:00 a.m.', read: false },
  { id: 2, type: 'ABSENCE_ALERT', title: 'Attendance follow-up', message: 'Attendance records are ready for review.', read: true }
];

if (process.env.NODE_ENV === 'production'
  && (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32 || process.env.JWT_SECRET.startsWith('replace-with-'))) {
  throw new Error('Set JWT_SECRET to a random value of at least 32 characters in production.');
}
if (process.env.NODE_ENV === 'production' && !process.env.CLIENT_URL) {
  throw new Error('CLIENT_URL must be configured in production.');
}

app.use(cors({
  origin: process.env.CLIENT_URL || 'http://localhost:4321',
  credentials: false
}));
app.use(express.json({ limit: '64kb' }));

function send(res, status, data, message) {
  return res.status(status).json({
    success: status < 400,
    data: status < 400 ? data : null,
    message
  });
}

function createToken(user) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    sub: user.id,
    role: user.role,
    exp: Math.floor(Date.now() / 1000) + tokenLifetimeSeconds
  })).toString('base64url');
  const signingInput = `${header}.${payload}`;
  const signature = createHmac('sha256', tokenSecret).update(signingInput).digest('base64url');
  return `${signingInput}.${signature}`;
}

function verifyToken(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return null;

  const [header, payload, providedSignature] = parts;
  const signingInput = `${header}.${payload}`;
  const expectedSignature = createHmac('sha256', tokenSecret).update(signingInput).digest();
  let receivedSignature;
  let claims;

  try {
    receivedSignature = Buffer.from(providedSignature, 'base64url');
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }

  if (receivedSignature.length !== expectedSignature.length
    || !timingSafeEqual(receivedSignature, expectedSignature)
    || !Number.isInteger(claims.sub)
    || !roles.has(claims.role)
    || !Number.isInteger(claims.exp)
    || claims.exp <= Math.floor(Date.now() / 1000)) {
    return null;
  }

  return claims;
}

function authenticate(req, res, next) {
  const match = /^Bearer\s+(.+)$/i.exec(req.get('authorization') || '');
  const claims = match && verifyToken(match[1]);
  if (!claims) return send(res, 401, null, 'Authentication is required or the token has expired.');

  const user = db.prepare(
    `SELECT u.id, u.name, u.email, u.role, u.teacher_id AS teacherId, u.status AS accountStatus,
      t.status AS teacherStatus
     FROM users u LEFT JOIN teachers t ON t.id = u.teacher_id WHERE u.id = ?`
  ).get(claims.sub);

  if (!user || user.role !== claims.role || user.accountStatus !== 'ACTIVE' || user.teacherStatus === 'INACTIVE') {
    return send(res, 401, null, 'Authentication is required or the token has expired.');
  }

  req.user = user;
  next();
}

function allowRoles(...allowedRoles) {
  return (req, res, next) => {
    if (!allowedRoles.includes(req.user.role)) {
      return send(res, 403, null, 'You do not have permission to perform this action.');
    }
    next();
  };
}

function audit(userId, action, resource, metadata = {}) {
  db.prepare(
    'INSERT INTO audit_logs (user_id, action, resource, metadata) VALUES (?, ?, ?, ?)'
  ).run(userId, action, resource, JSON.stringify(metadata));
}

function validDate(value) {
  return typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
    && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}

function cleanText(value, maxLength = 160) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function learnerForRole(learnerId, user) {
  if (user.role === 'PARENT' || user.role === 'STUDENT') {
    return db.prepare(
      `SELECT l.id, l.first_name AS firstName, l.last_name AS lastName, l.grade,
              l.class_name AS className, l.stream, l.support, l.status
       FROM learners l JOIN user_learners ul ON ul.learner_id = l.id
       WHERE l.id = ? AND ul.user_id = ?`
    ).get(learnerId, user.id);
  }

  const learner = db.prepare(
    `SELECT id, first_name AS firstName, last_name AS lastName, grade,
            class_name AS className, stream, support, status
     FROM learners WHERE id = ?`
  ).get(learnerId);

  if (learner?.status !== 'ACTIVE') return null;

  if (learner && user.role === 'TEACHER') {
    const assigned = db.prepare(
      'SELECT 1 FROM teacher_classes WHERE teacher_id = ? AND class_name = ?'
    ).get(user.teacherId, learner.className);
    return assigned ? learner : null;
  }

  return learner;
}

function requireAssignedClass(user, className) {
  if (user.role !== 'TEACHER') return true;
  return Boolean(db.prepare(
    'SELECT 1 FROM teacher_classes WHERE teacher_id = ? AND class_name = ?'
  ).get(user.teacherId, className));
}

function classMatchesGrade(className, grade) {
  return Boolean(db.prepare(
    'SELECT 1 FROM classes WHERE class_name = ? AND grade = ?'
  ).get(className, grade));
}

function learnersForUser(user) {
  const query = `
    SELECT l.id, l.first_name AS firstName, l.last_name AS lastName, l.grade,
      l.class_name AS className, l.stream, l.support, l.status,
      COALESCE(ROUND(100.0 * SUM(CASE WHEN a.status IN ('PRESENT', 'LATE') THEN 1 ELSE 0 END)
        / NULLIF(COUNT(a.id), 0), 0), 0) AS attendance
    FROM learners l
    LEFT JOIN attendance a ON a.learner_id = l.id
    WHERE (? NOT IN ('PARENT', 'STUDENT') OR EXISTS (
      SELECT 1 FROM user_learners ul WHERE ul.learner_id = l.id AND ul.user_id = ?
    ))
      AND (? != 'TEACHER' OR EXISTS (
        SELECT 1 FROM teacher_classes tc WHERE tc.teacher_id = ? AND tc.class_name = l.class_name
      ))
      AND (? = 'ADMIN' OR l.status = 'ACTIVE')
    GROUP BY l.id
    ORDER BY l.grade, l.class_name, l.last_name, l.first_name`;
  return db.prepare(query).all(
    user.role, user.id, user.role, user.teacherId || -1, user.role
  ).map((row) => ({ ...row, name: `${row.firstName} ${row.lastName}` }));
}

app.get('/api/health', (req, res) => send(
  res, 200, { status: 'ok', service: 'Cheleta SMS API', storage: 'sqlite' }, 'API is running'
));

app.post('/api/login', (req, res) => {
  const email = cleanText(req.body?.email, 254).toLowerCase();
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  const role = cleanText(req.body?.role, 30).toUpperCase();

  if (!email || !password || !roles.has(role)) {
    return send(res, 400, null, 'Enter a valid email, password, and role.');
  }

  const user = db.prepare(
    `SELECT u.id, u.name, u.email, u.role, u.teacher_id AS teacherId,
      u.password_hash AS passwordHash, u.status AS accountStatus, t.status AS teacherStatus
     FROM users u LEFT JOIN teachers t ON t.id = u.teacher_id
     WHERE u.email = ? COLLATE NOCASE`
  ).get(email);

  if (!user || user.role !== role || user.accountStatus !== 'ACTIVE' || user.teacherStatus === 'INACTIVE'
    || !verifyPassword(password, user.passwordHash)) {
    return send(res, 401, null, 'Invalid email, password, or role.');
  }

  audit(user.id, 'LOGIN', 'user');
  const { passwordHash, ...safeUser } = user;
  return send(res, 200, { token: createToken(safeUser), user: safeUser }, 'Login successful');
});

app.get('/api/me', authenticate, (req, res) => send(
  res, 200, { user: req.user }, 'Current user loaded'
));

app.get('/api/dashboard', authenticate, (req, res) => {
  const user = req.user;
  const learnerRows = user.role === 'CSR_PARTNER' ? [] : learnersForUser(user);
  const attendanceSummary = db.prepare(
    `SELECT COUNT(*) AS total,
      SUM(CASE WHEN status IN ('PRESENT', 'LATE') THEN 1 ELSE 0 END) AS present
     FROM attendance`
  ).get();
  const totals = {
    learners: db.prepare("SELECT COUNT(*) AS count FROM learners WHERE status = 'ACTIVE'").get().count,
    teachers: db.prepare("SELECT COUNT(*) AS count FROM teachers WHERE status = 'ACTIVE'").get().count,
    attendance: attendanceSummary.total
      ? Math.round(100 * attendanceSummary.present / attendanceSummary.total)
      : 0,
    assessments: db.prepare('SELECT COUNT(*) AS count FROM assessments').get().count
  };

  const summaries = {
    ADMIN: [
      { label: 'Learners', value: totals.learners, meta: 'Active learner profiles' },
      { label: 'Teachers', value: totals.teachers, meta: 'Active staff profiles' },
      { label: 'Attendance', value: `${totals.attendance}%`, meta: 'Recorded attendance' },
      { label: 'Assessments', value: totals.assessments, meta: 'Saved CBC records' }
    ],
    TEACHER: [
      { label: 'Assigned learners', value: learnerRows.length, meta: 'In assigned classes' },
      { label: 'Assigned classes', value: db.prepare(
        'SELECT COUNT(*) AS count FROM teacher_classes WHERE teacher_id = ?'
      ).get(user.teacherId).count, meta: 'Current assignments' },
      { label: 'Attendance', value: `${totals.attendance}%`, meta: 'Recorded school attendance' },
      { label: 'Assessments', value: totals.assessments, meta: 'Saved CBC records' }
    ],
    PARENT: [
      { label: 'Linked learners', value: learnerRows.length, meta: 'Only your linked learner records' },
      { label: 'Attendance', value: learnerRows.length ? `${learnerRows[0].attendance}%` : '—', meta: 'Recorded attendance' },
      { label: 'Assessments', value: db.prepare(
        `SELECT COUNT(*) AS count FROM assessments a JOIN user_learners ul ON ul.learner_id = a.learner_id
         WHERE ul.user_id = ?`
      ).get(user.id).count, meta: 'Shared learner records' },
      { label: 'School', value: 'Cheleta', meta: 'Primary School' }
    ],
    CSR_PARTNER: [
      { label: 'Learners reached', value: totals.learners, meta: 'Aggregate learner count' },
      { label: 'Teachers supported', value: totals.teachers, meta: 'Aggregate staff count' },
      { label: 'Attendance records', value: attendanceSummary.total, meta: 'Aggregate attendance count' },
      { label: 'Assessments', value: totals.assessments, meta: 'Aggregate record count' }
    ],
    STUDENT: [
      { label: 'My class', value: learnerRows[0]?.className || '—', meta: `Grade ${learnerRows[0]?.grade || '—'}` },
      { label: 'My attendance', value: learnerRows.length ? `${learnerRows[0].attendance}%` : '—', meta: 'Recorded attendance' },
      { label: 'My assessments', value: db.prepare(
        'SELECT COUNT(*) AS count FROM assessments a JOIN user_learners ul ON ul.learner_id = a.learner_id WHERE ul.user_id = ?'
      ).get(user.id).count, meta: 'Learning progress' },
      { label: 'Learning library', value: db.prepare('SELECT COUNT(*) AS count FROM learning_resources').get().count, meta: 'Notes and revision resources' }
    ],
    STAFF: [
      { label: 'Learners', value: totals.learners, meta: 'Active learner profiles' },
      { label: 'Teachers', value: totals.teachers, meta: 'Active staff profiles' },
      { label: 'Attendance', value: `${totals.attendance}%`, meta: 'Recorded attendance' },
      { label: 'Assessments', value: totals.assessments, meta: 'Saved CBC records' }
    ],
    BOARD: [
      { label: 'Learners', value: totals.learners, meta: 'School-wide total' },
      { label: 'Teachers', value: totals.teachers, meta: 'Active staff' },
      { label: 'Attendance', value: `${totals.attendance}%`, meta: 'School-wide attendance' },
      { label: 'Assessments', value: totals.assessments, meta: 'Recorded CBC assessments' }
    ]
  };

  return send(res, 200, {
    summary: summaries[user.role],
    actions: user.role === 'ADMIN'
      ? ['Create a learner profile', 'Manage classes and teachers', 'Review attendance', 'Review CBC assessments', 'Review parent comments']
      : user.role === 'TEACHER'
        ? ['Record class attendance', 'Enter CBC assessment', 'Review assigned learners']
        : user.role === 'PARENT'
          ? ['Review linked learner attendance', 'View CBC progress']
            : user.role === 'STUDENT'
              ? ['Read subject notes', 'Practise revision questions', 'Explore mentorship programs', 'Share an idea with the school']
              : user.role === 'BOARD'
                ? ['Review school-wide progress']
                : user.role === 'STAFF'
                  ? ['Review learner records', 'Support school administration']
                  : ['View aggregate school impact'],
    alerts: [],
    lastUpdated: new Date().toISOString()
  }, 'Dashboard loaded');
});

app.get('/api/learners', authenticate, (req, res) => {
  if (['CSR_PARTNER', 'BOARD'].includes(req.user.role)) {
    return send(res, 403, null, 'This account can view school-wide summary information only.');
  }
  return send(res, 200, learnersForUser(req.user), 'Learners retrieved');
});

app.post('/api/learners', authenticate, allowRoles('ADMIN', 'TEACHER'), (req, res) => {
  const firstName = cleanText(req.body?.firstName, 80);
  const lastName = cleanText(req.body?.lastName, 80);
  const grade = Number(req.body?.grade);
  const stream = cleanText(req.body?.stream || 'A', 20);
  const className = cleanText(req.body?.className, 60);

  if (!firstName || !lastName || !Number.isInteger(grade) || grade < 1 || grade > 9
    || !className || !stream || !classMatchesGrade(className, grade)) {
    return send(res, 400, null, 'Provide learner names, a valid grade from 1 to 9, a matching class, and stream.');
  }
  if (!requireAssignedClass(req.user, className)) {
    return send(res, 403, null, 'Teachers can register learners only in their assigned classes.');
  }

  const result = db.prepare(
    `INSERT INTO learners (first_name, last_name, grade, class_name, stream, support)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(firstName, lastName, grade, className, stream, cleanText(req.body?.support || 'On track', 120));
  audit(req.user.id, 'LEARNER_CREATED', 'learner', { learnerId: Number(result.lastInsertRowid) });
  return send(res, 201, db.prepare(
    'SELECT id, first_name AS firstName, last_name AS lastName, grade, class_name AS className, stream, support, status FROM learners WHERE id = ?'
  ).get(Number(result.lastInsertRowid)), 'Learner created');
});

app.put('/api/learners/:id', authenticate, allowRoles('ADMIN'), (req, res) => {
  const id = Number(req.params.id);
  const firstName = cleanText(req.body?.firstName, 80);
  const lastName = cleanText(req.body?.lastName, 80);
  const grade = Number(req.body?.grade);
  const stream = cleanText(req.body?.stream || 'A', 20);
  const className = cleanText(req.body?.className, 60);
  const status = cleanText(req.body?.status || 'ACTIVE', 20).toUpperCase();
  if (!Number.isInteger(id) || !firstName || !lastName || !Number.isInteger(grade)
    || grade < 1 || grade > 9 || !className || !stream || !['ACTIVE', 'INACTIVE'].includes(status)
    || !classMatchesGrade(className, grade)) {
    return send(res, 400, null, 'Provide valid learner details.');
  }

  const result = db.prepare(
    `UPDATE learners SET first_name = ?, last_name = ?, grade = ?, class_name = ?,
     stream = ?, support = ?, status = ? WHERE id = ?`
  ).run(firstName, lastName, grade, className, stream, cleanText(req.body?.support || 'On track', 120), status, id);
  if (!result.changes) return send(res, 404, null, 'Learner not found.');

  audit(req.user.id, 'LEARNER_UPDATED', 'learner', { learnerId: id });
  return send(res, 200, db.prepare(
    'SELECT id, first_name AS firstName, last_name AS lastName, grade, class_name AS className, stream, support, status FROM learners WHERE id = ?'
  ).get(id), 'Learner updated');
});

app.delete('/api/learners/:id', authenticate, allowRoles('ADMIN'), (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return send(res, 400, null, 'Learner ID is invalid.');
  const result = db.prepare(
    "UPDATE learners SET status = 'INACTIVE' WHERE id = ? AND status = 'ACTIVE'"
  ).run(id);
  if (!result.changes) {
    const exists = db.prepare('SELECT 1 FROM learners WHERE id = ?').get(id);
    return send(res, exists ? 409 : 404, null, exists ? 'Learner is already archived.' : 'Learner not found.');
  }
  audit(req.user.id, 'LEARNER_ARCHIVED', 'learner', { learnerId: id });
  return send(res, 200, { id, status: 'INACTIVE' }, 'Learner archived; history has been retained.');
});

app.get('/api/classes', authenticate, allowRoles('ADMIN', 'TEACHER', 'PARENT'), (req, res) => {
  const classes = req.user.role === 'ADMIN'
    ? db.prepare('SELECT class_name AS className, grade FROM classes ORDER BY grade, class_name').all()
    : req.user.role === 'TEACHER'
      ? db.prepare(
        `SELECT c.class_name AS className, c.grade FROM classes c
         JOIN teacher_classes tc ON tc.class_name = c.class_name
         WHERE tc.teacher_id = ? ORDER BY c.grade, c.class_name`
      ).all(req.user.teacherId || -1)
      : db.prepare(
        `SELECT DISTINCT c.class_name AS className, c.grade FROM classes c
         JOIN learners l ON l.class_name = c.class_name
         JOIN user_learners ul ON ul.learner_id = l.id
         WHERE ul.user_id = ? ORDER BY c.grade, c.class_name`
      ).all(req.user.id);
  return send(res, 200, classes, 'Classes retrieved');
});

app.post('/api/classes', authenticate, allowRoles('ADMIN'), (req, res) => {
  const className = cleanText(req.body?.className, 60);
  const grade = Number(req.body?.grade);
  if (!className || !Number.isInteger(grade) || grade < 1 || grade > 9) {
    return send(res, 400, null, 'Provide a class name and a grade from 1 to 9.');
  }
  try {
    db.prepare('INSERT INTO classes (class_name, grade) VALUES (?, ?)').run(className, grade);
  } catch (error) {
    if (error.errcode === 1555 || error.errcode === 2067) {
      return send(res, 409, null, 'A class with that name already exists.');
    }
    throw error;
  }
  audit(req.user.id, 'CLASS_CREATED', 'class', { className, grade });
  return send(res, 201, { className, grade }, 'Class created');
});

app.delete('/api/classes/:className', authenticate, allowRoles('ADMIN'), (req, res) => {
  const className = cleanText(req.params.className, 60);
  const existing = db.prepare('SELECT grade FROM classes WHERE class_name = ?').get(className);
  if (!existing) return send(res, 404, null, 'Class not found.');
  if (db.prepare('SELECT 1 FROM learners WHERE class_name = ?').get(className)) {
    return send(res, 409, null, 'Classes with learner records cannot be removed.');
  }
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('DELETE FROM teacher_classes WHERE class_name = ?').run(className);
    db.prepare('DELETE FROM classes WHERE class_name = ?').run(className);
    audit(req.user.id, 'CLASS_REMOVED', 'class', { className });
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return send(res, 200, { className }, 'Class removed');
});

app.get('/api/parent-comments', authenticate, allowRoles('ADMIN', 'TEACHER', 'PARENT'), (req, res) => {
  const conditions = [];
  const params = [];
  if (req.user.role === 'PARENT') {
    conditions.push('pc.parent_id = ?');
    params.push(req.user.id);
  } else if (req.user.role === 'TEACHER') {
    conditions.push(
      'EXISTS (SELECT 1 FROM teacher_classes tc WHERE tc.teacher_id = ? AND tc.class_name = l.class_name)'
    );
    params.push(req.user.teacherId || -1);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const comments = db.prepare(
    `SELECT pc.id, pc.learner_id AS learnerId, l.first_name || ' ' || l.last_name AS learner,
      l.class_name AS className, pc.parent_id AS parentId, u.name AS parent,
      pc.comment, pc.created_at AS createdAt
     FROM parent_comments pc
     JOIN learners l ON l.id = pc.learner_id
     JOIN users u ON u.id = pc.parent_id
     ${where}
     ORDER BY pc.created_at DESC, pc.id DESC`
  ).all(...params);
  return send(res, 200, comments, 'Parent comments retrieved');
});

app.post('/api/parent-comments', authenticate, allowRoles('PARENT'), (req, res) => {
  const learnerId = Number(req.body?.learnerId);
  const comment = cleanText(req.body?.comment, 1000);
  const learner = learnerForRole(learnerId, req.user);
  if (!learner || learner.status !== 'ACTIVE') {
    return send(res, 404, null, 'The linked learner was not found.');
  }
  if (!comment) return send(res, 400, null, 'Enter a comment about the learner.');
  try {
    const result = db.prepare(
      'INSERT INTO parent_comments (parent_id, learner_id, comment) VALUES (?, ?, ?)'
    ).run(req.user.id, learnerId, comment);
    audit(req.user.id, 'PARENT_COMMENT_CREATED', 'parent_comment', {
      commentId: Number(result.lastInsertRowid),
      learnerId
    });
    return send(res, 201, {
      id: Number(result.lastInsertRowid),
      learnerId,
      learner: `${learner.firstName} ${learner.lastName}`,
      parentId: req.user.id,
      parent: req.user.name,
      comment
    }, 'Comment submitted');
  } catch (error) {
    if (error.errcode === 1555 || error.errcode === 2067) {
      return send(res, 409, null, 'You have already submitted a comment for this learner.');
    }
    throw error;
  }
});

app.get('/api/teachers', authenticate, allowRoles('ADMIN'), (req, res) => {
  const teachers = db.prepare(
    `SELECT t.id, t.name, t.email, t.phone, t.qualification, t.status,
      GROUP_CONCAT(tc.class_name, ', ') AS classes
     FROM teachers t LEFT JOIN teacher_classes tc ON tc.teacher_id = t.id
     GROUP BY t.id ORDER BY t.name`
  ).all();
  return send(res, 200, teachers, 'Teachers retrieved');
});

app.post('/api/teachers', authenticate, allowRoles('ADMIN'), (req, res) => {
  const name = cleanText(req.body?.name, 120);
  const email = cleanText(req.body?.email, 254).toLowerCase();
  const phone = cleanText(req.body?.phone, 40);
  const qualification = cleanText(req.body?.qualification, 160);
  const classNames = Array.isArray(req.body?.classes)
    ? [...new Set(req.body.classes.map((item) => cleanText(item, 60)).filter(Boolean))]
    : [];
  const accountPassword = typeof req.body?.password === 'string' ? req.body.password : '';
  if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || accountPassword.length < 8) {
    return send(res, 400, null, 'Provide a teacher name, valid email, and sign-in password of at least 8 characters.');
  }
  if (classNames.some((className) => !db.prepare('SELECT 1 FROM classes WHERE class_name = ?').get(className))) {
    return send(res, 400, null, 'Assign teachers only to existing classes.');
  }

  db.exec('BEGIN IMMEDIATE');
  try {
    const result = db.prepare(
      'INSERT INTO teachers (name, email, phone, qualification) VALUES (?, ?, ?, ?)'
    ).run(name, email, phone, qualification);
    const teacherId = Number(result.lastInsertRowid);
    db.prepare(
      'INSERT INTO users (name, email, password_hash, role, teacher_id) VALUES (?, ?, ?, ?, ?)'
    ).run(name, email, hashPassword(accountPassword), 'TEACHER', teacherId);
    const insertClass = db.prepare('INSERT INTO teacher_classes (teacher_id, class_name) VALUES (?, ?)');
    classNames.forEach((className) => insertClass.run(teacherId, className));
    audit(req.user.id, 'TEACHER_CREATED', 'teacher', { teacherId });
    db.exec('COMMIT');
    return send(res, 201, db.prepare(
      'SELECT id, name, email, phone, qualification, status FROM teachers WHERE id = ?'
    ).get(teacherId), 'Teacher profile created');
  } catch (error) {
    db.exec('ROLLBACK');
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return send(res, 409, null, 'A teacher with that email already exists.');
    }
    throw error;
  }
});

app.put('/api/teachers/:id', authenticate, allowRoles('ADMIN'), (req, res) => {
  const id = Number(req.params.id);
  const name = cleanText(req.body?.name, 120);
  const email = cleanText(req.body?.email, 254).toLowerCase();
  const phone = cleanText(req.body?.phone, 40);
  const qualification = cleanText(req.body?.qualification, 160);
  const status = cleanText(req.body?.status || 'ACTIVE', 20).toUpperCase();
  const classNames = Array.isArray(req.body?.classes)
    ? [...new Set(req.body.classes.map((item) => cleanText(item, 60)).filter(Boolean))]
    : [];
  if (!Number.isInteger(id) || !name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    || !['ACTIVE', 'INACTIVE'].includes(status)) {
    return send(res, 400, null, 'Provide valid teacher details.');
  }
  if (classNames.some((className) => !db.prepare('SELECT 1 FROM classes WHERE class_name = ?').get(className))) {
    return send(res, 400, null, 'Assign teachers only to existing classes.');
  }

  db.exec('BEGIN IMMEDIATE');
  try {
    const result = db.prepare(
      'UPDATE teachers SET name = ?, email = ?, phone = ?, qualification = ?, status = ? WHERE id = ?'
    ).run(name, email, phone, qualification, status, id);
    if (!result.changes) {
      db.exec('ROLLBACK');
      return send(res, 404, null, 'Teacher not found.');
    }
    db.prepare('UPDATE users SET name = ?, email = ? WHERE teacher_id = ?').run(name, email, id);
    db.prepare('DELETE FROM teacher_classes WHERE teacher_id = ?').run(id);
    const insertClass = db.prepare('INSERT INTO teacher_classes (teacher_id, class_name) VALUES (?, ?)');
    classNames.forEach((className) => insertClass.run(id, className));
    audit(req.user.id, 'TEACHER_UPDATED', 'teacher', { teacherId: id });
    db.exec('COMMIT');
    return send(res, 200, db.prepare(
      'SELECT id, name, email, phone, qualification, status FROM teachers WHERE id = ?'
    ).get(id), 'Teacher profile updated');
  } catch (error) {
    db.exec('ROLLBACK');
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return send(res, 409, null, 'A teacher with that email already exists.');
    }
    throw error;
  }
});

app.delete('/api/teachers/:id', authenticate, allowRoles('ADMIN'), (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return send(res, 400, null, 'Teacher ID is invalid.');
  const result = db.prepare(
    "UPDATE teachers SET status = 'INACTIVE' WHERE id = ? AND status = 'ACTIVE'"
  ).run(id);
  if (!result.changes) {
    const exists = db.prepare('SELECT 1 FROM teachers WHERE id = ?').get(id);
    return send(res, exists ? 409 : 404, null, exists ? 'Teacher is already inactive.' : 'Teacher not found.');
  }
  audit(req.user.id, 'TEACHER_DEACTIVATED', 'teacher', { teacherId: id });
  return send(res, 200, { id, status: 'INACTIVE' }, 'Teacher deactivated; historical records have been retained.');
});

app.get('/api/staff', authenticate, allowRoles('ADMIN'), (req, res) => {
  const accounts = db.prepare(
    `SELECT u.id, u.name, u.email, u.role, u.status, u.created_at AS createdAt,
      l.id AS learnerId, l.first_name || ' ' || l.last_name AS learner
     FROM users u
     LEFT JOIN user_learners ul ON ul.user_id = u.id
     LEFT JOIN learners l ON l.id = ul.learner_id
     WHERE u.role IN ('STAFF', 'BOARD', 'STUDENT')
     ORDER BY u.role, u.name`
  ).all();
  return send(res, 200, accounts, 'School accounts retrieved');
});

app.post('/api/staff', authenticate, allowRoles('ADMIN'), (req, res) => {
  const name = cleanText(req.body?.name, 120);
  const email = cleanText(req.body?.email, 254).toLowerCase();
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  const role = cleanText(req.body?.role, 20).toUpperCase();
  const learnerId = Number(req.body?.learnerId);
  if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 8
    || !['STAFF', 'BOARD', 'STUDENT'].includes(role)) {
    return send(res, 400, null, 'Provide a name, valid email, password of at least 8 characters, and an allowed account role.');
  }
  let learner;
  if (role === 'STUDENT') {
    learner = db.prepare(
      `SELECT l.id FROM learners l
       WHERE l.id = ? AND l.status = 'ACTIVE'
         AND NOT EXISTS (SELECT 1 FROM user_learners ul JOIN users u ON u.id = ul.user_id
           WHERE ul.learner_id = l.id AND u.role = 'STUDENT' AND u.status = 'ACTIVE')`
    ).get(learnerId);
    if (!learner) return send(res, 400, null, 'Select an active learner without an existing student sign-in.');
  }
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = db.prepare(
      'INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)'
    ).run(name, email, hashPassword(password), role);
    const id = Number(result.lastInsertRowid);
    if (learner) {
      db.prepare('INSERT INTO user_learners (user_id, learner_id) VALUES (?, ?)').run(id, learner.id);
    }
    audit(req.user.id, 'ACCOUNT_CREATED', 'user', { accountId: id, role });
    db.exec('COMMIT');
    return send(res, 201, { id, name, email, role, status: 'ACTIVE', learnerId: learner?.id || null },
      'School account created');
  } catch (error) {
    db.exec('ROLLBACK');
    if (error.errcode === 1555 || error.errcode === 2067) {
      return send(res, 409, null, 'An account with that email already exists.');
    }
    throw error;
  }
});

app.delete('/api/staff/:id', authenticate, allowRoles('ADMIN'), (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return send(res, 400, null, 'Account ID is invalid.');
  const result = db.prepare(
    `UPDATE users SET status = 'INACTIVE'
     WHERE id = ? AND role IN ('STAFF', 'BOARD', 'STUDENT') AND status = 'ACTIVE'`
  ).run(id);
  if (!result.changes) return send(res, 404, null, 'Active school account not found.');
  audit(req.user.id, 'ACCOUNT_DEACTIVATED', 'user', { accountId: id });
  return send(res, 200, { id, status: 'INACTIVE' }, 'School account deactivated');
});

app.get('/api/learning-resources', authenticate, allowRoles('ADMIN', 'TEACHER', 'STAFF', 'STUDENT'), (req, res) => {
  let gradeFilter = null;
  if (req.user.role === 'STUDENT') {
    const linkedLearner = db.prepare(
      `SELECT l.grade FROM user_learners ul JOIN learners l ON l.id = ul.learner_id
       WHERE ul.user_id = ? AND l.status = 'ACTIVE'`
    ).get(req.user.id);
    if (!linkedLearner) return send(res, 403, null, 'A linked active learner profile is required.');
    gradeFilter = linkedLearner.grade;
  }
  const resources = db.prepare(
    `SELECT r.id, r.category, r.subject, r.grade, r.title, r.content,
      r.created_at AS createdAt,
      COALESCE((SELECT json_group_array(json_object('id', q.id, 'question', q.question, 'answer', q.answer))
        FROM revision_questions q WHERE q.resource_id = r.id ORDER BY q.position), '[]') AS questions
     FROM learning_resources r
     WHERE (? IS NULL OR r.grade IS NULL OR r.grade = ?)
     ORDER BY r.category, r.subject, r.grade, r.title`
  ).all(gradeFilter, gradeFilter).map((resource) => ({
    ...resource,
    questions: JSON.parse(resource.questions)
  }));
  return send(res, 200, resources, 'Learning resources retrieved');
});

app.post('/api/learning-resources', authenticate, allowRoles('ADMIN'), (req, res) => {
  const category = cleanText(req.body?.category, 30).toUpperCase();
  const subject = cleanText(req.body?.subject, 100);
  const title = cleanText(req.body?.title, 180);
  const content = cleanText(req.body?.content, 12000);
  const grade = req.body?.grade === '' || req.body?.grade == null ? null : Number(req.body.grade);
  const questions = Array.isArray(req.body?.questions) ? req.body.questions : [];
  if (!['SUBJECT_NOTES', 'CAREER_READINESS', 'CODING_BOOTCAMP'].includes(category)
    || !subject || !title || !content
    || (grade !== null && (!Number.isInteger(grade) || grade < 1 || grade > 9))
    || questions.length > 30
    || questions.some((item) => !cleanText(item?.question, 1000) || !cleanText(item?.answer, 2000))) {
    return send(res, 400, null, 'Provide a category, subject, title, notes, valid grade, and valid revision questions.');
  }
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = db.prepare(
      `INSERT INTO learning_resources (category, subject, grade, title, content, created_by)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(category, subject, grade, title, content, req.user.id);
    const resourceId = Number(result.lastInsertRowid);
    const insertQuestion = db.prepare(
      'INSERT INTO revision_questions (resource_id, question, answer, position) VALUES (?, ?, ?, ?)'
    );
    questions.forEach((item, index) => insertQuestion.run(
      resourceId, cleanText(item.question, 1000), cleanText(item.answer, 2000), index + 1
    ));
    audit(req.user.id, 'LEARNING_RESOURCE_CREATED', 'learning_resource', { resourceId, category });
    db.exec('COMMIT');
    return send(res, 201, { id: resourceId }, 'Learning resource published');
  } catch (error) {
    db.exec('ROLLBACK');
    if (error.errcode === 1555 || error.errcode === 2067) {
      return send(res, 409, null, 'A resource with that title and category already exists for this grade.');
    }
    throw error;
  }
});

app.get('/api/mentorship', authenticate, allowRoles('ADMIN', 'TEACHER', 'STAFF', 'STUDENT'), (req, res) => {
  const isStudent = req.user.role === 'STUDENT';
  const student = isStudent ? db.prepare(
    `SELECT l.id AS learnerId, l.grade FROM user_learners ul
     JOIN learners l ON l.id = ul.learner_id
     WHERE ul.user_id = ? AND l.status = 'ACTIVE'`
  ).get(req.user.id) : null;
  if (isStudent && !student) return send(res, 403, null, 'A linked active learner profile is required.');
  const programs = db.prepare(
    `SELECT p.id, p.title, p.description, p.mentor, p.grade, p.status,
      COUNT(DISTINCT me.learner_id) AS enrollmentCount,
      ${isStudent ? 'EXISTS (SELECT 1 FROM mentorship_enrollments mine WHERE mine.program_id = p.id AND mine.learner_id = ?) AS enrolled' : '0 AS enrolled'}
     FROM mentorship_programs p
     LEFT JOIN mentorship_enrollments me ON me.program_id = p.id
     WHERE (? = 0 OR (p.status = 'ACTIVE' AND (p.grade IS NULL OR p.grade = ?)))
     GROUP BY p.id ORDER BY p.status, p.title`
  ).all(...(isStudent ? [student.learnerId, 1, student.grade] : [0, 0]));
  return send(res, 200, programs, 'Mentorship programs retrieved');
});

app.post('/api/mentorship', authenticate, allowRoles('ADMIN'), (req, res) => {
  const title = cleanText(req.body?.title, 180);
  const description = cleanText(req.body?.description, 2000);
  const mentor = cleanText(req.body?.mentor, 120);
  const grade = req.body?.grade === '' || req.body?.grade == null ? null : Number(req.body.grade);
  if (!title || !description || !mentor
    || (grade !== null && (!Number.isInteger(grade) || grade < 1 || grade > 9))) {
    return send(res, 400, null, 'Provide a program title, description, mentor, and valid optional grade.');
  }
  const result = db.prepare(
    'INSERT INTO mentorship_programs (title, description, mentor, grade, created_by) VALUES (?, ?, ?, ?, ?)'
  ).run(title, description, mentor, grade, req.user.id);
  audit(req.user.id, 'MENTORSHIP_PROGRAM_CREATED', 'mentorship_program', { programId: Number(result.lastInsertRowid) });
  return send(res, 201, { id: Number(result.lastInsertRowid) }, 'Mentorship program created');
});

app.post('/api/mentorship/:id/enroll', authenticate, allowRoles('STUDENT'), (req, res) => {
  const id = Number(req.params.id);
  const learner = db.prepare(
    `SELECT l.id, l.grade FROM user_learners ul JOIN learners l ON l.id = ul.learner_id
     WHERE ul.user_id = ? AND l.status = 'ACTIVE'`
  ).get(req.user.id);
  const program = db.prepare(
    `SELECT id FROM mentorship_programs WHERE id = ? AND status = 'ACTIVE'
      AND (grade IS NULL OR grade = ?)`
  ).get(id, learner?.grade);
  if (!learner || !program) return send(res, 404, null, 'An eligible active mentorship program was not found.');
  try {
    db.prepare('INSERT INTO mentorship_enrollments (program_id, learner_id) VALUES (?, ?)').run(id, learner.id);
  } catch (error) {
    if (error.errcode === 1555 || error.errcode === 2067) {
      return send(res, 409, null, 'You are already enrolled in this program.');
    }
    throw error;
  }
  audit(req.user.id, 'MENTORSHIP_ENROLLED', 'mentorship_program', { programId: id, learnerId: learner.id });
  return send(res, 201, { programId: id }, 'You have joined the mentorship program');
});

app.delete('/api/mentorship/:id', authenticate, allowRoles('ADMIN'), (req, res) => {
  const id = Number(req.params.id);
  const result = db.prepare(
    "UPDATE mentorship_programs SET status = 'INACTIVE' WHERE id = ? AND status = 'ACTIVE'"
  ).run(id);
  if (!result.changes) return send(res, 404, null, 'Active mentorship program not found.');
  audit(req.user.id, 'MENTORSHIP_PROGRAM_DEACTIVATED', 'mentorship_program', { programId: id });
  return send(res, 200, { id, status: 'INACTIVE' }, 'Mentorship program closed');
});

app.get('/api/suggestions', authenticate, allowRoles('ADMIN', 'STUDENT'), (req, res) => {
  const suggestions = db.prepare(
    `SELECT s.id, s.learner_id AS learnerId, l.first_name || ' ' || l.last_name AS learner,
      l.class_name AS className, s.subject, s.suggestion, s.status, s.created_at AS createdAt
     FROM student_suggestions s JOIN learners l ON l.id = s.learner_id
     WHERE (? = 1 OR EXISTS (SELECT 1 FROM user_learners ul WHERE ul.user_id = ? AND ul.learner_id = s.learner_id))
     ORDER BY s.created_at DESC, s.id DESC`
  ).all(req.user.role === 'ADMIN' ? 1 : 0, req.user.id);
  return send(res, 200, suggestions, 'Suggestions retrieved');
});

app.post('/api/suggestions', authenticate, allowRoles('STUDENT'), (req, res) => {
  const subject = cleanText(req.body?.subject, 100);
  const suggestion = cleanText(req.body?.suggestion, 2000);
  const learner = db.prepare(
    `SELECT l.id FROM user_learners ul JOIN learners l ON l.id = ul.learner_id
     WHERE ul.user_id = ? AND l.status = 'ACTIVE'`
  ).get(req.user.id);
  if (!learner) return send(res, 403, null, 'A linked active learner profile is required.');
  if (!subject || !suggestion) return send(res, 400, null, 'Provide a subject and suggestion.');
  const result = db.prepare(
    'INSERT INTO student_suggestions (learner_id, subject, suggestion) VALUES (?, ?, ?)'
  ).run(learner.id, subject, suggestion);
  audit(req.user.id, 'STUDENT_SUGGESTION_CREATED', 'student_suggestion', { suggestionId: Number(result.lastInsertRowid) });
  return send(res, 201, { id: Number(result.lastInsertRowid), status: 'NEW' }, 'Your suggestion was sent to the school admin');
});

app.put('/api/suggestions/:id', authenticate, allowRoles('ADMIN'), (req, res) => {
  const id = Number(req.params.id);
  const status = cleanText(req.body?.status, 20).toUpperCase();
  if (!Number.isInteger(id) || !['NEW', 'IN_REVIEW', 'RESOLVED'].includes(status)) {
    return send(res, 400, null, 'Provide a valid suggestion and status.');
  }
  const result = db.prepare('UPDATE student_suggestions SET status = ? WHERE id = ?').run(status, id);
  if (!result.changes) return send(res, 404, null, 'Suggestion not found.');
  audit(req.user.id, 'STUDENT_SUGGESTION_UPDATED', 'student_suggestion', { suggestionId: id, status });
  return send(res, 200, { id, status }, 'Suggestion status updated');
});

app.get('/api/board/progress', authenticate, allowRoles('ADMIN', 'BOARD'), (req, res) => {
  const classes = db.prepare(
    `SELECT l.class_name AS className, l.grade, COUNT(*) AS learners,
      (SELECT COUNT(*) FROM assessments a JOIN learners la ON la.id = a.learner_id
       WHERE la.class_name = l.class_name AND la.status = 'ACTIVE') AS assessments,
      (SELECT COUNT(*) FROM attendance at JOIN learners lt ON lt.id = at.learner_id
       WHERE lt.class_name = l.class_name AND lt.status = 'ACTIVE') AS attendanceRecords,
      COALESCE((SELECT ROUND(100.0 * SUM(CASE WHEN at.status IN ('PRESENT', 'LATE') THEN 1 ELSE 0 END)
        / NULLIF(COUNT(*), 0), 0) FROM attendance at JOIN learners lt ON lt.id = at.learner_id
        WHERE lt.class_name = l.class_name AND lt.status = 'ACTIVE'), 0) AS attendanceRate
     FROM learners l WHERE l.status = 'ACTIVE'
     GROUP BY l.class_name, l.grade ORDER BY l.grade, l.class_name`
  ).all();
  const staff = db.prepare(
    `SELECT role, COUNT(*) AS count FROM users
     WHERE status = 'ACTIVE' AND role IN ('TEACHER', 'STAFF', 'BOARD')
     GROUP BY role ORDER BY role`
  ).all();
  const activePrograms = db.prepare(
    "SELECT COUNT(*) AS count FROM mentorship_programs WHERE status = 'ACTIVE'"
  ).get().count;
  const suggestionSummary = db.prepare(
    'SELECT status, COUNT(*) AS count FROM student_suggestions GROUP BY status ORDER BY status'
  ).all();
  return send(res, 200, { classes, staff, activePrograms, suggestions: suggestionSummary }, 'School progress retrieved');
});

app.get('/api/assessments', authenticate, allowRoles('ADMIN', 'TEACHER', 'PARENT', 'STUDENT', 'STAFF'), (req, res) => {
  const filters = req.query;
  const conditions = [];
  const params = [];

  if (req.user.role === 'PARENT' || req.user.role === 'STUDENT') {
    conditions.push('EXISTS (SELECT 1 FROM user_learners ul WHERE ul.learner_id = a.learner_id AND ul.user_id = ?)');
    params.push(req.user.id);
  } else if (req.user.role === 'TEACHER') {
    conditions.push('EXISTS (SELECT 1 FROM teacher_classes tc WHERE tc.teacher_id = ? AND tc.class_name = l.class_name)');
    params.push(req.user.teacherId || -1);
  }

  for (const [key, column] of [['learnerId', 'a.learner_id'], ['subject', 'a.subject'], ['term', 'a.term'], ['strand', 'a.strand']]) {
    if (filters[key]) {
      conditions.push(`${column} = ?`);
      params.push(key === 'learnerId' ? Number(filters[key]) : cleanText(filters[key], 100));
    }
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const records = db.prepare(
    `SELECT a.id, a.learner_id AS learnerId, l.first_name || ' ' || l.last_name AS learner,
      l.grade, l.class_name AS className, a.subject, a.strand, a.sub_strand AS subStrand,
      a.competency, a.level, a.teacher_id AS teacherId, t.name AS teacher, a.term,
      a.assessment_date AS date, a.comment
     FROM assessments a JOIN learners l ON l.id = a.learner_id
     JOIN teachers t ON t.id = a.teacher_id ${where}
     ORDER BY a.assessment_date DESC, a.id DESC`
  ).all(...params);
  return send(res, 200, records, 'Assessments retrieved');
});

app.post('/api/assessments', authenticate, allowRoles('ADMIN', 'TEACHER'), (req, res) => {
  const learnerId = Number(req.body?.learnerId);
  const learner = learnerForRole(learnerId, req.user);
  const subject = cleanText(req.body?.subject, 100);
  const strand = cleanText(req.body?.strand, 120);
  const subStrand = cleanText(req.body?.subStrand, 120);
  const competency = cleanText(req.body?.competency, 240);
  const level = cleanText(req.body?.level, 2).toUpperCase();
  const term = cleanText(req.body?.term, 80);
  const date = req.body?.date;
  const comment = cleanText(req.body?.comment, 1000);
  if (!learner || !subject || !strand || !subStrand || !competency
    || !rubricLevels.has(level) || !term || !validDate(date)) {
    return send(res, 400, null, 'Provide a learner, CBC details, rubric level, term, and valid date.');
  }

  const teacherId = req.user.teacherId || Number(req.body?.teacherId);
  if (!teacherId || !db.prepare('SELECT id FROM teachers WHERE id = ? AND status = ?').get(teacherId, 'ACTIVE')) {
    return send(res, 400, null, 'A valid active teacher must be selected.');
  }
  const result = db.prepare(
    `INSERT INTO assessments
      (learner_id, subject, strand, sub_strand, competency, level, teacher_id, term, assessment_date, comment)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(learnerId, subject, strand, subStrand, competency, level, teacherId, term, date, comment);
  audit(req.user.id, 'ASSESSMENT_CREATED', 'assessment', { assessmentId: Number(result.lastInsertRowid) });
  return send(res, 201, { id: Number(result.lastInsertRowid) }, 'Assessment saved');
});

app.put('/api/assessments/:id', authenticate, allowRoles('ADMIN', 'TEACHER'), (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare(
    'SELECT learner_id AS learnerId, teacher_id AS teacherId FROM assessments WHERE id = ?'
  ).get(id);
  if (!existing) return send(res, 404, null, 'Assessment not found.');
  const learnerId = Number(req.body?.learnerId);
  const learner = learnerForRole(learnerId, req.user);
  const fields = {
    subject: cleanText(req.body?.subject, 100),
    strand: cleanText(req.body?.strand, 120),
    subStrand: cleanText(req.body?.subStrand, 120),
    competency: cleanText(req.body?.competency, 240),
    level: cleanText(req.body?.level, 2).toUpperCase(),
    term: cleanText(req.body?.term, 80),
    date: req.body?.date,
    comment: cleanText(req.body?.comment, 1000)
  };
  if (!learner || Object.values(fields).some((value) => !value)
    || !rubricLevels.has(fields.level) || !validDate(fields.date)) {
    return send(res, 400, null, 'Provide valid CBC assessment details.');
  }
  if (req.user.role === 'TEACHER' && existing.teacherId !== req.user.teacherId) {
    return send(res, 403, null, 'Teachers can edit only assessments they recorded.');
  }
  db.prepare(
    `UPDATE assessments SET learner_id = ?, subject = ?, strand = ?, sub_strand = ?,
      competency = ?, level = ?, term = ?, assessment_date = ?, comment = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  ).run(learnerId, fields.subject, fields.strand, fields.subStrand, fields.competency,
    fields.level, fields.term, fields.date, fields.comment, id);
  audit(req.user.id, 'ASSESSMENT_UPDATED', 'assessment', { assessmentId: id });
  return send(res, 200, { id }, 'Assessment updated');
});

app.get('/api/attendance', authenticate, allowRoles('ADMIN', 'TEACHER', 'PARENT', 'STUDENT', 'STAFF'), (req, res) => {
  const conditions = [];
  const params = [];
  if (req.user.role === 'PARENT' || req.user.role === 'STUDENT') {
    conditions.push('EXISTS (SELECT 1 FROM user_learners ul WHERE ul.learner_id = a.learner_id AND ul.user_id = ?)');
    params.push(req.user.id);
  } else if (req.user.role === 'TEACHER') {
    conditions.push('EXISTS (SELECT 1 FROM teacher_classes tc WHERE tc.teacher_id = ? AND tc.class_name = a.class_name)');
    params.push(req.user.teacherId || -1);
  }
  if (req.query.learnerId) {
    conditions.push('a.learner_id = ?');
    params.push(Number(req.query.learnerId));
  }
  if (req.query.className) {
    conditions.push('a.class_name = ?');
    params.push(cleanText(req.query.className, 60));
  }
  if (req.query.date) {
    if (!validDate(req.query.date)) return send(res, 400, null, 'Date must use YYYY-MM-DD format.');
    conditions.push('a.attendance_date = ?');
    params.push(req.query.date);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const records = db.prepare(
    `SELECT a.id, a.learner_id AS learnerId, l.first_name || ' ' || l.last_name AS learner,
      a.class_name AS className, a.status, a.attendance_date AS date,
      a.client_record_id AS clientRecordId
     FROM attendance a JOIN learners l ON l.id = a.learner_id ${where}
     ORDER BY a.attendance_date DESC, l.last_name, l.first_name`
  ).all(...params);
  return send(res, 200, records, 'Attendance records retrieved');
});

app.post('/api/attendance', authenticate, allowRoles('ADMIN', 'TEACHER'), (req, res) => {
  const records = req.body?.records;
  if (!Array.isArray(records) || records.length < 1 || records.length > 200) {
    return send(res, 400, null, 'Submit between 1 and 200 attendance records.');
  }

  const prepared = [];
  const clientRecordIds = new Set();
  for (const record of records) {
    const learnerId = Number(record?.learnerId);
    const learner = learnerForRole(learnerId, req.user);
    const status = cleanText(record?.status, 20).toUpperCase();
    const date = record?.date;
    const clientRecordId = cleanText(record?.clientRecordId, 100) || randomUUID();
    if (!learner || !attendanceStatuses.has(status) || !validDate(date)
      || !requireAssignedClass(req.user, learner.className)) {
      return send(res, 400, null, 'Attendance contains an invalid learner, class assignment, status, or date.');
    }
    if (clientRecordIds.has(clientRecordId)) {
      return send(res, 400, null, 'Each attendance record must have a unique clientRecordId.');
    }
    clientRecordIds.add(clientRecordId);
    const priorSubmission = db.prepare(
      'SELECT learner_id AS learnerId, attendance_date AS date FROM attendance WHERE client_record_id = ?'
    ).get(clientRecordId);
    if (priorSubmission && (priorSubmission.learnerId !== learnerId || priorSubmission.date !== date)) {
      return send(res, 409, null, 'This clientRecordId was already used for another attendance record.');
    }
    prepared.push({ learnerId, className: learner.className, status, date, clientRecordId });
  }

  db.exec('BEGIN IMMEDIATE');
  let saved;
  try {
    const insert = db.prepare(
      `INSERT OR IGNORE INTO attendance
        (learner_id, class_name, status, attendance_date, client_record_id, recorded_by)
       VALUES (?, ?, ?, ?, ?, ?)`
    );
    const selectExisting = db.prepare(
      `SELECT id, learner_id AS learnerId, status, attendance_date AS date, client_record_id AS clientRecordId
       FROM attendance WHERE client_record_id = ? OR (learner_id = ? AND attendance_date = ?)`
    );
    saved = [];
    for (const item of prepared) {
      const result = insert.run(
        item.learnerId, item.className, item.status, item.date, item.clientRecordId, req.user.id
      );
      const existing = selectExisting.get(item.clientRecordId, item.learnerId, item.date);
      saved.push({ ...existing, duplicate: result.changes === 0 });
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  if (saved.some((record) => record.duplicate)) {
    return send(res, 200, { records: saved, duplicatesIgnored: saved.filter((record) => record.duplicate).length },
      'Attendance saved; duplicate learner/date records were ignored.');
  }
  audit(req.user.id, 'ATTENDANCE_SUBMITTED', 'attendance', { count: saved.length });
  return send(res, 201, { records: saved, duplicatesIgnored: 0 }, 'Attendance saved');
});

app.put('/api/attendance/:id', authenticate, allowRoles('ADMIN', 'TEACHER'), (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare(
    'SELECT learner_id AS learnerId, class_name AS className FROM attendance WHERE id = ?'
  ).get(id);
  if (!existing) return send(res, 404, null, 'Attendance record not found.');
  const learner = learnerForRole(existing.learnerId, req.user);
  const status = cleanText(req.body?.status, 20).toUpperCase();
  if (!learner || !attendanceStatuses.has(status)) {
    return send(res, 400, null, 'Provide a valid attendance status.');
  }
  db.prepare(
    'UPDATE attendance SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
  ).run(status, id);
  audit(req.user.id, 'ATTENDANCE_UPDATED', 'attendance', { attendanceId: id });
  return send(res, 200, { id, status }, 'Attendance updated');
});

app.get('/api/resources', authenticate, (req, res) => send(res, 200, resources, 'Resources retrieved'));
app.get('/api/announcements', authenticate, (req, res) => send(res, 200, announcements, 'Announcements retrieved'));
app.get('/api/notifications', authenticate, (req, res) => send(res, 200, notifications, 'Notifications retrieved'));
app.patch('/api/notifications/:id/read', authenticate, allowRoles('ADMIN', 'TEACHER', 'CSR_PARTNER'), (req, res) => {
  const notification = notifications.find((entry) => entry.id === Number(req.params.id));
  if (!notification) return send(res, 404, null, 'Notification not found.');
  notification.read = true;
  return send(res, 200, notification, 'Notification marked as read');
});
app.patch('/api/notifications/read-all', authenticate, allowRoles('ADMIN', 'TEACHER', 'CSR_PARTNER'), (req, res) => {
  notifications.forEach((notification) => {
    notification.read = true;
  });
  return send(res, 200, notifications, 'All notifications marked as read');
});
app.get('/api/impact', authenticate, allowRoles('ADMIN', 'CSR_PARTNER'), (req, res) => {
  const learnerCount = db.prepare("SELECT COUNT(*) AS count FROM learners WHERE status = 'ACTIVE'").get().count;
  const teacherCount = db.prepare("SELECT COUNT(*) AS count FROM teachers WHERE status = 'ACTIVE'").get().count;
  const assessmentCount = db.prepare('SELECT COUNT(*) AS count FROM assessments').get().count;
  return send(res, 200, [
    { label: 'Learners reached', value: learnerCount, caption: 'Active learner profiles' },
    { label: 'Teachers supported', value: teacherCount, caption: 'Active staff profiles' },
    { label: 'Assessments recorded', value: assessmentCount, caption: 'Recorded assessments' }
  ], 'Aggregate CSR impact retrieved');
});

app.use('/api', (req, res) => send(
  res, 404, null, 'This feature is temporarily unavailable. Please refresh the page and try again.'
));

app.use((error, req, res, next) => {
  console.error('API request failed:', error);
  if (res.headersSent) return next(error);
  return send(res, 500, null, 'Something went wrong. Please try again.');
});

export { app };

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  app.listen(port, () => {
    console.log(`Cheleta SMS API running at http://localhost:${port}`);
  });
}
