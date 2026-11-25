# Rana Medical Hospital — care, considered.

A responsive 17-section public hospital website and a connected ERP prototype with six role views. The API persists shared demo records and provides role-gated module CRUD across patients, OPD, IPD, lab, pharmacy, billing, HR and CMS. Demonstrated end-to-end workflows include online booking → OPD token → private staff queue, doctor CMS → public directory, bed admission/discharge → bed availability and bill, partial invoice payment, pharmacy POS → stock decrement → invoice/payment, and lab order → result entry → staff authorization. The dashboard financial KPIs derive from posted demo payments and recorded expenses. It uses Server-Sent Events for queue/data refresh. The project is dependency-free (Node.js 18+ + browser APIs) for a clean local run.

> **Scope and safety notice** — This is a functional prototype, not a complete or production-ready Hospital Information System. It is not React/Next.js and does not connect to PostgreSQL at runtime; runtime storage is a local JSON file. The six selectable ERP roles are demonstration roles, not authenticated staff accounts. Some focused operational flows (appointments, basic CRUD, IPD bed assignment/discharge, payments, POS stock decrement and lab result authorization) persist to the shared demo store; this does **not** make the remaining clinical and financial behavior production complete or clinically validated. It must never be used for real patient care or protected health information. Production requires real identity, tested policy enforcement, transactional PostgreSQL services, complete reviewed clinical workflows, backups, secure report access, integrations and independent security/privacy review. No actual staff, PMDC credentials, certifications, ambulance availability, insurance panels or authentic patient reviews are asserted.

## Run locally

```bash
node --version       # Node 18+
npm start            # serves on 0.0.0.0:3000
```

Open `http://localhost:3000`. The preview server is the same-origin API host; do not open `index.html` as a `file://` URL. Public booking stores sample requests under `data/demo-state.json` (created on first API request). Treat all entered data as sensitive even in a local demo, do not enter real patient details, and delete the file when finished. The only environment variable currently consumed is `PORT`; `.env.example` lists integration planning variables but they are not configured or read automatically.

## Demo workflows available

1. **Public appointment** — Fill all six fields; date cannot be in the past; Pakistani mobile validation; API returns a unique reference and OPD token; WhatsApp action opens a prefilled deep link (no provider is connected).
2. **Queue synchronization** — Use Staff / ERP Login → select a demonstration role. Receptionist, Doctor and Super Admin sessions can load the persisted queue; SSE updates an open ERP when another booking is created. Session cookie is HttpOnly, SameSite=Strict and expires in eight hours. The role picker is deliberately a demo bypass, not identity verification.
3. **Doctor directory** — Super Admin demo role can add a sample doctor through the shared API; public directory / search / booking selector updates.
4. **Sample report lookup** — Only `RMH-DEMO-104` paired with `03246627054` returns a clearly synthetic non-clinical report. Other combinations return a generic not-found error. Never use this pattern as a real portal.
5. **Shared management workspace** — ERP resources use a common API for listing, adding, editing and archiving role-authorized synthetic records. Guided flows include bed admission/discharge with charge invoice, payment recording with balance checks, POS stock decrement and lab result entry / publish confirmation. Published CMS services, packages and articles feed the public website; newly authorized demo lab reports can be verified by their reference and registered mobile. These are prototype workflows and require audit/clinical validation before operational use.

## API surface (prototype)

