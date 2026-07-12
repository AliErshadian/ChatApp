# ChatApp — Project Review (2026-07-13)

This document summarizes the current codebase, highlights strengths and weaknesses, and proposes a prioritized improvement roadmap.

## Overview

- **Product**: internal Slack-like chat (desktop + browser client + admin dashboard + API)
- **Backend**: NestJS (REST + Socket.IO realtime), PostgreSQL, Redis (presence + Socket.IO adapter), **MinIO** (S3-compatible object storage)
- **Clients**:
  - **Desktop**: Electron + React (Vite)
  - **Browser**: same React app for development (`localStorage` auth)
  - **Admin**: separate Vite + React app (`admin/`, port 5174)
- **Infra**: Docker Compose (Postgres/Redis/MinIO/API), production-like compose with Nginx reverse proxy
- **Repo layout**: **npm workspaces** monorepo — one root `package-lock.json`, workspaces `chatapp-backend`, `chatapp-desktop`, `chatapp-admin`

## Repository structure (high level)

```
ChatApp/
├── package.json             # npm workspaces root
├── package-lock.json        # single lockfile for all workspaces
├── backend/                 # NestJS API + realtime (chatapp-backend)
├── desktop/                 # Electron + React client (chatapp-desktop)
├── admin/                   # Admin dashboard (Vite + React, port 5174, chatapp-admin)
├── infra/                   # Postgres init + migrations + nginx
├── docs/                    # Architecture + this review
├── docker-compose.yml       # Local dev stack
├── docker-compose.prod.yml  # Prod-like stack (nginx + MinIO)
└── .github/workflows/       # CI/CD (root npm ci, workspace lint/build, Docker)
```

## What’s implemented today

### Backend (NestJS)

- **Modules**: `auth`, `users`, `contacts`, `conversations`, `messages`, `presence`, `realtime`, `audit`, `admin`, **`storage`**, **`calls`**
- **Auth & sessions**:
  - JWT access tokens (15m) with required `sid` claim; validated against `user_sessions` on every REST and WebSocket request
  - Rotating refresh tokens (SHA-256 hashed, grouped by `session_family_id`)
  - `user_sessions` table — device label, platform, IP, last active
  - `GET /auth/sessions`, terminate one / terminate all others
  - Realtime: `session:created`, `session:terminated` (remote logout)
  - Login reuses session for same device fingerprint; refresh preserves session
- **Messaging**:
  - Monotonic per-conversation `sequence`; `clientMessageId` dedup
  - Edit, delete (me / everyone), replies, forwards, reactions
  - Attachments via **MinIO** (S3-compatible); metadata in `attachments` table (migration `021`)
  - Client downloads via **API proxy** (`GET /attachments/:id/content`); presigned URLs remain on `/download` for optional use
  - MIME/size validation; UUID object keys
  - `@mentions` parsed server-side; stored in `message_mentions`
  - **Content search**: `GET /messages/search` — PostgreSQL FTS (`search_vector` + GIN), membership-scoped
  - Read/delivered receipts via realtime + `message_deliveries`
  - `sanitize-html` on text content
- **Conversations**:
  - DMs (pair uniqueness), channels, groups
  - Invites, avatars, pins, hide/leave, member roles
- **Realtime**:
  - Socket.IO `/realtime`, websocket-only transport (preferred)
  - **SSE fallback** — `GET /realtime/stream` for server → client when WebSocket is blocked; REST under `/realtime/*` for client → server actions
  - Redis pub/sub event bus (`rt:user:`, `rt:session:`, `rt:conversation:`) fans out to SSE subscribers across instances
  - Shared `RealtimeActionsService` + `RealtimeBroadcastService` used by WS gateway and REST fallback
  - Redis Socket.IO adapter when Redis is available
  - Room-based fanout (`conversation:`, `user:`, `session:`)
