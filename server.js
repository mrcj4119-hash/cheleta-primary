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
const roles = new Set(['ADMIN', 'TEACHER', 'PARENT', 'STUDENT', 'BOARD', 'STAFF']);
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
    `SELECT u.id, u.name, u.email, u.role, u.phone, u.sms_opt_in AS smsOptIn,
      u.teacher_id AS teacherId, u.status AS accountStatus,
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

function today() {
  return new Date().toISOString().slice(0, 10);
}

function cleanText(value, maxLength = 160) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function validPhone(value) {
  return typeof value === 'string' && /^\+[1-9]\d{7,14}$/.test(value);
}

async function sendSms(recipient, message) {
  const username = process.env.AT_USERNAME;
  const apiKey = process.env.AT_API_KEY;
  if (!username || !apiKey) return 'NOT_CONFIGURED';

  const payload = new URLSearchParams({ username, to: recipient, message });
  if (process.env.AT_SENDER_ID) payload.set('from', process.env.AT_SENDER_ID);
  try {
    const response = await fetch(process.env.AT_API_URL || 'https://api.africastalking.com/version1/messaging', {
      method: 'POST',
      headers: { apiKey, Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: payload
    });
    const result = await response.json();
    const recipientStatus = result.SMSMessageData?.Recipients?.[0]?.statusCode;
    return response.ok && ['100', '101', '102'].includes(String(recipientStatus)) ? 'SENT' : 'FAILED';
  } catch (error) {
    console.error('Africa\'s Talking SMS delivery failed:', error);
    return 'FAILED';
  }
}

async function notifyUsers(userIds, type, title, message) {
  const insertNotification = db.prepare(
    'INSERT INTO notifications (user_id, type, title, message) VALUES (?, ?, ?, ?)'
  );
  const insertDelivery = db.prepare(
    `INSERT INTO sms_deliveries (notification_id, recipient, status)
     VALUES (?, ?, ?)`
  );
  const uniqueIds = [...new Set(userIds)];
  for (const userId of uniqueIds) {
    const recipient = db.prepare(
      'SELECT id, phone, sms_opt_in AS smsOptIn FROM users WHERE id = ? AND status = ?'
    ).get(userId, 'ACTIVE');
    if (!recipient) continue;

    const notificationId = Number(insertNotification.run(userId, type, title, message).lastInsertRowid);
    if (!recipient.phone || !recipient.smsOptIn) continue;
    const status = await sendSms(recipient.phone, `${title}: ${message}`);
    insertDelivery.run(notificationId, recipient.phone, status);
  }
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
    `SELECT u.id, u.name, u.email, u.role, u.phone, u.sms_opt_in AS smsOptIn,
      u.teacher_id AS teacherId,
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

app.post('/api/register/parent', (req, res) => {
  const name = cleanText(req.body?.name, 120);
  const email = cleanText(req.body?.email, 254).toLowerCase();
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  const phone = cleanText(req.body?.phone, 20);
  const smsOptIn = req.body?.smsOptIn === true;

  if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 8
    || (phone && !validPhone(phone)) || (smsOptIn && !phone)) {
    return send(res, 400, null, 'Provide your name, a valid email, an 8-character password, and a valid opted-in phone number.');
  }

  try {
    const result = db.prepare(
      'INSERT INTO users (name, email, password_hash, role, phone, sms_opt_in) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(name, email, hashPassword(password), 'PARENT', phone, Number(smsOptIn));
    const user = {
      id: Number(result.lastInsertRowid),
      name,
      email,
      role: 'PARENT',
      phone,
      smsOptIn,
      teacherId: null
    };
    audit(user.id, 'PARENT_ACCOUNT_REGISTERED', 'user');
    return send(res, 201, { token: createToken(user), user }, 'Parent account created');
  } catch (error) {
    if (error.errcode === 1555 || error.errcode === 2067) {
      return send(res, 409, null, 'An account with that email already exists.');
    }
    throw error;
  }
});

app.get('/api/me', authenticate, (req, res) => send(
  res, 200, { user: req.user }, 'Current user loaded'
));

app.get('/api/dashboard', authenticate, (req, res) => {
  const user = req.user;
  const learnerRows = learnersForUser(user);
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
                  : user.role === 'STAFF'
                    ? ['Review learner records', 'Support school administration']
                    : ['Review school-wide progress'],
    alerts: [],
    lastUpdated: new Date().toISOString()
  }, 'Dashboard loaded');
});

app.get('/api/learners', authenticate, (req, res) => {
  if (req.user.role === 'BOARD') {
    return send(res, 403, null, 'This account can view school-wide summary information only.');
  }
  return send(res, 200, learnersForUser(req.user), 'Learners retrieved');
});

app.post('/api/learners', authenticate, allowRoles('ADMIN'), (req, res) => {
  const firstName = cleanText(req.body?.firstName, 80);
  const lastName = cleanText(req.body?.lastName, 80);
  const grade = Number(req.body?.grade);
  const stream = cleanText(req.body?.stream || 'A', 20);
  const className = cleanText(req.body?.className, 60);

  if (!firstName || !lastName || !Number.isInteger(grade) || grade < 1 || grade > 9
    || !className || !stream || !classMatchesGrade(className, grade)) {
    return send(res, 400, null, 'Provide learner names, a valid grade from 1 to 9, a matching class, and stream.');
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
    `SELECT u.id, u.name, u.email, u.role, u.phone, u.sms_opt_in AS smsOptIn,
      u.status, u.created_at AS createdAt,
      MAX(l.id) AS learnerId,
      group_concat(DISTINCT l.id) AS learnerIds,
      group_concat(DISTINCT l.first_name || ' ' || l.last_name) AS learner
     FROM users u
     LEFT JOIN user_learners ul ON ul.user_id = u.id
     LEFT JOIN learners l ON l.id = ul.learner_id
     GROUP BY u.id
     ORDER BY u.role, u.name`
  ).all().map((account) => ({
    ...account,
    learnerIds: account.learnerIds ? account.learnerIds.split(',').map(Number) : []
  }));
  return send(res, 200, accounts, 'School accounts retrieved');
});