- `GET /api/health` — reports demo mode / JSON storage.
- `GET /api/doctors` — public list of clearly fictional demo profiles.
- `POST /api/doctors` — demo-session Super Admin only; persisted to JSON and emits `doctor_directory_updated`.
- `POST /api/appointments` — public booking validation; persists a record and emits an event. Returns only the created booking to the caller, never the full queue.
- `POST /api/demo-session` / `POST /api/demo-role` / `POST /api/logout` — demonstration-only role session lifecycle.
- `GET /api/appointments` and `GET /api/events` — session required, role-gated to Super Admin / Receptionist / Doctor.
- `POST /api/reports/verify` — fixed synthetic sample only.
- `GET /api/dashboard` — protected role dashboard totals calculated from the local demo collections.
- `/api/resources/:resource` — role-policy-gated list/create/update/soft archive for configured ERP resources; guarded financial / clinical posting actions use dedicated workflows instead.
- `POST /api/workflows/admit`, `/discharge`, `/pharmacy-sale`, `/payment`, `/lab-result`, `/lab-publish` — focused prototype workflows with checks and shared JSON persistence.
- `GET /api/public-events` — publishes generic event names only (no patient payload) for directory refresh; `GET /api/audit` — Super Admin demo session only.

The Node server uses built-in libraries, same-origin requests, input length checks, basic per-IP rate limiting, restrictive cookie attributes, safe static file path resolution and basic security headers. It does **not** provide production-grade rate limiting, CSRF protection, account authentication, access review, encryption at rest, a hardened session store, comprehensive audit, or a reviewed threat model.

## Database setup / migration path

`database/schema.sql` is a PostgreSQL 15+ normalized starter schema. `database/seed.sql` inserts reference roles, permissions, departments, demo lab catalog items and unpublished illustrative packages; it deliberately does not create users/passwords or patient records. Requires PostgreSQL extensions `pgcrypto` and `citext` and DBA review.

```bash
createdb rana_medical
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f database/schema.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f database/seed.sql
```

The current server does **not** read `DATABASE_URL` and these SQL files are not wired as executable migrations. A production conversion should use versioned migrations (e.g. node-pg-migrate/Prisma), least-privilege DB roles, transactional posting for billing/stock/bed assignment, row-level access design, tested backups and recovery, secrets management, TLS, structured logs, and a properly reviewed identity provider. Store money in integer minor units (schema uses paisa) and expose currency as PKR.

## Quality checks

```bash
npm test
```

The workflow tests spin up an isolated server/store and verify appointment token creation and private queue access, fixed and dynamically published demo report verification, bed assignment/release and partial billing, pharmacy stock decrement, lab authorization, and role-gated doctor CMS. They do not certify clinical correctness, security or production readiness.

## Deploy / configure before launch

- Obtain and verify hospital address, email, clinical leadership, operational departments, on-call availability, OPD times, room/facility inventory, emergency dispatch capability, insurance panels, tariffs, packages and contact links.
- Replace all fictional staff, sample reviews, sample report data and illustrative claims. Validate PMDC details using authorized sources; do not add accreditation badges without documentary proof.
- Replace the demo role picker with secure server-side authentication, password hashing/SSO, MFA, audited role grants, CSRF defenses, session rotation/revocation, route-level policies and access checks for every patient-linked entity.
- Move all state to PostgreSQL; build and independently test the complete clinical, pharmacy, lab, billing, IPD, HR and CMS APIs before representing those modules as functional. Add workflow tests for the required full care paths and concurrency/rollback cases.
- Configure and test WhatsApp/SMS provider credentials, maps, email, payment provider and notification consent; until then the UI labels integrations as unconfigured or uses a WhatsApp link fallback.
- Run threat modeling, privacy impact/legal review, accessibility checks, load/security testing and disaster-recovery exercises. Restrict production access to authorized staff and use synthetic-only data in development.

## Project map

- `index.html` — 17 ordered public sections, four-sided CSS 3D medical cube, responsive website, accessible form labels, ERP shell, prototype interactions and print styles.
- `server.js` — zero-dependency Node API, JSON persistence, demo sessions, workflow routes and SSE.
- `backend/policies.js` — role/resource permission matrix, labels and reusable form schema definitions.
- `database/schema.sql` — normalized PostgreSQL schema starting point.
- `database/seed.sql` — reference-only seed data.
- `tests/workflows.test.js` — API integration smoke tests.
- `.env.example` — deployment planning template; most values are intentionally not active.
