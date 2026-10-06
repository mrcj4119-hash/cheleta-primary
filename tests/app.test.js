import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

process.env.CHELETA_DB_PATH = ':memory:';
process.env.JWT_SECRET = 'test-only-signing-secret';

const { app } = await import('../server.js');
const { db } = await import('../database.js');
let server;
let baseUrl;
const tokens = {};

before(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

async function request(path, { role, token, method = 'GET', body } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(role ? { 'Content-Type': 'application/json' } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  return { response, json: await response.json() };
}

test('health endpoint reports SQLite-backed API', async () => {
  const { response, json } = await request('/api/health');
  assert.equal(response.status, 200);
  assert.equal(json.data.storage, 'sqlite');
});

test('student and board migrations preserve valid database relationships', () => {
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  const roleConstraint = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'users'").get().sql;
  assert.ok(roleConstraint.includes("'STUDENT'"));
  assert.ok(roleConstraint.includes("'BOARD'"));
});

test('unknown API routes return a user-friendly message', async () => {
  const { response, json } = await request('/api/unknown-route');
  assert.equal(response.status, 404);
  assert.equal(json.message, 'This feature is temporarily unavailable. Please refresh the page and try again.');
  assert.ok(!json.message.includes('The requested API route was not found.'));
});

test('login rejects invalid credentials and protects private routes', async () => {
  const invalid = await request('/api/login', {
    role: 'ADMIN',
    method: 'POST',
    body: { email: 'admin@cheleta.test', password: 'wrong', role: 'ADMIN' }
  });
  assert.equal(invalid.response.status, 401);

  const protectedResponse = await request('/api/learners');
  assert.equal(protectedResponse.response.status, 401);

  for (const [role, email, password] of [
    ['ADMIN', 'admin@cheleta.test', 'admin123'],
    ['TEACHER', 'teacher@cheleta.test', 'teacher123'],
    ['PARENT', 'parent@cheleta.test', 'parent123'],
    ['CSR_PARTNER', 'csr@cheleta.test', 'csr123']
  ]) {
    const login = await request('/api/login', {
      method: 'POST',
      body: { email, password, role }
    });
    assert.equal(login.response.status, 200);
    tokens[role] = login.json.data.token;
  }
});

test('the three seeded student demo accounts sign in to separate learner records', async () => {
  const studentAccounts = [
    ['student@cheleta.test', 'Amina Otieno'],
    ['student2@cheleta.test', 'Daniel Kibet'],
    ['student3@cheleta.test', 'Faith Wanjiku']
  ];
  const linkedNames = [];
  for (const [email, expectedName] of studentAccounts) {
    const login = await request('/api/login', {
      method: 'POST',
      body: { email, password: 'student123', role: 'STUDENT' }
    });
    assert.equal(login.response.status, 200);
    const learners = await request('/api/learners', { token: login.json.data.token });
    assert.deepEqual(learners.json.data.map((learner) => learner.name), [expectedName]);
    linkedNames.push(learners.json.data[0].name);
  }
  assert.equal(new Set(linkedNames).size, studentAccounts.length);
});

test('admins manage learners and teachers can register only in assigned classes', async () => {
  const created = await request('/api/learners', {
    token: tokens.ADMIN,
    method: 'POST',
    body: { firstName: 'Demo', lastName: 'Learner', grade: 4, className: 'Grade 4B', stream: 'B' }
  });
  assert.equal(created.response.status, 201);
  const learnerId = created.json.data.id;

  const updated = await request(`/api/learners/${learnerId}`, {
    token: tokens.ADMIN,
    method: 'PUT',
    body: { firstName: 'Demo', lastName: 'Learner', grade: 4, className: 'Grade 4B', stream: 'A' }
  });
  assert.equal(updated.response.status, 200);
  assert.equal(updated.json.data.stream, 'A');

  const archived = await request(`/api/learners/${learnerId}`, {
    token: tokens.ADMIN,
    method: 'DELETE'
  });
  assert.equal(archived.response.status, 200);
  assert.equal(archived.json.data.status, 'INACTIVE');

  const visibleToAdmin = await request('/api/learners', { token: tokens.ADMIN });
  assert.equal(visibleToAdmin.json.data.find((learner) => learner.id === learnerId).status, 'INACTIVE');

  const archivedAttendance = await request('/api/attendance', {
    token: tokens.ADMIN,
    method: 'POST',
    body: { records: [{ learnerId, status: 'PRESENT', date: '2026-10-01', clientRecordId: 'archived-learner-attendance' }] }
  });
  assert.equal(archivedAttendance.response.status, 400);

  const restored = await request(`/api/learners/${learnerId}`, {
    token: tokens.ADMIN,
    method: 'PUT',
    body: { firstName: 'Demo', lastName: 'Learner', grade: 4, className: 'Grade 4B', stream: 'A', status: 'ACTIVE' }
  });
  assert.equal(restored.response.status, 200);
  assert.equal(restored.json.data.status, 'ACTIVE');

  const teacherCreated = await request('/api/learners', {
    token: tokens.TEACHER,
    method: 'POST',
    body: { firstName: 'Teacher', lastName: 'Registered', grade: 5, className: 'Grade 5A' }
  });
  assert.equal(teacherCreated.response.status, 201);

  const outsideAssignedClass = await request('/api/learners', {
    token: tokens.TEACHER,
    method: 'POST',
    body: { firstName: 'No', lastName: 'Access', grade: 1, className: 'Grade 1A' }
  });
  assert.equal(outsideAssignedClass.response.status, 403);

  const denied = await request('/api/learners', {
    token: tokens.CSR_PARTNER,
    method: 'POST',
    body: { firstName: 'No', lastName: 'Access', grade: 1, className: 'Grade 1A' }
  });
  assert.equal(denied.response.status, 403);
});

test('teacher management is restricted to admins', async () => {
  const created = await request('/api/teachers', {
    token: tokens.ADMIN,
    method: 'POST',
    body: { name: 'Demo Teacher', email: 'demo.teacher@cheleta.test', password: 'demoPass123', classes: ['Grade 5A'] }
  });
  assert.equal(created.response.status, 201);

  const teacherLogin = await request('/api/login', {
    method: 'POST',
    body: { email: 'demo.teacher@cheleta.test', password: 'demoPass123', role: 'TEACHER' }
  });
  assert.equal(teacherLogin.response.status, 200);

  const updated = await request(`/api/teachers/${created.json.data.id}`, {
    token: tokens.ADMIN,
    method: 'PUT',
    body: {
      name: 'Demo Teacher Updated',
      email: 'demo.teacher.updated@cheleta.test',
      classes: ['Grade 6A']
    }
  });
  assert.equal(updated.response.status, 200);
  assert.equal(updated.json.data.name, 'Demo Teacher Updated');

  const deactivated = await request(`/api/teachers/${created.json.data.id}`, {
    token: tokens.ADMIN,
    method: 'PUT',
    body: {
      name: 'Demo Teacher Updated',
      email: 'demo.teacher.updated@cheleta.test',
      status: 'INACTIVE',
      classes: ['Grade 6A']
    }
  });
  assert.equal(deactivated.response.status, 200);
  const oldSession = await request('/api/me', { token: teacherLogin.json.data.token });
  assert.equal(oldSession.response.status, 401);
  const deleted = await request(`/api/teachers/${created.json.data.id}`, {
    token: tokens.ADMIN,
    method: 'DELETE'
  });
  assert.equal(deleted.response.status, 409);

  const secondTeacher = await request('/api/teachers', {
    token: tokens.ADMIN,
    method: 'POST',
    body: { name: 'Teacher to Deactivate', email: 'teacher.deactivate@cheleta.test', password: 'demoPass456' }
  });
  const deactivatedByDelete = await request(`/api/teachers/${secondTeacher.json.data.id}`, {
    token: tokens.ADMIN,
    method: 'DELETE'
  });
  assert.equal(deactivatedByDelete.response.status, 200);

  const denied = await request('/api/teachers', { token: tokens.TEACHER });
  assert.equal(denied.response.status, 403);
});

test('teachers see and change attendance only for assigned classes', async () => {
  const teacherLearners = await request('/api/learners', { token: tokens.TEACHER });
  assert.equal(teacherLearners.json.data.length, 12);
  assert.ok(teacherLearners.json.data.every((learner) => ['Grade 5A', 'Grade 6A', 'Grade 7C'].includes(learner.className)));

  const forbiddenAssessment = await request('/api/assessments', {
    token: tokens.TEACHER,
    method: 'POST',
    body: {
      learnerId: 2,
      subject: 'Science',
      strand: 'Living things',
      subStrand: 'Plants',
      competency: 'Recognizes plants',
      level: 'ME',
      term: 'Term 1',
      date: '2026-10-01'
    }
  });
  assert.equal(forbiddenAssessment.response.status, 400);
});

test('admins manage classes and Grade 9 learners; classes with records are retained', async () => {
  const addedClass = await request('/api/classes', {
    token: tokens.ADMIN,
    method: 'POST',
    body: { className: 'Grade 9B', grade: 9 }
  });
  assert.equal(addedClass.response.status, 201);

  const juniorClasses = await request('/api/classes', { token: tokens.ADMIN });
  assert.ok(juniorClasses.json.data.some((item) => item.className === 'Grade 9A' && item.grade === 9));
  assert.ok(juniorClasses.json.data.some((item) => item.className === 'Grade 9B' && item.grade === 9));

  const createdLearner = await request('/api/learners', {
    token: tokens.ADMIN,
    method: 'POST',
    body: { firstName: 'Junior', lastName: 'Learner', grade: 9, className: 'Grade 9B' }
  });
  assert.equal(createdLearner.response.status, 201);

  const mismatch = await request('/api/learners', {
    token: tokens.ADMIN,
    method: 'POST',
    body: { firstName: 'Wrong', lastName: 'Grade', grade: 8, className: 'Grade 9B' }
  });
  assert.equal(mismatch.response.status, 400);

  const protectedClass = await request('/api/classes/Grade%209B', {
    token: tokens.ADMIN,
    method: 'DELETE'
  });
  assert.equal(protectedClass.response.status, 409);

  const teacherCreateClass = await request('/api/classes', {
    token: tokens.TEACHER,
    method: 'POST',
    body: { className: 'Grade 9C', grade: 9 }
  });
  assert.equal(teacherCreateClass.response.status, 403);
});

test('parents see linked learner data only and CSR accounts cannot access learner records', async () => {
  const parentData = await request('/api/learners', { token: tokens.PARENT });
  assert.equal(parentData.response.status, 200);
  assert.deepEqual(parentData.json.data.map((learner) => learner.name), ['Amina Otieno']);

  const csrLearners = await request('/api/learners', { token: tokens.CSR_PARTNER });
  assert.equal(csrLearners.response.status, 403);
  const csrImpact = await request('/api/impact', { token: tokens.CSR_PARTNER });
  assert.equal(csrImpact.response.status, 200);

  const parentIdorAssessments = await request('/api/assessments?learnerId=2', { token: tokens.PARENT });
  assert.deepEqual(parentIdorAssessments.json.data, []);
  const parentIdorAttendance = await request('/api/attendance?learnerId=2', { token: tokens.PARENT });
  assert.deepEqual(parentIdorAttendance.json.data, []);
});

test('parents can submit one comment per linked learner and admins can see every comment', async () => {
  const linkedLearner = (await request('/api/learners', { token: tokens.PARENT })).json.data[0];
  const submitted = await request('/api/parent-comments', {
    token: tokens.PARENT,
    method: 'POST',
    body: { learnerId: linkedLearner.id, comment: 'Please share reading practice for home.' }
  });
  assert.equal(submitted.response.status, 201);

  const duplicate = await request('/api/parent-comments', {
    token: tokens.PARENT,
    method: 'POST',
    body: { learnerId: linkedLearner.id, comment: 'A second comment should be rejected.' }
  });
  assert.equal(duplicate.response.status, 409);

  const unlinkedComment = await request('/api/parent-comments', {
    token: tokens.PARENT,
    method: 'POST',
    body: { learnerId: 2, comment: 'Not my learner.' }
  });
  assert.equal(unlinkedComment.response.status, 404);

  const parentComments = await request('/api/parent-comments', { token: tokens.PARENT });
  assert.equal(parentComments.json.data.length, 1);
  const adminComments = await request('/api/parent-comments', { token: tokens.ADMIN });
  assert.equal(adminComments.json.data.length, 1);
  assert.equal(adminComments.json.data[0].comment, 'Please share reading practice for home.');

  const parentLearnerWrite = await request('/api/learners', {
    token: tokens.PARENT,
    method: 'POST',
    body: { firstName: 'Parent', lastName: 'CannotAdd', grade: 5, className: 'Grade 5A' }
  });
  assert.equal(parentLearnerWrite.response.status, 403);

  const parentNotificationWrite = await request('/api/notifications/read-all', {
    token: tokens.PARENT,
    method: 'PATCH'
  });
  assert.equal(parentNotificationWrite.response.status, 403);
});

test('admins provision learner, staff, and board accounts with role-specific access', async () => {
  const learner = (await request('/api/learners', { token: tokens.ADMIN })).json.data[0];
  const accounts = [];
  for (const [role, name, email, password] of [
    ['STUDENT', learner.name, 'student.portal@cheleta.test', 'studentPass123'],
    ['STAFF', 'School Office Staff', 'school.staff@cheleta.test', 'staffPass123'],
    ['BOARD', 'Board Member', 'board.member@cheleta.test', 'boardPass123']
  ]) {
    const created = await request('/api/staff', {
      token: tokens.ADMIN,
      method: 'POST',
      body: { name, email, password, role, ...(role === 'STUDENT' ? { learnerId: learner.id } : {}) }
    });
    assert.equal(created.response.status, 201);
    const login = await request('/api/login', {
      method: 'POST',
      body: { email, password, role }
    });
    assert.equal(login.response.status, 200);
    accounts.push({ role, token: login.json.data.token, id: created.json.data.id });
  }
  tokens.STUDENT = accounts.find((account) => account.role === 'STUDENT').token;
  tokens.STAFF = accounts.find((account) => account.role === 'STAFF').token;
  tokens.BOARD = accounts.find((account) => account.role === 'BOARD').token;

  const studentLearners = await request('/api/learners', { token: tokens.STUDENT });
  assert.deepEqual(studentLearners.json.data.map((item) => item.id), [learner.id]);
  const resources = await request('/api/learning-resources', { token: tokens.STUDENT });
  assert.equal(resources.response.status, 200);
  assert.ok(resources.json.data.some((resource) => resource.category === 'SUBJECT_NOTES'));
  assert.ok(resources.json.data.some((resource) => resource.category === 'CAREER_READINESS'));
  assert.ok(resources.json.data.some((resource) => resource.category === 'CODING_BOOTCAMP'));
  assert.ok(resources.json.data.every((resource) => Array.isArray(resource.questions)));

  const published = await request('/api/learning-resources', {
    token: tokens.ADMIN,
    method: 'POST',
    body: {
      category: 'SUBJECT_NOTES',
      subject: 'Mathematics',
      grade: learner.grade,
      title: 'Fractions practice',
      content: 'Compare fractions using a common denominator.',
      questions: [{ question: 'Compare 1/2 and 2/3.', answer: '2/3 is larger.' }]
    }
  });
  assert.equal(published.response.status, 201);
  const studentMaterial = await request('/api/learning-resources', { token: tokens.STUDENT });
  assert.ok(studentMaterial.json.data.some((item) => item.title === 'Fractions practice'));
  const deniedMaterialWrite = await request('/api/learning-resources', {
    token: tokens.STUDENT,
    method: 'POST',
    body: { category: 'SUBJECT_NOTES', subject: 'Math', title: 'No', content: 'No' }
  });
  assert.equal(deniedMaterialWrite.response.status, 403);

  const programs = await request('/api/mentorship', { token: tokens.STUDENT });
  assert.ok(programs.json.data.length > 0);
  const programId = programs.json.data[0].id;
  const enrolled = await request(`/api/mentorship/${programId}/enroll`, {
    token: tokens.STUDENT,
    method: 'POST'
  });
  assert.equal(enrolled.response.status, 201);
  const duplicateEnrollment = await request(`/api/mentorship/${programId}/enroll`, {
    token: tokens.STUDENT,
    method: 'POST'
  });
  assert.equal(duplicateEnrollment.response.status, 409);

  const suggestion = await request('/api/suggestions', {
    token: tokens.STUDENT,
    method: 'POST',
    body: { subject: 'Library', suggestion: 'Please create a quiet reading corner.' }
  });
  assert.equal(suggestion.response.status, 201);
  const adminSuggestions = await request('/api/suggestions', { token: tokens.ADMIN });
  const received = adminSuggestions.json.data.find((item) => item.id === suggestion.json.data.id);
  assert.equal(received.learnerId, learner.id);
  const reviewed = await request(`/api/suggestions/${received.id}`, {
    token: tokens.ADMIN,
    method: 'PUT',
    body: { status: 'IN_REVIEW' }
  });
  assert.equal(reviewed.response.status, 200);

  const boardProgress = await request('/api/board/progress', { token: tokens.BOARD });
  assert.equal(boardProgress.response.status, 200);
  assert.ok(boardProgress.json.data.classes.length > 0);
  assert.ok(!('learnerId' in boardProgress.json.data.classes[0]));
  const boardLearners = await request('/api/learners', { token: tokens.BOARD });
  assert.equal(boardLearners.response.status, 403);

  const staffLearners = await request('/api/learners', { token: tokens.STAFF });
  assert.equal(staffLearners.response.status, 200);
  const staffWrite = await request('/api/learners', {
    token: tokens.STAFF,
    method: 'POST',
    body: { firstName: 'No', lastName: 'Write', grade: 5, className: 'Grade 5A' }
  });
  assert.equal(staffWrite.response.status, 403);

  const roster = await request('/api/staff', { token: tokens.ADMIN });
  assert.equal(roster.response.status, 200);
  assert.ok(roster.json.data.some((account) => account.role === 'BOARD'));
  const teacherAccountCreate = await request('/api/staff', {
    token: tokens.TEACHER,
    method: 'POST',
    body: { name: 'Not Admin', email: 'not.admin@cheleta.test', password: 'staffPass123', role: 'STAFF' }
  });
  assert.equal(teacherAccountCreate.response.status, 403);
  const studentAccountCreate = await request('/api/staff', {
    token: tokens.STUDENT,
    method: 'POST',
    body: { name: 'Not Admin', email: 'not.admin.student@cheleta.test', password: 'staffPass123', role: 'STAFF' }
  });
  assert.equal(studentAccountCreate.response.status, 403);

  const deactivated = await request(`/api/staff/${accounts.find((account) => account.role === 'BOARD').id}`, {
    token: tokens.ADMIN,
    method: 'DELETE'
  });
  assert.equal(deactivated.response.status, 200);
  const disabledLogin = await request('/api/login', {
    method: 'POST',
    body: { email: 'board.member@cheleta.test', password: 'boardPass123', role: 'BOARD' }
  });
  assert.equal(disabledLogin.response.status, 401);
});

test('role claims cannot be changed through request parameters', async () => {
  const dashboard = await request('/api/dashboard?role=CSR_PARTNER', { token: tokens.TEACHER });
  assert.equal(dashboard.response.status, 200);
  assert.equal(dashboard.json.data.summary[0].label, 'Assigned learners');
});

test('assessments validate CBC levels, persist, and scope parent records', async () => {
  const parentLearners = await request('/api/learners', { token: tokens.PARENT });
  const learnerId = parentLearners.json.data[0].id;
  const saved = await request('/api/assessments', {
    token: tokens.TEACHER,
    method: 'POST',
    body: {
      learnerId,
      subject: 'Science',
      strand: 'Living things',
      subStrand: 'Plants',
      competency: 'Identifies plant parts',
      level: 'EE',
      term: 'Term 2',
      date: '2026-10-01',
      comment: 'Demo assessment'
    }
  });
  assert.equal(saved.response.status, 201);

  const updated = await request(`/api/assessments/${saved.json.data.id}`, {
    token: tokens.TEACHER,
    method: 'PUT',
    body: {
      learnerId,
      subject: 'Science',
      strand: 'Living things',
      subStrand: 'Plants',
      competency: 'Identifies plant parts',
      level: 'AE',
      term: 'Term 2',
      date: '2026-10-01',
      comment: 'Updated demo assessment'
    }
  });
  assert.equal(updated.response.status, 200);

  const invalid = await request('/api/assessments', {
    token: tokens.TEACHER,
    method: 'POST',
    body: { learnerId, subject: 'Science', strand: 'Plants', subStrand: 'Parts', competency: 'Identify', level: 'A+', term: 'Term 2', date: '2026-10-01' }
  });
  assert.equal(invalid.response.status, 400);

  const visibleToParent = await request('/api/assessments', { token: tokens.PARENT });
  assert.ok(visibleToParent.json.data.some((assessment) => assessment.subject === 'Science'));
});

test('attendance persists idempotently and validates statuses', async () => {
  const parentLearners = await request('/api/learners', { token: tokens.PARENT });
  const learnerId = parentLearners.json.data[0].id;
  const record = {
    learnerId,
    status: 'LATE',
    date: '2026-09-30',
    clientRecordId: 'test-device-record-001'
  };
  const first = await request('/api/attendance', {
    token: tokens.TEACHER,
    method: 'POST',
    body: { records: [record] }
  });
  assert.equal(first.response.status, 201);
  const attendanceId = first.json.data.records[0].id;

  const retry = await request('/api/attendance', {
    token: tokens.TEACHER,
    method: 'POST',
    body: { records: [record] }
  });
  assert.equal(retry.response.status, 200);
  assert.equal(retry.json.data.duplicatesIgnored, 1);

  const updated = await request(`/api/attendance/${attendanceId}`, {
    token: tokens.TEACHER,
    method: 'PUT',
    body: { status: 'ABSENT' }
  });
  assert.equal(updated.response.status, 200);

  const reusedId = await request('/api/attendance', {
    token: tokens.TEACHER,
    method: 'POST',
    body: { records: [{ ...record, date: '2026-10-01' }] }
  });
  assert.equal(reusedId.response.status, 409);

  const invalid = await request('/api/attendance', {
    token: tokens.TEACHER,
    method: 'POST',
    body: { records: [{ ...record, date: '2026-10-02', status: 'UNKNOWN' }] }
  });
  assert.equal(invalid.response.status, 400);

  const parentRecords = await request('/api/attendance', { token: tokens.PARENT });
  assert.ok(parentRecords.json.data.some((entry) => entry.date === record.date && entry.status === 'ABSENT'));
});
