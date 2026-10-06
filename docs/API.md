# API

The Express API runs at `http://localhost:3001`. Successful and failed operations use a consistent JSON envelope:

```json
{
  "success": true,
  "data": {},
  "message": "Operation completed successfully"
}
```

Private routes require `Authorization: Bearer <token>`. The API derives the role from the signed token, never from a caller-supplied role query or header.

## Authentication

- `GET /api/health`
- `POST /api/login`
- `GET /api/me`

## Learners and teachers

- `GET /api/learners`
- `POST /api/learners` — admin or teacher assigned to the selected class
- `PUT /api/learners/:id` — admin only
- `DELETE /api/learners/:id` — admin only; archives the learner and preserves attendance/assessment history
- `GET /api/teachers` — admin only
- `POST /api/teachers` — admin only; creates a teacher profile and sign-in
- `PUT /api/teachers/:id` — admin only
- `DELETE /api/teachers/:id` — admin only; deactivates the teacher account and preserves history

Parents can retrieve only linked learner profiles. Teachers can retrieve learners from assigned classes. CSR accounts cannot retrieve learner records.

## Student learning, mentorship, and accounts

- `GET /api/learning-resources` — admin, teacher, staff, or student; student resources are scoped to their linked learner's grade
- `POST /api/learning-resources` — admin only; publishes notes and optional question/answer pairs
- `GET /api/mentorship` — admin, teacher, staff, or student
- `POST /api/mentorship` — admin only; creates a mentorship program
- `POST /api/mentorship/:id/enroll` — student only; joins an active eligible program
- `DELETE /api/mentorship/:id` — admin only; closes a program without deleting its enrolments
- `POST /api/suggestions` — student only; sends an idea directly to the admin inbox
- `GET /api/suggestions` — admin sees all suggestions; students see only their own
- `PUT /api/suggestions/:id` — admin only; updates review status
- `GET /api/staff` and `POST /api/staff` — admin only; lists or creates staff, Board, and linked student accounts
- `DELETE /api/staff/:id` — admin only; deactivates a staff, Board, or student sign-in

## Board progress

- `GET /api/board/progress` — admin or Board; returns school-wide totals and per-class aggregate attendance and assessment measures without learner identities

## CBC assessments

- `GET /api/assessments` — admin, teacher, parent, student, or staff; student and parent records are scoped to linked learners; filters include `learnerId`, `subject`, `strand`, and `term`
- `POST /api/assessments` — admin or assigned teacher
- `PUT /api/assessments/:id` — admin or the teacher who created it

Allowed rubric levels: `EE`, `ME`, `AE`, `BE`.

## Attendance

- `GET /api/attendance` — admin, teacher, parent, student, or staff; student and parent records are scoped to linked learners; optional `learnerId`, `className`, and `date` filters
- `POST /api/attendance` — admin or teacher; accepts 1–200 `records` with learner, status, date, and a unique `clientRecordId`
- `PUT /api/attendance/:id` — admin or teacher assigned to the record's class

Allowed statuses: `PRESENT`, `ABSENT`, `LATE`, `EXCUSED`. The unique learner/date constraint and client ID make retries idempotent.

## Existing demo modules

- `GET /api/dashboard`
- `GET /api/announcements`
- `GET /api/resources`
- `GET /api/notifications`
- `PATCH /api/notifications/:id/read`
- `PATCH /api/notifications/read-all`
- `GET /api/impact` — admin or CSR; aggregate information only

Announcements, the general resource list, and notifications are development demo data. The learning library, mentorship programs, suggestions, student accounts, and staff accounts are persisted in SQLite.
