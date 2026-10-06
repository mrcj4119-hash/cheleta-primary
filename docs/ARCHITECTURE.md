# Architecture

- Frontend: React + Vite, responsive single-page dashboard
- Backend: Express REST API
- Local persistence: SQLite using Node.js `node:sqlite`
- Password storage: salted scrypt hashes
- Authentication: signed HMAC bearer tokens with an eight-hour expiration
- Offline attendance: browser localStorage queue; server deduplicates by client record ID and learner/date
- PWA: manifest and service worker cache for the app shell; authenticated API requests bypass caches

API authorization derives the current user and role from a verified bearer token. Learner scopes are applied on the server for teacher class assignments and parent/student links. Board of Management routes expose aggregate progress without individual learner identities. Student suggestions and grade-matched learning content are protected server-side; administration and account provisioning are restricted to admins.

The current SQLite API uses synchronous access, appropriate for a small local demo. A production deployment should use a managed database and an asynchronous database driver.
