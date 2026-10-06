import { DatabaseSync } from 'node:sqlite';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const configuredPath = process.env.CHELETA_DB_PATH || 'database/cheleta.sqlite';
const databasePath = configuredPath === ':memory:'
  ? configuredPath
  : isAbsolute(configuredPath) ? configuredPath : resolve(root, configuredPath);

export const db = new DatabaseSync(databasePath);
db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
)`);
db.exec(readFileSync(resolve(root, 'database', 'schema.sql'), 'utf8'));
db.prepare('INSERT OR IGNORE INTO schema_migrations (version) VALUES (1)').run();

const migrationsPath = resolve(root, 'database', 'migrations');
for (const filename of readdirSync(migrationsPath).filter((name) => name.endsWith('.sql')).sort()) {
  const version = Number(filename.match(/^(\d+)_/)?.[1]);
  if (!Number.isInteger(version) || db.prepare('SELECT 1 FROM schema_migrations WHERE version = ?').get(version)) {
    continue;
  }
  db.exec('PRAGMA foreign_keys = OFF');
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(readFileSync(resolve(migrationsPath, filename), 'utf8'));
    db.prepare('INSERT INTO schema_migrations (version) VALUES (?)').run(version);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
}

export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password, storedHash) {
  const [salt, expected] = String(storedHash).split(':');
  if (!salt || !expected) return false;

  const actual = scryptSync(password, salt, 64);
  const expectedBytes = Buffer.from(expected, 'hex');
  return actual.length === expectedBytes.length && actual.length === 64
    && timingSafeEqual(actual, expectedBytes);
}

const initialLearners = [
  ['Amina', 'Otieno', 5, 'Grade 5A', 'A', 'Reading mentor'],
  ['Daniel', 'Kibet', 3, 'Grade 3B', 'B', 'Math support plan'],
  ['Faith', 'Wanjiku', 1, 'Grade 1A', 'A', 'Home reading routine'],
  ['Joseph', 'Njeri', 7, 'Grade 7C', 'C', 'Group coaching'],
  ['Mercy', 'Muthoni', 4, 'Grade 4B', 'B', 'On track'],
  ['Brian', 'Kamau', 2, 'Grade 2A', 'A', 'On track'],
  ['Grace', 'Mwangi', 6, 'Grade 6A', 'A', 'Reading mentor'],
  ['Kevin', 'Ochieng', 8, 'Grade 8B', 'B', 'On track'],
  ['Lydia', 'Wairimu', 5, 'Grade 5A', 'A', 'On track'],
  ['Peter', 'Maina', 3, 'Grade 3B', 'B', 'On track'],
  ['Sarah', 'Chebet', 1, 'Grade 1A', 'A', 'On track'],
  ['Samuel', 'Mutua', 7, 'Grade 7C', 'C', 'On track'],
  ['Esther', 'Naliaka', 4, 'Grade 4B', 'B', 'On track'],
  ['David', 'Barasa', 2, 'Grade 2A', 'A', 'On track'],
  ['Ruth', 'Atieno', 6, 'Grade 6A', 'A', 'On track'],
  ['James', 'Kiptoo', 8, 'Grade 8B', 'B', 'On track'],
  ['Alice', 'Nyambura', 5, 'Grade 5A', 'A', 'On track'],
  ['Michael', 'Wekesa', 3, 'Grade 3B', 'B', 'On track'],
  ['Janet', 'Akinyi', 1, 'Grade 1A', 'A', 'On track'],
  ['Patrick', 'Kariuki', 7, 'Grade 7C', 'C', 'On track'],
  ['Joyce', 'Adhiambo', 4, 'Grade 4B', 'B', 'On track'],
  ['Dennis', 'Mbugua', 2, 'Grade 2A', 'A', 'On track'],
  ['Naomi', 'Jepkoech', 6, 'Grade 6A', 'A', 'On track'],
  ['Victor', 'Odhiambo', 8, 'Grade 8B', 'B', 'On track'],
  ['Leah', 'Wambui', 5, 'Grade 5A', 'A', 'On track'],
  ['Eric', 'Kilonzo', 3, 'Grade 3B', 'B', 'On track'],
  ['Miriam', 'Chepkemoi', 1, 'Grade 1A', 'A', 'On track'],
  ['George', 'Ouma', 7, 'Grade 7C', 'C', 'On track'],
  ['Agnes', 'Wanjala', 4, 'Grade 4B', 'B', 'On track'],
  ['Felix', 'Njoroge', 2, 'Grade 2A', 'A', 'On track']
];

const initialLearningResources = [
  {
    category: 'SUBJECT_NOTES', subject: 'Mathematics', grade: null, title: 'Fractions and equivalent values',
    content: 'A fraction shows equal parts of a whole. The numerator counts selected parts and the denominator counts all equal parts. Equivalent fractions name the same amount: 1/2 = 2/4. Multiply or divide both parts by the same non-zero number to find an equivalent fraction.',
    questions: [['Write an equivalent fraction for 2/3 with denominator 12.', 'Multiply numerator and denominator by 4: 8/12.'], ['Which is larger, 3/4 or 2/3?', '3/4 is larger because 9/12 > 8/12.']]
  },
  {
    category: 'SUBJECT_NOTES', subject: 'English', grade: null, title: 'Reading for meaning',
    content: 'Read a passage once to understand its main idea, then read again to locate details. Use nearby words to work out unfamiliar vocabulary. When answering, support your idea with evidence from the passage and write in complete sentences.',
    questions: [['What is a main idea?', 'The most important point or message of a passage.'], ['How can context help with a new word?', 'The surrounding words and sentences provide clues to its meaning.']]
  },
  {
    category: 'SUBJECT_NOTES', subject: 'Kiswahili', grade: null, title: 'Ufahamu wa kifungu',
    content: 'Soma kifungu mara ya kwanza ili kuelewa ujumbe mkuu. Soma tena ili kupata maelezo muhimu. Jibu maswali kwa sentensi kamili na tumia ushahidi kutoka kwenye kifungu. Tumia maneno yaliyo karibu kukisia maana ya msamiati mpya.',
    questions: [['Ujumbe mkuu ni nini?', 'Ni wazo au funzo muhimu zaidi katika kifungu.'], ['Kwa nini tusome kifungu tena?', 'Ili kuthibitisha maelezo na kujibu maswali kwa usahihi.']]
  },
  {
    category: 'SUBJECT_NOTES', subject: 'Science & Technology', grade: null, title: 'Fair tests and observations',
    content: 'A fair test changes one factor at a time and keeps other conditions the same. Observe carefully, record results with labels and units, then use the evidence to explain what happened. Repeat measurements where possible to improve reliability.',
    questions: [['Why change one factor at a time?', 'So we can identify which factor caused the observed change.'], ['What makes an observation useful?', 'It is clear, accurate, and recorded with relevant labels or units.']]
  },
  {
    category: 'SUBJECT_NOTES', subject: 'Social Studies', grade: null, title: 'Maps and our community',
    content: 'A map is a scaled drawing of a place. A title identifies the place, a key explains symbols, and a compass rose shows direction. Maps help us locate services, plan safe routes, and understand how people use their environment.',
    questions: [['What does a map key explain?', 'The meaning of symbols used on the map.'], ['Which direction is opposite east?', 'West.']]
  },
  {
    category: 'SUBJECT_NOTES', subject: 'Agriculture', grade: null, title: 'Healthy soil and crops',
    content: 'Healthy soil supports plant roots, holds water, and contains nutrients. Compost adds organic matter. Mulching covers soil to reduce water loss and weeds. Rotate crops to help maintain soil fertility and interrupt some pest cycles.',
    questions: [['Name one benefit of mulching.', 'It reduces water loss or suppresses weeds.'], ['What does compost add to soil?', 'Organic matter and nutrients.']]
  },
  {
    category: 'SUBJECT_NOTES', subject: 'Creative Arts', grade: null, title: 'Elements of design',
    content: 'Artists use line, shape, colour, texture, and space to communicate ideas. A pattern repeats elements in an organised way. Before making an artwork, plan the message, choose suitable materials, and consider how the audience will view it.',
    questions: [['What is a pattern?', 'A repeated arrangement of one or more design elements.'], ['Name two elements of design.', 'For example, line and colour.']]
  },
  {
    category: 'SUBJECT_NOTES', subject: 'Life Skills', grade: null, title: 'Making thoughtful decisions',
    content: 'A thoughtful decision identifies the problem, gathers reliable information, considers possible choices and consequences, and selects a safe and respectful action. Ask a trusted adult for help when a choice affects safety or wellbeing.',
    questions: [['What should you consider before choosing?', 'The available options and their likely consequences.'], ['When should you ask a trusted adult for help?', 'When safety, wellbeing, or a difficult situation is involved.']]
  },
  {
    category: 'CAREER_READINESS', subject: 'Science & Technology', grade: null, title: 'Careers that use science',
    content: 'Science skills are useful in health care, agriculture, environmental protection, engineering, and laboratory work. These careers use curiosity, careful observation, evidence, teamwork, and responsible problem-solving. Explore what people in your community do and which school subjects support their work.',
    questions: [['Name two skills used in science-related careers.', 'Examples include observation and evidence-based problem-solving.'], ['Name one career connected to science.', 'Examples include nurse, engineer, agricultural officer, or laboratory technician.']]
  },
  {
    category: 'CAREER_READINESS', subject: 'Mathematics', grade: null, title: 'Careers that use mathematics',
    content: 'Mathematics supports budgeting, construction, business, data work, transport, and technology. Estimation, accurate calculation, explaining your method, and checking whether an answer is reasonable are valuable in many workplaces.',
    questions: [['How can estimation help at work?', 'It helps check whether a calculated result is sensible.'], ['Name one career that uses mathematics.', 'Examples include builder, accountant, shopkeeper, or data analyst.']]
  },
  {
    category: 'CAREER_READINESS', subject: 'English & Kiswahili', grade: null, title: 'Communication and future work',
    content: 'Clear speaking, active listening, reading instructions, and writing respectfully help people work together. Practise introducing yourself, asking helpful questions, and explaining an idea in both English and Kiswahili.',
    questions: [['What is active listening?', 'Paying attention, allowing others to speak, and responding thoughtfully.'], ['Name one way to communicate respectfully.', 'Listen without interrupting or use polite, clear language.']]
  },
  {
    category: 'CAREER_READINESS', subject: 'Life Skills', grade: null, title: 'Exploring interests and strengths',
    content: 'Career exploration starts with noticing what you enjoy, what you do well, and which skills you want to practise. Learn about different kinds of work, ask people about their training and daily tasks, and set a small learning goal. Every honest occupation contributes to a community.',
    questions: [['What are three things to consider when exploring careers?', 'Interests, strengths, and skills you want to build.'], ['Why talk to people about their work?', 'To learn about training, tasks, and the realities of different jobs.']]
  },
  {
    category: 'CODING_BOOTCAMP', subject: 'Digital Literacy', grade: null, title: 'Coding bootcamp: algorithms and sequences',
    content: 'An algorithm is a clear sequence of steps for solving a problem. Break a task into small steps, put them in order, and test the instructions. A loop repeats steps; a condition chooses what to do when something is true or false. Start by writing an algorithm in plain language before using a coding tool.',
    questions: [['Write an algorithm for packing a school bag.', 'Example: check timetable, collect books, add homework, pack stationery, check the bag.'], ['What does a loop do?', 'It repeats a set of instructions.']]
  },
  {
    category: 'CODING_BOOTCAMP', subject: 'Digital Literacy', grade: null, title: 'Coding bootcamp: debugging safely',
    content: 'A bug is an error that makes a program behave unexpectedly. Reproduce the problem, check one step at a time, compare the result with what you expected, and change one thing before testing again. Keep passwords private, ask before sharing information online, and use school-approved devices and sites.',
    questions: [['What is debugging?', 'Finding and correcting errors in a program.'], ['Why change one thing at a time while debugging?', 'To see which change fixed or affected the problem.']]
  }
];

function seedInitialData() {
  db.prepare(
    'INSERT OR IGNORE INTO classes (class_name, grade) SELECT DISTINCT class_name, grade FROM learners'
  ).run();
  db.prepare("INSERT OR IGNORE INTO classes (class_name, grade) VALUES ('Grade 9A', 9)").run();
  if (db.prepare('SELECT COUNT(*) AS count FROM users').get().count > 0) return;

  db.exec('BEGIN IMMEDIATE');
  const insertTeacher = db.prepare(
    'INSERT INTO teachers (name, email, phone, qualification) VALUES (?, ?, ?, ?)'
  );
  const teachers = [
    { name: 'Teacher Achieng', email: 'teacher@cheleta.test', phone: '0700000001', classes: ['Grade 5A', 'Grade 6A', 'Grade 7C'] },
    { name: 'Teacher Kamau', email: 'teacher2@cheleta.test', phone: '0700000002', classes: ['Grade 1A', 'Grade 2A', 'Grade 3B'] },
    { name: 'Teacher Wanjala', email: 'teacher3@cheleta.test', phone: '0700000003', classes: ['Grade 4B', 'Grade 8B'] }
  ];

  const teacherIds = teachers.map((teacher) => Number(insertTeacher.run(
    teacher.name,
    teacher.email,
    teacher.phone,
    'Primary Teacher Training'
  ).lastInsertRowid));

  const insertClass = db.prepare('INSERT INTO teacher_classes (teacher_id, class_name) VALUES (?, ?)');
  teachers.forEach((teacher, index) => {
    teacher.classes.forEach((className) => insertClass.run(teacherIds[index], className));
  });

  const insertLearner = db.prepare(
    'INSERT INTO learners (first_name, last_name, grade, class_name, stream, support) VALUES (?, ?, ?, ?, ?, ?)'
  );
  initialLearners.forEach((learner) => insertLearner.run(...learner));
  db.prepare(
    'INSERT OR IGNORE INTO classes (class_name, grade) SELECT DISTINCT class_name, grade FROM learners'
  ).run();

  const insertUser = db.prepare(
    'INSERT INTO users (name, email, password_hash, role, teacher_id) VALUES (?, ?, ?, ?, ?)'
  );
  const userIds = new Map();
  [
    { name: 'Admin User', email: 'admin@cheleta.test', password: 'admin123', role: 'ADMIN', teacherId: null },
    { name: teachers[0].name, email: teachers[0].email, password: 'teacher123', role: 'TEACHER', teacherId: teacherIds[0] },
    { name: 'Parent Account', email: 'parent@cheleta.test', password: 'parent123', role: 'PARENT', teacherId: null },
    { name: 'CSR Partner', email: 'csr@cheleta.test', password: 'csr123', role: 'CSR_PARTNER', teacherId: null }
  ].forEach((user) => {
    userIds.set(user.role, Number(insertUser.run(
      user.name,
      user.email,
      hashPassword(user.password),
      user.role,
      user.teacherId
    ).lastInsertRowid));
  });

  const linkedLearner = db.prepare(
    "SELECT id FROM learners WHERE first_name = 'Amina' AND last_name = 'Otieno'"
  ).get();
  db.prepare('INSERT INTO user_learners (user_id, learner_id) VALUES (?, ?)').run(
    userIds.get('PARENT'),
    linkedLearner.id
  );

  const today = new Date().toISOString().slice(0, 10);
  const sampleAssessments = db.prepare(
    `INSERT INTO assessments
      (learner_id, subject, strand, sub_strand, competency, level, teacher_id, term, assessment_date, comment)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  sampleAssessments.run(linkedLearner.id, 'Mathematics', 'Numbers', 'Whole numbers', 'Number sense', 'ME', teacherIds[0], 'Term 1', today, 'Making steady progress.');
  sampleAssessments.run(linkedLearner.id, 'English', 'Reading', 'Comprehension', 'Reads and understands a short text', 'AE', teacherIds[0], 'Term 1', today, 'Participates in guided reading.');

  const insertAttendance = db.prepare(
    `INSERT INTO attendance (learner_id, class_name, status, attendance_date, client_record_id, recorded_by)
     VALUES (?, ?, ?, ?, ?, ?)`
  );
  insertAttendance.run(linkedLearner.id, 'Grade 5A', 'PRESENT', today, 'demo-attendance-amina-today', userIds.get('TEACHER'));
  db.exec('COMMIT');
}