app.post('/api/staff', authenticate, allowRoles('ADMIN'), (req, res) => {
  const name = cleanText(req.body?.name, 120);
  const email = cleanText(req.body?.email, 254).toLowerCase();
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  const role = cleanText(req.body?.role, 20).toUpperCase();
  if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 8
    || role !== 'STUDENT') {
    return send(res, 400, null, 'Admins can create student sign-ins only. Teacher accounts are managed in the Teachers section.');
  }
  const learner = db.prepare(
    `SELECT l.id FROM learners l
     WHERE l.id = ? AND l.status = 'ACTIVE'
       AND NOT EXISTS (SELECT 1 FROM user_learners ul JOIN users u ON u.id = ul.user_id
         WHERE ul.learner_id = l.id AND u.role = 'STUDENT' AND u.status = 'ACTIVE')`
  ).get(Number(req.body?.learnerId));
  if (!learner) return send(res, 400, null, 'Select an active learner without an existing student sign-in.');
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = db.prepare(
      'INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)'
    ).run(name, email, hashPassword(password), role);
    const id = Number(result.lastInsertRowid);
    db.prepare('INSERT INTO user_learners (user_id, learner_id) VALUES (?, ?)').run(id, learner.id);
    audit(req.user.id, 'ACCOUNT_CREATED', 'user', { accountId: id, role });
    db.exec('COMMIT');
    return send(res, 201, { id, name, email, role, status: 'ACTIVE', learnerId: learner.id },
      'School account created');
  } catch (error) {
    db.exec('ROLLBACK');
    if (error.errcode === 1555 || error.errcode === 2067) {
      return send(res, 409, null, 'An account with that email already exists.');
    }
    throw error;
  }
});

app.post('/api/parents/:id/learners', authenticate, allowRoles('ADMIN'), (req, res) => {
  const parentId = Number(req.params.id);
  const learnerId = Number(req.body?.learnerId);
  if (!Number.isInteger(parentId) || parentId < 1 || !Number.isInteger(learnerId) || learnerId < 1) {
    return send(res, 400, null, 'Parent and learner IDs must be valid.');
  }
  const parent = db.prepare(
    "SELECT id FROM users WHERE id = ? AND role = 'PARENT' AND status = 'ACTIVE'"
  ).get(parentId);
  const learner = db.prepare(
    "SELECT id FROM learners WHERE id = ? AND status = 'ACTIVE'"
  ).get(learnerId);
  if (!parent || !learner) return send(res, 404, null, 'Active parent account or learner not found.');
  if (db.prepare('SELECT 1 FROM user_learners WHERE user_id = ? AND learner_id = ?').get(parentId, learnerId)) {
    return send(res, 409, null, 'This learner is already linked to the parent account.');
  }
  db.prepare('INSERT INTO user_learners (user_id, learner_id) VALUES (?, ?)').run(parentId, learnerId);
  audit(req.user.id, 'PARENT_LEARNER_LINKED', 'user', { parentId, learnerId });
  return send(res, 201, { parentId, learnerId }, 'Learner linked to parent account');
});

