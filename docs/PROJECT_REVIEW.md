# ChatApp — Project Review (2026-07-10)

This document summarizes the current codebase, highlights strengths and weaknesses, and proposes a prioritized improvement roadmap.

## Overview

- **Product**: internal Slack-like chat (desktop + browser client + admin dashboard + API)
- **Backend**: NestJS (REST + Socket.IO realtime), PostgreSQL, Redis (presence + Socket.IO adapter)
- **Clients**:
  - **Desktop**: Electron + React (Vite)
  - **Browser**: same React app for development (`localStorage` auth)
  - **Admin**: separate Vite + React app (`admin/`, port 5174)
- **Infra**: Docker Compose (Postgres/Redis/API), production-like compose with Nginx reverse proxy

## Repository structure (high level)

```
ChatApp/
├── backend/                 # NestJS API + realtime gateway
├── desktop/                 # Electron + React client
├── admin/                   # Admin dashboard (Vite + React, port 5174)
├── infra/                   # Postgres init + migrations + nginx
├── docs/                    # Architecture + this review
├── docker-compose.yml       # Local dev stack
├── docker-compose.prod.yml  # Prod-like stack (nginx + persistent uploads)
└── .github/workflows/       # CI/CD (lint, build, docker publish)
```

## What’s implemented today

### Backend (NestJS)

- **Modules**: `auth`, `users`, `contacts`, `conversations`, `messages`, `presence`, `realtime`, `audit`, `admin`
- **Auth & sessions**:
  - JWT access tokens (15m) with `sid` session claim
  - Rotating refresh tokens (SHA-256 hashed, grouped by `session_family_id`)
  - `user_sessions` table — device label, platform, IP, last active
  - `GET /auth/sessions`, terminate one / terminate all others
  - Realtime: `session:created`, `session:terminated` (remote logout)
  - Login reuses session for same device fingerprint; refresh preserves session
- **Messaging**:
  - Monotonic per-conversation `sequence`; `clientMessageId` dedup
  - Edit, delete (me / everyone), replies, forwards, reactions
  - Attachments (multipart upload to local disk)
  - `@mentions` parsed server-side; stored in `message_mentions`
  - **Content search**: `GET /messages/search` — PostgreSQL FTS (`search_vector` + GIN), membership-scoped
  - Read/delivered receipts via realtime + `message_deliveries`
  - `sanitize-html` on text content
- **Conversations**:
  - DMs (pair uniqueness), channels, groups
  - Invites, avatars, pins, hide/leave, member roles
- **Realtime**:
  - Socket.IO `/realtime`, websocket-only transport
  - Redis adapter when Redis is available
  - Room-based fanout (`conversation:`, `user:`, `session:`)
- **Audit** (`audit` module, global):
  - Append-only `audit_logs` table (migration `019`)
  - Records auth, messages, conversations, contacts, profile, and admin actions
  - `GET /admin/audit-logs` with filters (user, action, category, date range, text)
- **Admin** (`admin` module):
  - `AdminGuard` — requires `users.is_admin` (migration `018`)
  - Dashboard stats, user list/detail, session management
  - Storage metrics: DB table sizes, upload folders, message kind breakdown
- **Observability**:
  - `pino-http` structured logging + request IDs
  - Sentry integration + global exception filter (returns JSON to client)
  - Prometheus metrics (WS connections, message counters)
  - `GET /api/v1/health`
- **DB**:
  - `infra/postgres/init.sql` for new databases
  - Incremental SQL migrations in `infra/postgres/migrations/` (001–020+)
  - **Gap**: migrations are manual SQL files, not applied automatically by the app

### Admin client (`admin/`)

- Separate Vite + React app on port **5174** (`npm run dev:admin`, `npm run dev:all`)
- Own auth flow; uses admin JWT against `/api/v1/admin/*`
- **Dashboard**: platform stats, recent activity chart, storage panel
- **Users**: role/status filters, sort, pagination; user detail with counts and sessions
- **Audit log**: expandable rows, date presets, action filter, metadata copy

### Desktop / Browser client

- **Electron**: secure refresh-token store (`safeStorage`), tray, notifications, `chatapp://` invite links
- **Browser (Vite dev)**: `localStorage` auth persistence; LAN host auto-routes API to same IP:3000
- REST + Socket.IO; optimistic sends with `clientMessageId`
- **UI features**:
  - Chat list with pins, unread badges, last-message preview
  - Mentions autocomplete + highlighted mention text
  - In-app toast notifications (mentions, new DM, added to group/channel, new device login)
  - Profile, contacts, conversation info, forward modal, attachment viewers
  - **Search**:
    - Sidebar: split panel (conversations on top, message content hits below)
    - Global: `Ctrl+K` / `Cmd+K` modal (chats, channels, people, messages)
    - Click message result → open chat, paginate history if needed, scroll + highlight
  - **Devices panel**: list sessions, terminate, terminate all others
  - User-friendly auth error messages on login/register