- **Voice calls** (`calls` module):
  - **1:1 DMs only** — groups/channels rejected server-side
  - In-memory call registry (`CallRegistryService`): ringing/active state, busy detection, 45s ring timeout
  - WebSocket signaling: `call:invite`, `call:accept`, `call:reject`, `call:end`, `call:signal` (offer/answer/ICE)
  - Server events: `call:incoming`, `call:accepted`, `call:ended`, forwarded `call:signal`
  - `GET /calls/ice-servers` — STUN from `WEBRTC_STUN_URLS`; optional TURN via `TURN_*` env
  - **Requires WebSocket** — not available when client falls back to SSE
- **Audit** (`audit` module, global):
  - Append-only `audit_logs` table (migration `019`)
  - Records auth, messages, conversations, contacts, profile, and admin actions
  - `GET /admin/audit-logs` with filters (user, action, category, date range, text)
- **Admin** (`admin` module):
  - `AdminGuard` — requires `users.is_admin` (migration `018`)
  - Dashboard stats, user list/detail, session management
  - Storage metrics: DB table sizes, **MinIO bucket object counts/sizes** (via `ListObjectsV2`), message kind breakdown
- **Object storage** (`storage` module):
  - `StorageService` + `S3StorageProvider` (AWS SDK v3, `forcePathStyle` for MinIO)
  - Buckets: `avatars`, `attachments`, `voice`, `videos`, `documents`, `backups`
  - REST: `POST/GET/DELETE /attachments/*`, streamed `GET /attachments/:id/content`, presigned `GET /attachments/:id/download`
  - **`GET /conversations/:id/attachments`** — list files shared in a chat (filter by kind, cursor pagination; respects hidden/deleted messages)
  - Integrated with message attachments, user avatars, conversation avatars
  - Audit actions: `attachment.upload`, `attachment.download`, `attachment.delete`
  - Extension hooks designed for virus scan, thumbnails (not implemented)
- **Observability**:
  - `pino-http` structured logging + request IDs
  - Sentry integration + global exception filter (returns JSON to client)
  - Prometheus metrics (WS connections, message counters)
  - `GET /api/v1/health`
- **DB**:
  - `infra/postgres/init.sql` for new databases (includes `schema_migrations` seed)
  - Incremental SQL migrations in `infra/postgres/migrations/` (002–021)
  - **Auto-applied** via `npm run migrate` / Compose `migrate` → `api`
  - **Drift check**: `npm run check:schema-drift` (CI) keeps `init.sql` aligned with migrations

### Admin client (`admin/`)

- Separate Vite + React app on port **5174** (`npm run dev:admin`, `npm run dev:all`)
- Own auth flow; uses admin JWT against `/api/v1/admin/*`
- **Dashboard**: platform stats, recent activity, collapsible storage panel (MinIO + DB)
- **Users**: role/status filters, sort, pagination, avatars; user detail with counts and sessions
- **Audit log**: expandable rows, date presets, action filter, debounced search, metadata copy

### Desktop / Browser client

- **Electron**: secure refresh-token store (`safeStorage`), tray, notifications, `chatapp://` invite links; dev loads `https://localhost:5173`
- **Browser (Vite dev)**: `localStorage` auth persistence; HTTPS dev server (`@vitejs/plugin-basic-ssl`, `host: true`); LAN via `https://<IP>:5173` with Vite proxy to backend; `endpoints.ts` resolves API/WS per host
- REST + Socket.IO (with automatic SSE + REST fallback when WebSocket fails)
- **UI features**:
  - Chat list with pins, unread badges, last-message preview
  - Mentions autocomplete + highlighted mention text
  - In-app toast notifications (mentions, new DM, added to group/channel, new device login)
  - Profile, contacts, conversation info, forward modal, attachment viewers (API content proxy + IndexedDB cache via `storageUrl.ts` / `mediaCache.ts`)
  - **File management** (per DM/group/channel): header 📁 button or conversation info → filter tabs (All, My uploads, Shared, Images, Videos, Documents, Audio, Voice); jump to message, preview, download
  - **Voice calls** (DMs only): 📞 in DM header; `VoiceCallModal` for incoming/active calls; WebRTC audio via `voiceCall.ts`; mute; mic permission handling (`mediaDevices.ts` with HTTPS/LAN guidance)
  - **Search**:
    - Sidebar: split panel (conversations on top, message content hits below)
    - Global: `Ctrl+K` / `Cmd+K` modal (chats, channels, people, messages)
    - Click message result → open chat, paginate history if needed, scroll + highlight
  - **Devices panel**: list sessions, terminate, terminate all others
  - **Offline cache** (Profile): IndexedDB blob cache with size stats and clear action
  - User-friendly auth error messages on login/register
