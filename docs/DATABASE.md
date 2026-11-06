# Database

The local backend uses SQLite through Node's built-in `node:sqlite` module. The database is stored at `database/cheleta.sqlite` by default; set `CHELETA_DB_PATH` to change it.

## Schema

`database/schema.sql` initializes:

- users and teacher profiles
- learner records
- parent-to-learner links
- teacher-to-class assignments
- CBC assessments
- daily attendance
- audit events
- indexes and uniqueness rules
- grade-scoped learning resources and revision questions
- mentorship programs and learner enrolments
- student suggestions and review status
- Board, staff, and student account roles and account status
- class timetables, lesson plans, term report comments, and parent notifications/SMS delivery status
- confidential learner-support cases, inventory stock, and library loans

`schema_migrations` records applied versions. Later migrations add learner archives, class and parent-comment records, Grade 9, student/staff/Board roles, learning resources, mentorship, suggestions, and school-tools data. `npm run migrate` initializes the schema, applies pending migrations, and seeds local example users and learning material. The operation is idempotent.

## Integrity and privacy

- learner records reference attendance and assessment records through foreign keys
- attendance has unique learner/date and client submission IDs to prevent duplicates
- assessment levels and attendance statuses are constrained in SQLite
- learner and teacher records can be archived/deactivated without deleting linked history
- parent accounts are joined only to their linked learners
- timetable, report-card, and library-loan responses follow linked-learner or assigned-class scopes
- safeguarding access is limited to admins and teachers assigned to the learner's class, with access recorded in the audit log
- parent SMS requires a valid international number and explicit opt-in; delivery status is persisted
- stock counts cannot be reduced below open book loans
- SQLite files are ignored by Git
- demo passwords are stored as salted scrypt hashes

The initial migration is a SQLite bootstrap, not a production migration-management framework.