- **Lint**: ESLint configured for backend, desktop, and admin; runs in CI

## Pros (what’s good)

- **Clear modular boundaries** — good foundation for team scaling and service extraction
- **Realtime scaling pattern** — Socket.IO + Redis adapter, websocket-only
- **Security baseline beyond typical MVP**:
  - bcrypt passwords, hashed refresh tokens, session revocation
  - WS auth on connect; session checked on each API use
  - DTO validation, throttling on auth, message sanitization
- **Thoughtful schema** — message ordering, dedup indexes, membership constraints, session tables
- **Dev ergonomics** — root `npm run dev`, `dev:all` (backend + desktop + admin), compose stack, CI/CD
- **Admin & audit** — separate admin app, storage visibility, append-only audit trail
- **Search UX** — unified conversation + message content search with jump-to-message
- **Session management** — practical Telegram-style device list with push logout

## Cons / risks (what can bite you in production)

### Security & configuration

- **Secrets**: production must use strong JWT secrets; no centralized env schema validation yet
- **CORS**: configurable allowlist; dev allows private LAN origins — tighten for production
- **JWT access tokens** cannot be revoked mid-TTL except via session invalidation (mitigated by short TTL + `sid` check)
- **Dependency audit**: routine `npm audit` / Dependabot recommended

### Correctness & performance

- **No automated tests** — auth, ACL, messaging, and session flows are untested in CI
- **Uploads on local disk** — breaks horizontal scaling; architecture assumes S3/MinIO later
- **Message search at scale** — Postgres FTS with GIN index; consider Meilisearch/Elasticsearch only if cross-service search is required
- **Some gateway paths** still use per-member emits where room broadcast would suffice — watch fanout cost in large channels
- **Session DB check per request** — fine for MVP; consider Redis session cache at scale

### Operations

- **Migrations**: SQL files exist but require manual application on existing DBs; easy to drift from `init.sql`
- **Sentry filter** must delegate to Nest’s base handler (fixed) so API errors return JSON instead of hanging clients

## Recently addressed (2026-07)

- **Admin dashboard** — separate `admin/` app; user management, stats, storage panel
- **Audit log** — `audit_logs` table, global `AuditModule`, admin audit page with filters
- **Message content search** — `GET /messages/search`; sidebar split search + global search; jump-to-message with history pagination
- **Postgres FTS for messages** — `search_vector` column, GIN index, trigger (migration `020`)
- Device session management (`user_sessions`, JWT `sid`, terminate + remote logout)
- In-app notifications (mentions, new chats, group adds, new device login)
- Browser auth persistence (`localStorage`) and LAN API URL resolution
- Session reuse on same device (no duplicate sessions on restart)
- Login error handling (friendly messages, no stuck loading on 401)
- ESLint for backend, desktop, and admin
- CORS / websocket transport hardening
- Sentry + pino + basic Prometheus metrics

## What should be improved (prioritized roadmap)

### P0 (before real production)

- **Automated tests**: auth + refresh rotation, membership ACL, message send/edit/delete, session revoke
- **Migration runner**: apply `infra/postgres/migrations` automatically (Flyway, TypeORM migrations, or startup script)
- **Env validation**: fail fast on missing/weak secrets in production

### P1 (high value next)

- **Object storage** for uploads/avatars (S3/MinIO + pre-signed URLs)
- **OpenAPI** for REST + formal realtime event catalog
- **Desktop release pipeline** (signed builds for Windows/Linux)
- **Admin CI** — add `admin` lint/build to CI workflow

### P2 (polish and scale)

- Redis token-bucket rate limits for hot WS events
- Room-only fanout audit in gateway (remove remaining per-member loops)
- Session presence cache to reduce DB reads
- SSE fallback for WebSocket-restricted networks

## Suggested “definition of done” for production readiness

- [ ] CI runs lint + build + **tests** (backend + desktop + admin)
- [x] CI runs lint + build today (backend + desktop)
- [x] CD publishes backend Docker image
- [x] WebSocket: CORS allowlist, websocket-only transport
- [x] Secure token storage (Electron) + session revocation
- [x] Basic observability (structured logs, Sentry, health check)
- [ ] Database migrations applied automatically in deploy
- [ ] Object storage for uploads
- [ ] Explicit production CORS origins (no `*`)

## Backend observability env vars

| Variable | Purpose |
|----------|---------|
| `LOG_LEVEL` | Pino verbosity (`debug` dev, `info` prod) |
| `SENTRY_DSN` | Sentry project DSN (empty = disabled) |
| `SENTRY_RELEASE` | e.g. `chatapp-backend@1.0.0+abc123` |
| `SENTRY_TRACES_SAMPLE_RATE` | `0` dev; `0.01`–`0.05` prod |

## Related docs

- [README.md](../README.md) — quick start and API summary
- [ARCHITECTURE.md](./ARCHITECTURE.md) — system design, sessions, events, schema