seedInitialData();

const demoStudentAccounts = [
  { name: 'Amina Otieno', email: 'student@cheleta.test', password: 'student123', firstName: 'Amina', lastName: 'Otieno' },
  { name: 'Daniel Kibet', email: 'student2@cheleta.test', password: 'student123', firstName: 'Daniel', lastName: 'Kibet' },
  { name: 'Faith Wanjiku', email: 'student3@cheleta.test', password: 'student123', firstName: 'Faith', lastName: 'Wanjiku' }
];

for (const account of demoStudentAccounts) {
  const existing = db.prepare('SELECT id, role FROM users WHERE email = ? COLLATE NOCASE').get(account.email);
  if (existing) continue;
  const learner = db.prepare(
    `SELECT id FROM learners WHERE first_name = ? AND last_name = ? AND status = 'ACTIVE'`
  ).get(account.firstName, account.lastName);
  if (!learner) continue;
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = db.prepare(
      'INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)'
    ).run(account.name, account.email, hashPassword(account.password), 'STUDENT');
    db.prepare('INSERT INTO user_learners (user_id, learner_id) VALUES (?, ?)').run(
      Number(result.lastInsertRowid), learner.id
    );
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    if (error.errcode === 1555 || error.errcode === 2067) continue;
    throw error;
  }
}