- **Lint**: ESLint configured for backend, desktop, and admin; runs in CI

## Pros (what’s good)

- **Clear modular boundaries** — good foundation for team scaling and service extraction
- **Realtime scaling pattern** — Socket.IO + Redis adapter, websocket-only; SSE + REST fallback for restricted networks
- **Security baseline beyond typical MVP**:
  - bcrypt passwords, hashed refresh tokens, session revocation
  - WS auth on connect; session checked on each API use
  - DTO validation, throttling on auth, message sanitization
- **Thoughtful schema** — message ordering, dedup indexes, membership constraints, session tables
- **Dev ergonomics** — npm workspaces monorepo, root `npm run dev` / `dev:all`, compose stack, CI/CD from single lockfile
- **Object storage** — MinIO/S3; clients download through API proxy (LAN/mobile friendly); presigned URLs optional
- **Admin & audit** — separate admin app, storage visibility, append-only audit trail
- **Search UX** — unified conversation + message content search with jump-to-message
- **File management** — per-conversation shared files browser with media-type filters and jump-to-message
- **1:1 voice calls** — WebRTC + Socket.IO signaling for DMs; ICE endpoint; HTTPS dev for LAN microphone access
- **Session management** — practical Telegram-style device list with push logout

## Cons / risks (what can bite you in production)

### Security & configuration

- **CORS**: configurable allowlist; dev allows private LAN origins — tighten for production
- **Dependency audit**: routine `npm audit` / Dependabot recommended

### Correctness & performance

- **No automated tests** — auth, ACL, messaging, session, storage, and call signaling flows are untested in CI
- **Some gateway paths** still use per-member emits where room broadcast would suffice — watch fanout cost in large channels
- **Voice calls**: in-memory call registry is not shared across API instances; TURN not bundled (needed for some NAT/firewall setups)


## Recently addressed (2026-07)

- **1:1 voice calls (DMs)** — `calls` module (signaling, ICE servers, in-memory registry); desktop `voiceCall.ts`, `VoiceCallModal`, WebSocket `call:*` events; WebRTC audio with STUN/TURN env config; **WebSocket required** (not SSE)
- **HTTPS LAN dev for microphone** — Vite `@vitejs/plugin-basic-ssl` + proxy `/api` and `/socket.io`; `mediaDevices.ts` friendly errors; `endpoints.ts` same-origin proxy on `https://<LAN-IP>:5173`, direct `:3000` on localhost/Electron
- **Per-chat file management** — `GET /conversations/:id/attachments` with kind filters (`mine`, `shared`, `image`, `video`, etc.) and cursor pagination; `FileManagementPanel` in desktop client (header + conversation info entry points)
- **API-proxied media downloads** — `GET /attachments/:id/content` streams from MinIO through the API; clients use JWT + same host as chat (works on LAN/mobile without MinIO port exposure)
- **Client offline cache** — IndexedDB blob cache (`mediaCache.ts`); Profile → Offline cache (size + clear)
- **Admin storage panel** — MinIO bucket metrics via `ListObjectsV2`; compact UI with debounced search and mobile bottom nav
- **Admin avatars** — user list/detail show avatars via API content proxy + local cache
- **S3-compatible object storage (MinIO)** — `storage` module, `attachments` table, AWS SDK v3 provider; Docker Compose + `dev:infra` include MinIO; native MinIO supported for local dev without Docker
- **npm workspaces monorepo** — root `package.json` + single `package-lock.json`; `npm install` / `npm ci` at repo root; CI and Docker builds use workspace-aware layout
- **SSE realtime fallback** — `GET /realtime/stream` + `/realtime/*` REST actions; desktop client auto-falls back when WebSocket cannot connect
- **Redis session cache** — active/revoked session state cached in Redis; `last_active_at` DB writes debounced (~60s) on hot paths
- **Admin dashboard** — separate `admin/` app; user management, stats, storage panel
- **Audit log** — `audit_logs` table, global `AuditModule`, admin audit page with filters
- **Message content search** — `GET /messages/search`; sidebar split search + global search; jump-to-message with history pagination
- **Postgres FTS for messages** — `search_vector` column, GIN index, trigger (migration `020`)
- **Production env validation** — Zod checks for secrets, CORS, Redis, DB password, log level at startup
- **Migration runner** — `npm run migrate` (loads `backend/.env`), skip-already-applied for legacy DBs, Compose `migrate` → `api`
- **Schema drift guard** — `init.sql` seeds `schema_migrations` with migration checksums; `npm run check:schema-drift` runs in CI
- **Session-bound access tokens** — JWTs require `sid`; every REST/WS request checks `user_sessions`; revoke terminates tokens immediately
- **Secrets hygiene** — Zod production validation, `validate:env`, `generate:secrets`, `check:secrets` in CI, `.env` gitignored; access JWT rotation via `JWT_ACCESS_SECRET_PREVIOUS`
- **Admin CI** — lint/build job in GitHub Actions workflow
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

