# Testing

Run automated API tests with:

```powershell
npm test
```

Tests use an isolated in-memory SQLite database and cover:

- role-specific login and invalid credentials
- unauthenticated API rejection
- admin learner create/update and non-admin denial
- teacher profile creation and its login account
- parent-linked learner visibility and CSR personal-data denial
- CBC level validation, persistence, and parent scoping
- attendance status validation, persistence, duplicate retries, and parent scoping

Build the production frontend with:

```powershell
npm run build
```

Manual verification: start the app, sign in with each demo role, confirm the navigation is role-specific, record attendance while offline, restore connectivity, and verify that queued entries are submitted without duplicate attendance rows.

Run `npm run test:load` for a local burst of 10,000 simultaneous authenticated dashboard requests. It reports throughput and latency percentiles; this single-process, in-memory SQLite run is a code-path stress check, not production capacity certification.