const insertResource = db.prepare(
  `INSERT OR IGNORE INTO learning_resources (category, subject, grade, title, content)
   VALUES (?, ?, ?, ?, ?)`
);
const insertQuestion = db.prepare(
  'INSERT INTO revision_questions (resource_id, question, answer, position) VALUES (?, ?, ?, ?)'
);
for (const resource of initialLearningResources) {
  insertResource.run(resource.category, resource.subject, resource.grade, resource.title, resource.content);
  const saved = db.prepare(
    'SELECT id FROM learning_resources WHERE category = ? AND subject = ? AND grade IS ? AND title = ?'
  ).get(resource.category, resource.subject, resource.grade, resource.title);
  if (db.prepare('SELECT COUNT(*) AS count FROM revision_questions WHERE resource_id = ?').get(saved.id).count === 0) {
    resource.questions.forEach(([question, answer], index) => {
      insertQuestion.run(saved.id, question, answer, index + 1);
    });
  }
}

const insertMentorship = db.prepare(
  `INSERT INTO mentorship_programs (title, description, mentor, grade)
   SELECT ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM mentorship_programs WHERE title = ?)`
);
[
  ['Reading buddies', 'Build reading confidence through weekly paired reading and friendly book discussions.', 'Literacy team', null],
  ['STEM makers circle', 'Explore science questions, simple engineering challenges, and creative problem-solving.', 'STEM mentors', null],
  ['Study skills and wellbeing', 'Practise planning, revision habits, confidence, and asking for support.', 'Student support team', null]
].forEach(([title, description, mentor, grade]) => {
  insertMentorship.run(title, description, mentor, grade, title);
});