### P1 (high value next)

- **OpenAPI** for REST + formal realtime event catalog
- **Desktop release pipeline** (signed builds for Windows/Linux)

### P2 (polish and scale)

- Room-only fanout audit in gateway (remove remaining per-member loops)
- **TURN server** (e.g. coturn in Compose) for reliable voice calls behind symmetric NAT
- **Redis-backed call registry** if scaling voice signaling across multiple API instances

## Suggested “definition of done” for production readiness

- [ ] CI runs lint + build + **tests** (backend + desktop + admin)
- [x] CI runs lint + build today (backend + desktop + admin; root `npm ci`)
- [x] Production env validation (JWT secrets, CORS, Redis, DB password, log level)
- [x] CD publishes backend Docker image
- [x] WebSocket: CORS allowlist, websocket-only transport
- [x] SSE fallback for WebSocket-restricted networks
- [x] Secure token storage (Electron) + session revocation
- [x] Basic observability (structured logs, Sentry, health check)
- [x] Database migrations applied automatically in deploy (Compose `migrate` job)
- [x] Object storage for uploads (MinIO/S3 + API content proxy; presigned URLs optional)
- [ ] Explicit production CORS origins (no `*`)

## Backend observability env vars

| Variable | Purpose |
|----------|---------|
| `LOG_LEVEL` | Pino verbosity (`debug` dev, `info` prod) |
| `SENTRY_DSN` | Sentry project DSN (empty = disabled) |
| `SENTRY_RELEASE` | e.g. `chatapp-backend@1.0.0+abc123` |
| `SENTRY_TRACES_SAMPLE_RATE` | `0` dev; `0.01`–`0.05` prod |

## Object storage env vars

| Variable | Purpose |
|----------|---------|
| `S3_ENDPOINT` | MinIO/S3 host (use `127.0.0.1` on Windows to avoid IPv6 issues) |
| `S3_PORT` | API port (default `9000`) |
| `S3_SSL` | `true` / `false` |
| `S3_ACCESS_KEY` / `S3_SECRET_KEY` | Credentials |
| `S3_REGION` | AWS region for SDK (e.g. `us-east-1`) |
| `S3_BUCKET_*` | Bucket names per media category |
| `S3_PRESIGNED_URL_EXPIRES_SECONDS` | Presigned `/download` URL TTL (default `120`; optional external use) |
| `STORAGE_MAX_*_MB` | Upload size limits per category |
| `WEBRTC_STUN_URLS` | Comma-separated STUN URLs for voice calls |
| `TURN_URL` / `TURN_USERNAME` / `TURN_PASSWORD` | Optional TURN for restrictive NAT |

See `backend/.env.example` for defaults. Required in production (`NODE_ENV=production`).

## Related docs

- [README.md](../README.md) — quick start and API summary
- [ARCHITECTURE.md](./ARCHITECTURE.md) — system design, sessions, events, schema
