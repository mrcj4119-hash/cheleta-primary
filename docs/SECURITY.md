# Security

This is a local student/demo application and is not approved for production learner information.

## Implemented for the demo

- passwords are stored as salted scrypt hashes
- API access requires an expiring HMAC-signed bearer token
- role checks are enforced server-side
- parents are scoped to linked learners
- teacher access is scoped to assigned classes
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
- replace the demo authentication/session architecture with an independently reviewed production design
- do not load real learner data into this prototype
