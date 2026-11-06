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

## School operations

- `GET /api/timetable` — admin, teacher, parent, student, or staff; teachers see assigned classes and families see linked learner classes
- `POST /api/timetable` and `DELETE /api/timetable/:id` — admin or assigned teacher; overlapping class/teacher slots are rejected
- `GET /api/lesson-plans` — same class scoping as timetables
- `POST /api/lesson-plans` — admin or teacher assigned to the selected class
- `PUT /api/lesson-plans/:id/progress` — admin or teacher assigned to the lesson's class
- `GET /api/report-cards?learnerId=&term=&startDate=&endDate=` — admin, teacher, parent, or student; composes scoped CBC results and attendance
- `PUT /api/report-cards/:learnerId/comment` — admin or assigned teacher; stores a term comment and notifies linked parents
- `GET /api/reports/summary?days=` — admin only; attendance trend, class/term assessment progress, and follow-up indicators (default 30 days; valid range 1–365)

## Notifications and learner support

- `GET /api/notifications` and `PATCH /api/notifications/:id/read`, `PATCH /api/notifications/read-all` — authenticated user; records are private to the recipient
- `POST /api/announcements` — admin only; publishes an in-app notice to active parent accounts and queues consented SMS delivery
- `PUT /api/me/phone` — parent only; updates E.164 phone number and SMS opt-in
- `GET /api/wellbeing` — admin or teacher assigned to the learner's current class; every access is audited
- `POST /api/wellbeing` — admin or assigned teacher
- `PUT /api/wellbeing/:id` — admin or teacher assigned to the case's learner

Africa's Talking SMS sending is configured with `AT_USERNAME`, `AT_API_KEY`, and optional `AT_SENDER_ID`/`AT_API_URL`. Without credentials, in-app notifications still work and the SMS status is `NOT_CONFIGURED`. Parents must opt in and supply a valid international phone number.

## Library, inventory, and exports

- `GET /api/inventory` — admin, teacher, or staff
- `POST /api/inventory` and `PUT /api/inventory/:id` — admin or staff; stock cannot be reduced below open loans
- `GET /api/library/loans` — admin, teacher, staff, parent, or student; family records are limited to linked learners and teachers to assigned classes
- `POST /api/library/loans` and `PUT /api/library/loans/:id/return` — admin or staff
- `GET /api/exports/learners.csv`, `/api/exports/attendance.csv`, `/api/exports/assessments.csv` — admin, teacher, parent, student, or staff; parent/student data is scoped to linked learners and teacher data to assigned classes
- `GET /api/admin/backup` — admin only; downloads a SQLite backup

Report cards can be printed or saved as PDF through the browser's print dialog.

## Existing demo modules

- `GET /api/dashboard`
- `GET /api/announcements`
- `GET /api/resources`
- `GET /api/impact` — admin or CSR; aggregate information only

The general resource list and impact summaries include development demo data. Announcements, notifications, school-tools records, learning materials, mentorship programs, suggestions, and school accounts are persisted in SQLite.
