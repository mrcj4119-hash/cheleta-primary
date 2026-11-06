# Security

This is a local student/demo application and is not approved for production learner information.

## Implemented for the demo

- passwords are stored as salted scrypt hashes
- API access requires an expiring HMAC-signed bearer token
- role checks are enforced server-side
- parents are scoped to linked learners
- teacher access is scoped to assigned classes
- confidential wellbeing cases are limited to admins and teachers assigned to the learner's class, with reads and writes audited
- parent SMS requires a supplied E.164 phone number and explicit consent; gateway credentials remain in environment configuration
- CSV exports are role-scoped and protect against spreadsheet formula injection; full database backup is admin-only
- CSR accounts can see aggregate impact only
- assessment and attendance input is validated and parameterized
- audit rows record login and key record writes without passwords or tokens
- service worker does not cache API responses
- database and environment files are excluded from Git

## Before any real deployment

- provide a strong `JWT_SECRET` through secure environment configuration
- use HTTPS, restricted origin settings, request rate limits, security headers, and a maintained dependency audit process
- review authorization and safeguarding controls with the school
- establish backup, retention, consent, and incident response procedures
- configure Africa's Talking credentials only through a secrets manager or protected environment file; verify sender, cost limits, and consent before enabling outbound SMS
- protect downloaded SQLite backups with encrypted storage and restricted access; backups include wellbeing records
- replace the demo authentication/session architecture with an independently reviewed production design
- do not load real learner data into this prototype
