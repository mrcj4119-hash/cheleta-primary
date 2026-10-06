# Cheleta SMS

Cheleta SMS is a mobile-first school management system for Cheleta Primary School. It includes role-based school administration, learner accounts, a digital learning library, mentorship, student suggestions, and Board progress reporting. All seeded people and records are fictional demo data. No payment functionality is included.

## Requirements

- Node.js 22.9+ (`node:sqlite` and `--env-file-if-exists` are used; Node 24 LTS is recommended)
- npm

## Local setup

```powershell
cd "C:\Users\EHK STUDENT 008\Desktop\cheleta primary"
npm install
Copy-Item .env.example .env
npm run migrate
npm run dev
```

`npm run dev` starts the Express API at http://localhost:3001 and the Vite app at http://localhost:4321. The SQLite database file is created at `database/cheleta.sqlite`; the file is ignored by Git. The schema bootstrap and fictional demo seed run automatically on first initialization. `npm run migrate` is safe to run again.

For separate processes, use two terminals:

```powershell
npm run server
```

```powershell
npm run frontend
```

## Fictional demo accounts

| Role | Email | Development password |
|---|---|---|
| Admin | `admin@cheleta.test` | `admin123` |
| Teacher | `teacher@cheleta.test` | `teacher123` |
| Parent | `parent@cheleta.test` | `parent123` |
| CSR partner | `csr@cheleta.test` | `csr123` |
| Student | `student@cheleta.test` | `student123` |
| Student | `student2@cheleta.test` | `student123` |
| Student | `student3@cheleta.test` | `student123` |

These credentials are for local demonstrations only. Replace them and configure a long random `JWT_SECRET` before any non-local deployment. Passwords are stored as scrypt hashes in SQLite, not as plaintext.
The demonstration students are linked to separate seeded learner records. In normal school use, the admin creates each student's linked sign-in under **Staff accounts**; teachers, parents, students, and Board members cannot create accounts.

## Current workflows

- Authentication: role-checked login, eight-hour signed bearer tokens, session-scoped browser token, protected API routes.
- Learners: administrators can create, update, archive, and restore records; administrators and teachers can register learners, with teachers limited to their assigned classes. Parents have read-only access to linked learner records, except that each parent may submit one comment per linked learner. Grades 7–9 are marked as Junior Secondary.
- Classes: administrators can add classes and remove classes that have no learner records. Administrators assign classes to teachers.
- Parent comments: parents can submit one non-editable comment per linked learner; teachers can review comments for assigned classes and administrators can review all comments.
- Teachers: administrator creates a profile and sign-in account, assigns classes, updates profiles, and deactivates/reactivates accounts.
- Student learning: administrators create learner sign-ins. Students access grade-matched subject notes, revision questions, career-readiness material, coding bootcamp resources, and linked learner progress.
- Mentorship and suggestions: students can join active mentorship programs and send suggestions directly to the admin; the admin can review suggestions and update their status.
- Board of Management: administrators create Board accounts. Board members can see aggregate school progress by class without access to individual learner records.
- School accounts: administrators can add non-teaching staff, Board members, and learner logins; teacher logins continue to be managed with teacher profiles.
- Learning resources: administrators can publish notes, career-readiness material, coding guides, and revision questions for all grades or a specific grade.
- CBC assessments: create, edit, and view assessment history; rubric levels are EE, ME, AE, and BE.
- Attendance: daily class recording, status changes, filtered record retrieval, SQLite persistence, and idempotent offline sync using client record IDs.
- CSR: aggregate impact view only; CSR users cannot access learner profiles, individual attendance, or individual assessments.
- PWA: install support and cached app shell. Authenticated API responses are network-only and are not added to the service-worker cache.

## Commands

```powershell
npm run dev
npm run server
npm run frontend
npm run migrate
npm run seed
npm test
npm run test:load
npm run build
```

`npm run test:load` sends 10,000 concurrent authenticated dashboard requests to one local API process and reports throughput and p50/p95/p99 latency. It is a repeatable local burst check, not a guarantee for 10,000 independently active users in production: the current API uses synchronous SQLite and a single Node.js process. A production 10,000-user target needs an agreed request profile and latency target, a production-like load environment, and scalable deployment/database capacity testing.

## Project structure

- `src/`: React application and responsive styles
- `server.js`: Express API, authentication, authorization, validation, and record routes
- `database.js`: SQLite initialization and fictional first-run seed data
- `database/schema.sql`: relational schema and indexes
- `database/migrations/`: idempotent schema upgrades, including student learning, mentorship, and school account roles
- `migrate.js`: idempotent schema initialization check
- `tests/`: API tests using an isolated in-memory SQLite database
- `docs/`: project, CSR, architecture, API, database, security, testing, and user documentation

## Scope and production readiness

This is a local student/demo application, not a production school record system. It uses the built-in synchronous SQLite API and local demo accounts. Before real student data is used, complete a privacy/security review, define safeguarding and retention policies, configure secure deployment and backups, and validate all workflows with school stakeholders. The general announcements and resource list remain demo-only; learning-library material, mentorship, suggestions, and account records are database-backed.
