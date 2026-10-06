import { db } from './database.js';

const version = db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get().version;
const learnerCount = db.prepare('SELECT COUNT(*) AS count FROM learners').get().count;
const studentDemoAccounts = db.prepare(
  `SELECT COUNT(*) AS count FROM users
   WHERE role = 'STUDENT' AND status = 'ACTIVE' AND email LIKE 'student%@cheleta.test'`
).get().count;

console.log(
  `SQLite schema version ${version} is ready. ${learnerCount} learner records and ${studentDemoAccounts} active student demo accounts are available.`
);
