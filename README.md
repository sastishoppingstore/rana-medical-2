# Rana Medical — Clinic 2

Full-stack hospital workspace app: static frontend (single index.html with embedded ERP workspace) + Vercel serverless demo API + original local Node.js reference backend.

## Layout
- `web/` — static frontend (deployed to Firebase Hosting at `https://wafasmart.tech/clinic2`)
- `api/` — Vercel serverless backend (deployed as its own Vercel project)
- `workspace-src/` — original local Node.js backend sources (server.js, schema.sql, seed.sql, demo-state.json)

## Backend (Vercel project `rana-medical-clinic2`)
- Auth: stateless HMAC bearer token (`rmh_demo_token` in localStorage, injected by the frontend fetch patch).
- Data: one Supabase Postgres database, table `demo_state` (single-row JSONB) — variant 2 seed (different doctor/patient names than clinic 1).
- Env var on Vercel: `DATABASE_URL` (Supabase transaction pooler, port 6543):
  `postgresql://<user>:<pass>@aws-1-ap-south-1.pooler.supabase.com:6543/clinic2`

## Local dev
```bash
cd workspace-src && npm install && node server.js   # original local server
# or use the serverless variant:
cd api && npm install && DATABASE_URL=... node local-server.js
```