app.delete('/api/staff/:id', authenticate, allowRoles('ADMIN'), (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return send(res, 400, null, 'Account ID is invalid.');
  const result = db.prepare(
    `UPDATE users SET status = 'INACTIVE'
     WHERE id = ? AND role IN ('PARENT', 'STAFF', 'BOARD', 'STUDENT', 'CSR_PARTNER') AND status = 'ACTIVE'`
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

app.post('/api/assessments', authenticate, allowRoles('ADMIN', 'TEACHER'), async (req, res) => {
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
  const parentIds = db.prepare(
    `SELECT user_id AS id FROM user_learners WHERE learner_id = ?
     AND user_id IN (SELECT id FROM users WHERE role = 'PARENT')`
  ).all(learnerId).map((row) => row.id);
  await notifyUsers(parentIds, 'PROGRESS', 'Learning progress updated',
    `A new ${subject} assessment for ${learner.firstName} ${learner.lastName} is available.`);
  audit(req.user.id, 'ASSESSMENT_CREATED', 'assessment', { assessmentId: Number(result.lastInsertRowid) });
  return send(res, 201, { id: Number(result.lastInsertRowid) }, 'Assessment saved');
});

app.put('/api/assessments/:id', authenticate, allowRoles('ADMIN', 'TEACHER'), async (req, res) => {
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
  const parentIds = db.prepare(
    `SELECT user_id AS id FROM user_learners WHERE learner_id = ?
     AND user_id IN (SELECT id FROM users WHERE role = 'PARENT')`
  ).all(learnerId).map((row) => row.id);
  await notifyUsers(parentIds, 'PROGRESS', 'Learning progress updated',
    `A ${fields.subject} assessment for ${learner.firstName} ${learner.lastName} was updated.`);
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

app.post('/api/attendance', authenticate, allowRoles('ADMIN', 'TEACHER'), async (req, res) => {
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
  audit(req.user.id, 'ATTENDANCE_SUBMITTED', 'attendance', {
    count: saved.filter((record) => !record.duplicate).length
  });
  for (const record of saved.filter((entry) => entry.status === 'ABSENT' && !entry.duplicate)) {
    const learner = db.prepare(
      'SELECT first_name AS firstName, last_name AS lastName FROM learners WHERE id = ?'
    ).get(record.learnerId);
    const parentIds = db.prepare(
      `SELECT user_id AS id FROM user_learners WHERE learner_id = ?
       AND user_id IN (SELECT id FROM users WHERE role = 'PARENT')`
    ).all(record.learnerId).map((row) => row.id);
    await notifyUsers(parentIds, 'ABSENCE', 'Absence notice',
      `${learner.firstName} ${learner.lastName} was marked absent on ${record.date}.`);
  }
  const duplicatesIgnored = saved.filter((record) => record.duplicate).length;
  if (duplicatesIgnored) {
    return send(res, 200, { records: saved, duplicatesIgnored },
      'Attendance saved; duplicate learner/date records were ignored.');
  }
  return send(res, 201, { records: saved, duplicatesIgnored: 0 }, 'Attendance saved');
});

app.put('/api/attendance/:id', authenticate, allowRoles('ADMIN', 'TEACHER'), async (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare(
    'SELECT learner_id AS learnerId, class_name AS className, status, attendance_date AS date FROM attendance WHERE id = ?'
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
  if (status === 'ABSENT' && existing.status !== 'ABSENT') {
    const parentIds = db.prepare(
      `SELECT user_id AS id FROM user_learners WHERE learner_id = ?
       AND user_id IN (SELECT id FROM users WHERE role = 'PARENT')`
    ).all(existing.learnerId).map((row) => row.id);
    await notifyUsers(parentIds, 'ABSENCE', 'Absence notice',
      `${learner.firstName} ${learner.lastName} was marked absent on ${existing.date}.`);
  }
  audit(req.user.id, 'ATTENDANCE_UPDATED', 'attendance', { attendanceId: id });
  return send(res, 200, { id, status }, 'Attendance updated');
});

app.get('/api/timetable', authenticate, allowRoles('ADMIN', 'TEACHER', 'PARENT', 'STUDENT', 'STAFF'), (req, res) => {
  const rows = db.prepare(
    `SELECT te.id, te.class_name AS className, te.teacher_id AS teacherId, t.name AS teacher,
      te.day_of_week AS dayOfWeek, te.start_time AS startTime, te.end_time AS endTime,
      te.subject, te.room
     FROM timetable_entries te JOIN teachers t ON t.id = te.teacher_id
     WHERE (? != 'TEACHER' OR EXISTS (
       SELECT 1 FROM teacher_classes tc WHERE tc.teacher_id = ? AND tc.class_name = te.class_name
     ))
       AND (? NOT IN ('PARENT', 'STUDENT') OR EXISTS (
         SELECT 1 FROM user_learners ul JOIN learners l ON l.id = ul.learner_id
         WHERE ul.user_id = ? AND l.class_name = te.class_name AND l.status = 'ACTIVE'
       ))
     ORDER BY te.day_of_week, te.start_time, te.class_name`
  ).all(req.user.role, req.user.teacherId || -1, req.user.role, req.user.id);
  return send(res, 200, rows, 'Timetable retrieved');
});

app.post('/api/timetable', authenticate, allowRoles('ADMIN', 'TEACHER'), (req, res) => {
  const className = cleanText(req.body?.className, 60);
  const teacherId = req.user.role === 'TEACHER' ? req.user.teacherId : Number(req.body?.teacherId);
  const dayOfWeek = Number(req.body?.dayOfWeek);
  const startTime = cleanText(req.body?.startTime, 5);
  const endTime = cleanText(req.body?.endTime, 5);
  const subject = cleanText(req.body?.subject, 100);
  const room = cleanText(req.body?.room, 80);
  const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
  const assignment = db.prepare(
    'SELECT 1 FROM teacher_classes WHERE teacher_id = ? AND class_name = ?'
  ).get(teacherId || -1, className);
  if (!classMatchesGrade(className, Number(db.prepare('SELECT grade FROM classes WHERE class_name = ?').get(className)?.grade))
    || !assignment || !Number.isInteger(dayOfWeek) || dayOfWeek < 1 || dayOfWeek > 5
    || !timePattern.test(startTime) || !timePattern.test(endTime) || startTime >= endTime || !subject) {
    return send(res, 400, null, 'Provide a valid assigned class, teacher, weekday, time, and subject.');
  }
  const conflict = db.prepare(
    `SELECT 1 FROM timetable_entries
     WHERE day_of_week = ? AND start_time < ? AND end_time > ?
       AND (class_name = ? OR teacher_id = ?)`
  ).get(dayOfWeek, endTime, startTime, className, teacherId);
  if (conflict) return send(res, 409, null, 'The class or teacher already has a timetable entry during that time.');
  try {
    const result = db.prepare(
      `INSERT INTO timetable_entries
        (class_name, teacher_id, day_of_week, start_time, end_time, subject, room, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(className, teacherId, dayOfWeek, startTime, endTime, subject, room, req.user.id);
    audit(req.user.id, 'TIMETABLE_ENTRY_CREATED', 'timetable', { timetableId: Number(result.lastInsertRowid) });
    return send(res, 201, { id: Number(result.lastInsertRowid) }, 'Timetable entry created');
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return send(res, 409, null, 'The class or teacher already has a timetable entry starting at that time.');
    }
    throw error;
  }
});

app.delete('/api/timetable/:id', authenticate, allowRoles('ADMIN', 'TEACHER'), (req, res) => {
  const id = Number(req.params.id);
  const entry = db.prepare('SELECT class_name AS className FROM timetable_entries WHERE id = ?').get(id);
  if (!entry) return send(res, 404, null, 'Timetable entry not found.');
  if (req.user.role === 'TEACHER' && !requireAssignedClass(req.user, entry.className)) {
    return send(res, 403, null, 'Teachers can manage only their assigned classes.');
  }
  db.prepare('DELETE FROM timetable_entries WHERE id = ?').run(id);
  audit(req.user.id, 'TIMETABLE_ENTRY_DELETED', 'timetable', { timetableId: id });
  return send(res, 200, { id }, 'Timetable entry removed');
});

app.get('/api/lesson-plans', authenticate, allowRoles('ADMIN', 'TEACHER', 'PARENT', 'STUDENT', 'STAFF'), (req, res) => {
  const rows = db.prepare(
    `SELECT lp.id, lp.class_name AS className, lp.teacher_id AS teacherId, t.name AS teacher,
      lp.lesson_date AS date, lp.subject, lp.title, lp.objectives, lp.plan,
      lp.progress_status AS progressStatus, lp.progress_note AS progressNote
     FROM lesson_plans lp JOIN teachers t ON t.id = lp.teacher_id
     WHERE (? != 'TEACHER' OR EXISTS (
       SELECT 1 FROM teacher_classes tc WHERE tc.teacher_id = ? AND tc.class_name = lp.class_name
     ))
       AND (? NOT IN ('PARENT', 'STUDENT') OR EXISTS (
         SELECT 1 FROM user_learners ul JOIN learners l ON l.id = ul.learner_id
         WHERE ul.user_id = ? AND l.class_name = lp.class_name AND l.status = 'ACTIVE'
       ))
     ORDER BY lp.lesson_date DESC, lp.id DESC`
  ).all(req.user.role, req.user.teacherId || -1, req.user.role, req.user.id);
  return send(res, 200, rows, 'Lesson plans retrieved');
});

app.post('/api/lesson-plans', authenticate, allowRoles('ADMIN', 'TEACHER'), (req, res) => {
  const className = cleanText(req.body?.className, 60);
  const teacherId = req.user.role === 'TEACHER' ? req.user.teacherId : Number(req.body?.teacherId);
  const lessonDate = req.body?.date;
  const subject = cleanText(req.body?.subject, 100);
  const title = cleanText(req.body?.title, 160);
  const objectives = cleanText(req.body?.objectives, 1000);
  const plan = cleanText(req.body?.plan, 3000);
  if (!classMatchesGrade(className, Number(db.prepare('SELECT grade FROM classes WHERE class_name = ?').get(className)?.grade))
    || !requireAssignedClass({ ...req.user, teacherId }, className)
    || !db.prepare('SELECT 1 FROM teachers WHERE id = ? AND status = ?').get(teacherId || -1, 'ACTIVE')
    || !validDate(lessonDate) || !subject || !title) {
    return send(res, 400, null, 'Provide a valid assigned class, teacher, date, subject, and lesson title.');
  }
  const result = db.prepare(
    `INSERT INTO lesson_plans
      (class_name, teacher_id, lesson_date, subject, title, objectives, plan, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(className, teacherId, lessonDate, subject, title, objectives, plan, req.user.id);
  audit(req.user.id, 'LESSON_PLAN_CREATED', 'lesson_plan', { lessonPlanId: Number(result.lastInsertRowid) });
  return send(res, 201, { id: Number(result.lastInsertRowid) }, 'Lesson plan created');
});

app.put('/api/lesson-plans/:id/progress', authenticate, allowRoles('ADMIN', 'TEACHER'), (req, res) => {
  const id = Number(req.params.id);
  const status = cleanText(req.body?.progressStatus, 20).toUpperCase();
  const progressNote = cleanText(req.body?.progressNote, 1000);
  const plan = db.prepare('SELECT class_name AS className FROM lesson_plans WHERE id = ?').get(id);
  if (!plan) return send(res, 404, null, 'Lesson plan not found.');
  if (!['PLANNED', 'IN_PROGRESS', 'COMPLETED'].includes(status)) {
    return send(res, 400, null, 'Choose a valid lesson progress status.');
  }
  if (req.user.role === 'TEACHER' && !requireAssignedClass(req.user, plan.className)) {
    return send(res, 403, null, 'Teachers can update only lesson plans for their assigned classes.');
  }
  db.prepare(
    `UPDATE lesson_plans SET progress_status = ?, progress_note = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  ).run(status, progressNote, id);
  audit(req.user.id, 'LESSON_PROGRESS_UPDATED', 'lesson_plan', { lessonPlanId: id, status });
  return send(res, 200, { id, progressStatus: status }, 'Lesson progress updated');
});

app.get('/api/report-cards', authenticate, allowRoles('ADMIN', 'TEACHER', 'PARENT', 'STUDENT'), (req, res) => {
  const learnerId = Number(req.query.learnerId);
  const startDate = req.query.startDate;
  const endDate = req.query.endDate;
  const term = cleanText(req.query.term, 80);
  const learner = learnerForRole(learnerId, req.user);
  if (!learner || !validDate(startDate) || !validDate(endDate) || startDate > endDate || !term) {
    return send(res, 400, null, 'Select an accessible learner, term, and valid date range.');
  }
  const attendanceSummary = db.prepare(
    `SELECT COUNT(*) AS total,
      SUM(CASE WHEN status IN ('PRESENT', 'LATE') THEN 1 ELSE 0 END) AS attended,
      SUM(CASE WHEN status = 'ABSENT' THEN 1 ELSE 0 END) AS absent,
      SUM(CASE WHEN status = 'LATE' THEN 1 ELSE 0 END) AS late
     FROM attendance WHERE learner_id = ? AND attendance_date BETWEEN ? AND ?`
  ).get(learnerId, startDate, endDate);
  const records = db.prepare(
    `SELECT a.id, a.subject, a.strand, a.sub_strand AS subStrand, a.competency,
      a.level, a.comment, a.assessment_date AS date, t.name AS teacher
     FROM assessments a JOIN teachers t ON t.id = a.teacher_id
     WHERE a.learner_id = ? AND a.term = ? AND a.assessment_date BETWEEN ? AND ?
     ORDER BY a.subject, a.strand, a.assessment_date`
  ).all(learnerId, term, startDate, endDate);
  const comment = db.prepare(
    `SELECT rc.comment, t.name AS teacher, rc.updated_at AS updatedAt
     FROM report_comments rc JOIN teachers t ON t.id = rc.teacher_id
     WHERE rc.learner_id = ? AND rc.term = ?`
  ).get(learnerId, term) || null;
  audit(req.user.id, 'REPORT_CARD_VIEWED', 'report_card', { learnerId, term });
  return send(res, 200, {
    learner,
    term,
    startDate,
    endDate,
    attendance: {
      total: attendanceSummary.total,
      attended: attendanceSummary.attended || 0,
      absent: attendanceSummary.absent || 0,
      late: attendanceSummary.late || 0,
      rate: attendanceSummary.total
        ? Math.round(100 * (attendanceSummary.attended || 0) / attendanceSummary.total)
        : 0
    },
    assessments: records,
    teacherComment: comment
  }, 'Report card retrieved');
});

app.put('/api/report-cards/:learnerId/comment', authenticate, allowRoles('ADMIN', 'TEACHER'), async (req, res) => {
  const learnerId = Number(req.params.learnerId);
  const term = cleanText(req.body?.term, 80);
  const comment = cleanText(req.body?.comment, 1500);
  const learner = learnerForRole(learnerId, req.user);
  const teacherId = req.user.role === 'TEACHER' ? req.user.teacherId : Number(req.body?.teacherId);
  const teacherAssigned = db.prepare(
    'SELECT 1 FROM teacher_classes WHERE teacher_id = ? AND class_name = ?'
  ).get(teacherId || -1, learner?.className || '');
  if (!learner || !term || !comment
    || !teacherAssigned
    || !db.prepare('SELECT 1 FROM teachers WHERE id = ? AND status = ?').get(teacherId || -1, 'ACTIVE')) {
    return send(res, 400, null, 'Provide an accessible learner, valid term, teacher, and comment.');
  }
  db.prepare(
    `INSERT INTO report_comments (learner_id, term, teacher_id, comment)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(learner_id, term) DO UPDATE SET
       teacher_id = excluded.teacher_id, comment = excluded.comment, updated_at = CURRENT_TIMESTAMP`
  ).run(learnerId, term, teacherId, comment);
  const parentIds = db.prepare(
    `SELECT user_id AS id FROM user_learners WHERE learner_id = ?
     AND user_id IN (SELECT id FROM users WHERE role = 'PARENT')`
  ).all(learnerId).map((row) => row.id);
  await notifyUsers(parentIds, 'PROGRESS', 'Learning progress updated', `${learner.firstName} ${learner.lastName}'s ${term} report comment is available.`);
  audit(req.user.id, 'REPORT_COMMENT_UPDATED', 'report_card', { learnerId, term });
  return send(res, 200, { learnerId, term }, 'Report comment saved and parents notified');
});

app.get('/api/notifications', authenticate, (req, res) => {
  const rows = db.prepare(
    `SELECT n.id, n.type, n.title, n.message, n.read_at AS readAt, n.created_at AS createdAt,
      sd.status AS smsStatus
     FROM notifications n LEFT JOIN sms_deliveries sd ON sd.notification_id = n.id
     WHERE n.user_id = ? ORDER BY n.created_at DESC, n.id DESC LIMIT 100`
  ).all(req.user.id).map((row) => ({ ...row, read: Boolean(row.readAt) }));
  return send(res, 200, rows, 'Notifications retrieved');
});

app.patch('/api/notifications/:id/read', authenticate, (req, res) => {
  const id = Number(req.params.id);
  const result = db.prepare(
    'UPDATE notifications SET read_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?'
  ).run(id, req.user.id);
  if (!result.changes) return send(res, 404, null, 'Notification not found.');
  return send(res, 200, { id, read: true }, 'Notification marked as read');
});

app.patch('/api/notifications/read-all', authenticate, (req, res) => {
  db.prepare('UPDATE notifications SET read_at = CURRENT_TIMESTAMP WHERE user_id = ? AND read_at IS NULL')
    .run(req.user.id);
  return send(res, 200, { read: true }, 'All notifications marked as read');
});

app.put('/api/me/phone', authenticate, allowRoles('PARENT'), (req, res) => {
  const phone = cleanText(req.body?.phone, 20);
  const smsOptIn = req.body?.smsOptIn === true;
  if ((phone && !validPhone(phone)) || (smsOptIn && !phone)) {
    return send(res, 400, null, 'Use an international phone number such as +254712345678; a number is required to opt in.');
  }
  db.prepare('UPDATE users SET phone = ?, sms_opt_in = ? WHERE id = ?')
    .run(phone, Number(smsOptIn), req.user.id);
  audit(req.user.id, 'PARENT_NOTIFICATION_PREFERENCES_UPDATED', 'user');
  return send(res, 200, { phone, smsOptIn }, 'Notification preferences updated');
});

app.post('/api/announcements', authenticate, allowRoles('ADMIN'), async (req, res) => {
  const title = cleanText(req.body?.title, 160);
  const message = cleanText(req.body?.message, 1200);
  const priority = cleanText(req.body?.priority || 'Normal', 20);
  if (!title || !message || !['Low', 'Normal', 'High'].includes(priority)) {
    return send(res, 400, null, 'Provide an announcement title, message, and valid priority.');
  }
  const result = db.prepare(
    `INSERT INTO school_announcements (title, message, priority, created_by)
     VALUES (?, ?, ?, ?)`
  ).run(title, message, priority, req.user.id);
  const parentIds = db.prepare(
    "SELECT id FROM users WHERE role = 'PARENT' AND status = 'ACTIVE'"
  ).all().map((row) => row.id);
  await notifyUsers(parentIds, 'ANNOUNCEMENT', title, message);
  audit(req.user.id, 'ANNOUNCEMENT_CREATED', 'announcement', { announcementId: Number(result.lastInsertRowid) });
  return send(res, 201, { id: Number(result.lastInsertRowid) }, 'Announcement published and parents notified');
});

app.get('/api/wellbeing', authenticate, allowRoles('ADMIN', 'TEACHER'), (req, res) => {
  const rows = db.prepare(
    `SELECT wc.id, wc.learner_id AS learnerId, l.first_name || ' ' || l.last_name AS learner,
      l.class_name AS className, wc.category, wc.concern, wc.follow_up AS followUp, wc.status,
      wc.created_at AS createdAt, wc.updated_at AS updatedAt,
      reporter.name AS reportedBy, updater.name AS updatedBy
     FROM wellbeing_cases wc JOIN learners l ON l.id = wc.learner_id
     JOIN users reporter ON reporter.id = wc.created_by
     JOIN users updater ON updater.id = wc.updated_by
     WHERE (? = 'ADMIN' OR EXISTS (
       SELECT 1 FROM teacher_classes tc WHERE tc.teacher_id = ? AND tc.class_name = l.class_name
     ))
     ORDER BY wc.updated_at DESC, wc.id DESC`
  ).all(req.user.role, req.user.teacherId || -1);
  rows.forEach((row) => audit(req.user.id, 'WELLBEING_CASE_ACCESSED', 'wellbeing_case', { caseId: row.id }));
  return send(res, 200, rows, 'Confidential learner support records retrieved');
});

app.post('/api/wellbeing', authenticate, allowRoles('ADMIN', 'TEACHER'), (req, res) => {
  const learnerId = Number(req.body?.learnerId);
  const learner = learnerForRole(learnerId, req.user);
  const category = cleanText(req.body?.category, 30).toUpperCase();
  const concern = cleanText(req.body?.concern, 2000);
  if (!learner || !['SAFETY', 'WELLBEING', 'LEARNING', 'OTHER'].includes(category) || !concern) {
    return send(res, 400, null, 'Select an assigned learner and provide a valid concern category and description.');
  }
  const result = db.prepare(
    `INSERT INTO wellbeing_cases
      (learner_id, category, concern, created_by, updated_by)
     VALUES (?, ?, ?, ?, ?)`
  ).run(learnerId, category, concern, req.user.id, req.user.id);
  audit(req.user.id, 'WELLBEING_CASE_CREATED', 'wellbeing_case', { caseId: Number(result.lastInsertRowid), learnerId });
  return send(res, 201, { id: Number(result.lastInsertRowid), status: 'OPEN' }, 'Confidential support record created');
});

app.put('/api/wellbeing/:id', authenticate, allowRoles('ADMIN', 'TEACHER'), (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare(
    `SELECT wc.learner_id AS learnerId, l.class_name AS className
     FROM wellbeing_cases wc JOIN learners l ON l.id = wc.learner_id WHERE wc.id = ?`
  ).get(id);
  if (!existing) return send(res, 404, null, 'Support record not found.');
  if (req.user.role === 'TEACHER' && !requireAssignedClass(req.user, existing.className)) {
    return send(res, 403, null, 'Teachers can access support records only for their assigned classes.');
  }
  const status = cleanText(req.body?.status, 20).toUpperCase();
  const followUp = cleanText(req.body?.followUp, 2000);
  if (!['OPEN', 'FOLLOW_UP', 'RESOLVED'].includes(status)) {
    return send(res, 400, null, 'Choose a valid follow-up status.');
  }
  db.prepare(
    `UPDATE wellbeing_cases SET status = ?, follow_up = ?, updated_by = ?,
      updated_at = CURRENT_TIMESTAMP WHERE id = ?`
  ).run(status, followUp, req.user.id, id);
  audit(req.user.id, 'WELLBEING_CASE_UPDATED', 'wellbeing_case', { caseId: id, status });
  return send(res, 200, { id, status }, 'Support follow-up updated');
});

app.get('/api/inventory', authenticate, allowRoles('ADMIN', 'TEACHER', 'STAFF'), (req, res) => {
  const items = db.prepare(
    `SELECT id, name, category, identifier, location, quantity,
      available_count AS availableCount, status
     FROM inventory_items ORDER BY category, name`
  ).all();
  return send(res, 200, items, 'Library and inventory retrieved');
});

app.post('/api/inventory', authenticate, allowRoles('ADMIN', 'STAFF'), (req, res) => {
  const name = cleanText(req.body?.name, 160);
  const category = cleanText(req.body?.category, 20).toUpperCase();
  const identifier = cleanText(req.body?.identifier, 100);
  const location = cleanText(req.body?.location, 120);
  const quantity = Number(req.body?.quantity);
  if (!name || !['BOOK', 'SUPPLY', 'EQUIPMENT'].includes(category)
    || !Number.isInteger(quantity) || quantity < 0 || quantity > 100000) {
    return send(res, 400, null, 'Provide a name, valid item category, and quantity.');
  }
  const result = db.prepare(
    `INSERT INTO inventory_items
      (name, category, identifier, location, quantity, available_count, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(name, category, identifier, location, quantity, quantity, req.user.id);
  audit(req.user.id, 'INVENTORY_ITEM_CREATED', 'inventory', { itemId: Number(result.lastInsertRowid) });
  return send(res, 201, { id: Number(result.lastInsertRowid) }, 'Inventory item added');
});

app.put('/api/inventory/:id', authenticate, allowRoles('ADMIN', 'STAFF'), (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare(
    'SELECT category, quantity, available_count AS availableCount FROM inventory_items WHERE id = ?'
  ).get(id);
  if (!existing) return send(res, 404, null, 'Inventory item not found.');
  const name = cleanText(req.body?.name, 160);
  const category = cleanText(req.body?.category, 20).toUpperCase();
  const identifier = cleanText(req.body?.identifier, 100);
  const location = cleanText(req.body?.location, 120);
  const quantity = Number(req.body?.quantity);
  const status = cleanText(req.body?.status, 20).toUpperCase();
  const openLoans = db.prepare(
    'SELECT COUNT(*) AS count FROM library_loans WHERE inventory_item_id = ? AND returned_at IS NULL'
  ).get(id).count;
  if (!name || !['BOOK', 'SUPPLY', 'EQUIPMENT'].includes(category)
    || !Number.isInteger(quantity) || quantity < openLoans || quantity > 100000
    || !['ACTIVE', 'INACTIVE'].includes(status)
    || (openLoans > 0 && existing.category === 'BOOK' && category !== 'BOOK')) {
    return send(res, 400, null, 'Provide valid inventory details; stock cannot be less than active loans or change category while books are on loan.');
  }
  db.prepare(
    `UPDATE inventory_items SET name = ?, category = ?, identifier = ?, location = ?,
      quantity = ?, available_count = ?, status = ? WHERE id = ?`
  ).run(name, category, identifier, location, quantity, quantity - openLoans, status, id);
  audit(req.user.id, 'INVENTORY_ITEM_UPDATED', 'inventory', { itemId: id });
  return send(res, 200, { id, quantity, availableCount: quantity - openLoans, status }, 'Inventory item updated');
});

app.get('/api/library/loans', authenticate, allowRoles('ADMIN', 'TEACHER', 'STAFF', 'PARENT', 'STUDENT'), (req, res) => {
  const rows = db.prepare(
    `SELECT ll.id, ll.inventory_item_id AS itemId, ii.name AS item, ll.learner_id AS learnerId,
      l.first_name || ' ' || l.last_name AS learner, l.class_name AS className,
      ll.checkout_date AS checkoutDate, ll.due_date AS dueDate, ll.returned_at AS returnedAt
     FROM library_loans ll JOIN inventory_items ii ON ii.id = ll.inventory_item_id
     JOIN learners l ON l.id = ll.learner_id
     WHERE (? NOT IN ('PARENT', 'STUDENT') OR EXISTS (
       SELECT 1 FROM user_learners ul WHERE ul.user_id = ? AND ul.learner_id = l.id
     ))
       AND (? != 'TEACHER' OR EXISTS (
         SELECT 1 FROM teacher_classes tc WHERE tc.teacher_id = ? AND tc.class_name = l.class_name
       ))
     ORDER BY ll.returned_at IS NOT NULL, ll.due_date, ll.id DESC`
  ).all(req.user.role, req.user.id, req.user.role, req.user.teacherId || -1);
  return send(res, 200, rows, 'Library loans retrieved');
});

app.post('/api/library/loans', authenticate, allowRoles('ADMIN', 'STAFF'), (req, res) => {
  const itemId = Number(req.body?.itemId);
  const learnerId = Number(req.body?.learnerId);
  const checkoutDate = req.body?.checkoutDate;
  const dueDate = req.body?.dueDate;
  const item = db.prepare(
    `SELECT id, available_count AS availableCount FROM inventory_items
     WHERE id = ? AND category = 'BOOK' AND status = 'ACTIVE'`
  ).get(itemId);
  const learner = db.prepare("SELECT id FROM learners WHERE id = ? AND status = 'ACTIVE'").get(learnerId);
  if (!item || !learner || !validDate(checkoutDate) || !validDate(dueDate) || dueDate < checkoutDate) {
    return send(res, 400, null, 'Select an active book and learner with a valid checkout and due date.');
  }
  db.exec('BEGIN IMMEDIATE');
  try {
    const update = db.prepare(
      `UPDATE inventory_items SET available_count = available_count - 1
       WHERE id = ? AND available_count > 0`
    ).run(itemId);
    if (!update.changes) {
      db.exec('ROLLBACK');
      return send(res, 409, null, 'No copies of this book are currently available.');
    }
    const result = db.prepare(
      `INSERT INTO library_loans
        (inventory_item_id, learner_id, checked_out_by, checkout_date, due_date)
       VALUES (?, ?, ?, ?, ?)`
    ).run(itemId, learnerId, req.user.id, checkoutDate, dueDate);
    audit(req.user.id, 'LIBRARY_BOOK_CHECKED_OUT', 'library_loan', { loanId: Number(result.lastInsertRowid) });
    db.exec('COMMIT');
    return send(res, 201, { id: Number(result.lastInsertRowid) }, 'Book checked out');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
});

app.put('/api/library/loans/:id/return', authenticate, allowRoles('ADMIN', 'STAFF'), (req, res) => {
  const id = Number(req.params.id);
  db.exec('BEGIN IMMEDIATE');
  try {
    const loan = db.prepare(
      `SELECT inventory_item_id AS itemId FROM library_loans
       WHERE id = ? AND returned_at IS NULL`
    ).get(id);
    if (!loan) {
      db.exec('ROLLBACK');
      return send(res, 404, null, 'Open library loan not found.');
    }
    db.prepare('UPDATE library_loans SET returned_at = CURRENT_TIMESTAMP WHERE id = ?').run(id);
    db.prepare(
      'UPDATE inventory_items SET available_count = available_count + 1 WHERE id = ?'
    ).run(loan.itemId);
    audit(req.user.id, 'LIBRARY_BOOK_RETURNED', 'library_loan', { loanId: id });
    db.exec('COMMIT');
    return send(res, 200, { id, returned: true }, 'Book returned');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
});

app.get('/api/reports/summary', authenticate, allowRoles('ADMIN'), (req, res) => {
  const days = Number(req.query.days || 30);
  if (!Number.isInteger(days) || days < 1 || days > 365) {
    return send(res, 400, null, 'Report period must be between 1 and 365 days.');
  }
  const attendanceTrend = db.prepare(
    `SELECT attendance_date AS date, COUNT(*) AS total,
      SUM(CASE WHEN status IN ('PRESENT', 'LATE') THEN 1 ELSE 0 END) AS attended,
      ROUND(100.0 * SUM(CASE WHEN status IN ('PRESENT', 'LATE') THEN 1 ELSE 0 END)
        / NULLIF(COUNT(*), 0), 0) AS rate
     FROM attendance WHERE attendance_date >= date('now', ?)
     GROUP BY attendance_date ORDER BY attendance_date`
  ).all(`-${days} days`);
  const followUp = db.prepare(
    `SELECT l.id AS learnerId, l.first_name || ' ' || l.last_name AS learner,
      l.class_name AS className, l.grade,
      COUNT(a.id) AS attendanceRecords,
      COALESCE(ROUND(100.0 * SUM(CASE WHEN a.status IN ('PRESENT', 'LATE') THEN 1 ELSE 0 END)
        / NULLIF(COUNT(a.id), 0), 0), 0) AS attendanceRate,
      SUM(CASE WHEN a.status = 'ABSENT' THEN 1 ELSE 0 END) AS absences,
      (SELECT COUNT(*) FROM assessments ax
      WHERE ax.learner_id = l.id AND ax.level = 'BE'
        AND ax.assessment_date >= date('now', ?)) AS beginningLevels
     FROM learners l LEFT JOIN attendance a ON a.learner_id = l.id
       AND a.attendance_date >= date('now', ?)
     WHERE l.status = 'ACTIVE'
     GROUP BY l.id
     HAVING (COUNT(a.id) >= 3 AND attendanceRate < 85) OR beginningLevels > 0
     ORDER BY attendanceRate, beginningLevels DESC, learner`
  ).all(`-${days} days`, `-${days} days`);
  const byClass = db.prepare(
    `SELECT l.class_name AS className, l.grade, COUNT(*) AS learners,
      (SELECT COUNT(*) FROM attendance a
       JOIN learners la ON la.id = a.learner_id
       WHERE la.class_name = l.class_name AND la.status = 'ACTIVE'
         AND a.attendance_date >= date('now', ?)) AS attendanceRecords,
      COALESCE((SELECT ROUND(100.0 * SUM(CASE WHEN a.status IN ('PRESENT', 'LATE') THEN 1 ELSE 0 END)
        / NULLIF(COUNT(*), 0), 0) FROM attendance a
        JOIN learners la ON la.id = a.learner_id
        WHERE la.class_name = l.class_name AND la.status = 'ACTIVE'
          AND a.attendance_date >= date('now', ?)), 0) AS attendanceRate,
      (SELECT COUNT(*) FROM assessments ax JOIN learners la ON la.id = ax.learner_id
       WHERE la.class_name = l.class_name AND la.status = 'ACTIVE'
         AND ax.assessment_date >= date('now', ?)) AS assessments,
      (SELECT COUNT(*) FROM assessments ax JOIN learners la ON la.id = ax.learner_id
       WHERE la.class_name = l.class_name AND la.status = 'ACTIVE' AND ax.level = 'BE'
         AND ax.assessment_date >= date('now', ?)) AS beginningLevels
     FROM learners l
     WHERE l.status = 'ACTIVE'
     GROUP BY l.class_name, l.grade ORDER BY l.grade, l.class_name`
  ).all(`-${days} days`, `-${days} days`, `-${days} days`, `-${days} days`);
  const progressByTerm = db.prepare(
    `SELECT l.class_name AS className, l.grade, a.term, COUNT(*) AS assessments,
      SUM(CASE WHEN a.level = 'EE' THEN 1 ELSE 0 END) AS exceeds,
      SUM(CASE WHEN a.level = 'ME' THEN 1 ELSE 0 END) AS meets,
      SUM(CASE WHEN a.level = 'AE' THEN 1 ELSE 0 END) AS approaching,
      SUM(CASE WHEN a.level = 'BE' THEN 1 ELSE 0 END) AS beginning
     FROM assessments a JOIN learners l ON l.id = a.learner_id
     WHERE l.status = 'ACTIVE' AND a.assessment_date >= date('now', ?)
     GROUP BY l.class_name, l.grade, a.term
     ORDER BY l.grade, l.class_name, a.term`
  ).all(`-${days} days`);
  return send(res, 200, {
    days, attendanceTrend, followUp, byClass, progressByTerm
  }, 'Administrative reports retrieved');
});

function csvEscape(value) {
  let text = String(value ?? '');
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

app.get('/api/exports/:type.csv', authenticate, allowRoles('ADMIN', 'TEACHER', 'PARENT', 'STUDENT', 'STAFF'), (req, res) => {
  const type = cleanText(req.params.type, 30);
  const where = [];
  const params = [];
  if (['PARENT', 'STUDENT'].includes(req.user.role)) {
    where.push('EXISTS (SELECT 1 FROM user_learners ul WHERE ul.user_id = ? AND ul.learner_id = l.id)');
    params.push(req.user.id);
  } else if (req.user.role === 'TEACHER') {
    where.push('EXISTS (SELECT 1 FROM teacher_classes tc WHERE tc.teacher_id = ? AND tc.class_name = l.class_name)');
    params.push(req.user.teacherId || -1);
  }
  if (req.user.role !== 'ADMIN') where.push("l.status = 'ACTIVE'");
  let rows;
  if (type === 'learners') {
    rows = db.prepare(
      `SELECT l.id, l.first_name || ' ' || l.last_name AS learner, l.grade, l.class_name AS className,
        l.stream, l.status FROM learners l ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY l.grade, l.class_name, l.last_name`
    ).all(...params);
  } else if (type === 'attendance' || type === 'assessments') {
    const baseTable = type === 'attendance' ? 'attendance a' : 'assessments a';
    const dateColumn = type === 'attendance' ? 'a.attendance_date' : 'a.assessment_date';
    const select = type === 'attendance'
      ? `${dateColumn} AS date, l.first_name || ' ' || l.last_name AS learner, a.class_name AS className, a.status`
      : `${dateColumn} AS date, l.first_name || ' ' || l.last_name AS learner, l.class_name AS className, a.subject, a.strand, a.level, a.term, a.comment`;
    const joins = type === 'attendance' ? 'JOIN learners l ON l.id = a.learner_id'
      : 'JOIN learners l ON l.id = a.learner_id';
    rows = db.prepare(
      `SELECT ${select} FROM ${baseTable} ${joins}
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY ${dateColumn} DESC, learner`
    ).all(...params);
  } else {
    return send(res, 400, null, 'Export type must be learners, attendance, or assessments.');
  }
  const columns = rows.length ? Object.keys(rows[0]) : type === 'learners'
    ? ['id', 'learner', 'grade', 'className', 'stream', 'status']
    : type === 'attendance'
      ? ['date', 'learner', 'className', 'status']
      : ['date', 'learner', 'className', 'subject', 'strand', 'level', 'term', 'comment'];
  const csv = [columns.map(csvEscape).join(','), ...rows.map((row) => columns.map((column) => csvEscape(row[column])).join(','))].join('\r\n');
  audit(req.user.id, 'DATA_EXPORTED', type, { rowCount: rows.length });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="cheleta-${type}-${today()}.csv"`);
  return res.send(`\uFEFF${csv}`);
});

app.get('/api/admin/backup', authenticate, allowRoles('ADMIN'), (req, res) => {
  audit(req.user.id, 'DATABASE_BACKUP_DOWNLOADED', 'database');
  res.setHeader('Content-Type', 'application/vnd.sqlite3');
  res.setHeader('Content-Disposition', `attachment; filename="cheleta-backup-${today()}.sqlite"`);
  return res.send(Buffer.from(db.serialize()));
});

app.get('/api/resources', authenticate, (req, res) => send(res, 200, resources, 'Resources retrieved'));
app.get('/api/announcements', authenticate, (req, res) => {
  const savedAnnouncements = db.prepare(
    `SELECT id, title, message, priority, created_at AS createdAt
     FROM school_announcements ORDER BY created_at DESC, id DESC`
  ).all();
  return send(res, 200, [...savedAnnouncements, ...announcements], 'Announcements retrieved');
});
app.get('/api/impact', authenticate, allowRoles('ADMIN'), (req, res) => {
  const learnerCount = db.prepare("SELECT COUNT(*) AS count FROM learners WHERE status = 'ACTIVE'").get().count;
  const teacherCount = db.prepare("SELECT COUNT(*) AS count FROM teachers WHERE status = 'ACTIVE'").get().count;
  const assessmentCount = db.prepare('SELECT COUNT(*) AS count FROM assessments').get().count;
  return send(res, 200, [
    { label: 'Learners reached', value: learnerCount, caption: 'Active learner profiles' },
    { label: 'Teachers supported', value: teacherCount, caption: 'Active staff profiles' },
    { label: 'Assessments recorded', value: assessmentCount, caption: 'Recorded assessments' }
  ], 'School impact retrieved');
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
