# RELAY Architecture

Internal team chat: NestJS API, PostgreSQL, Redis, MinIO, Electron/browser client, and an admin dashboard. Auth is provider-based (local + optional Active Directory). Realtime prefers Socket.IO and falls back to SSE when WebSocket is blocked.

---

## Contents

1. [System overview](#1-system-overview)
2. [Monorepo layout](#2-monorepo-layout)
3. [Module boundaries](#3-module-boundaries)
4. [Auth & sessions](#4-auth--sessions)
5. [Realtime](#5-realtime)
6. [Message delivery](#6-message-delivery)
7. [Feature domains](#7-feature-domains)
8. [Database](#8-database)
9. [Object storage](#9-object-storage)
10. [Security](#10-security)
11. [Clients](#11-clients)
12. [Admin & audit](#12-admin--audit)
13. [Scaling & trade-offs](#13-scaling--trade-offs)
14. [Observability](#14-observability)
15. [Configuration](#15-configuration)
16. [API & event reference](#16-api--event-reference)

---

## 1. System overview

```
┌──────────────────────────────────────────────────────────────────────────┐
│                            CLIENT TIER                                   │
│  ┌────────────────────┐  ┌────────────────────┐  ┌────────────────────┐  │
│  │ Electron Desktop   │  │ Browser (Vite)     │  │ Admin Web :5174    │  │
│  │ React · REST + WS  │  │ Same React client  │  │ Users · auth ·     │  │
│  │ Secure auth store  │  │ localStorage       │  │ audit · storage    │  │
│  └─────────┬──────────┘  └─────────┬──────────┘  └─────────┬──────────┘  │
└────────────┼───────────────────────┼───────────────────────┼─────────────┘
             │              HTTPS / WSS (TLS at edge)        │
             ▼                       ▼                       ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                     EDGE / LOAD BALANCER (nginx · ALB)                   │
└──────────────────────────────────┬───────────────────────────────────────┘
                                   │
              ┌────────────────────┼────────────────────┐
              ▼                    ▼                    ▼
        ┌──────────┐         ┌──────────┐         ┌──────────┐
        │ API · 1  │         │ API · 2  │   ···   │ API · N  │
        │ NestJS   │         │ NestJS   │         │ NestJS   │
        └────┬─────┘         └────┬─────┘         └────┬─────┘
             └────────────────────┼────────────────────┘
                                  │
             ┌────────────────────┼────────────────────┐
             ▼                    ▼                    ▼
      ┌────────────┐       ┌────────────┐       ┌────────────┐
      │ PostgreSQL │       │   Redis    │       │ MinIO (S3) │
      │ metadata   │       │ presence · │       │ blobs      │
      │ sessions · │       │ Socket.IO  │       │ avatars ·  │
      │ directory  │       │ pub/sub    │       │ media      │
      └────────────┘       └────────────┘       └────────────┘
                                  │
                                  │  optional LDAPS
                                  ▼
                         ┌─────────────────┐
                         │ Active Directory│
                         └─────────────────┘
```

| Tier | Role |
|------|------|
| Clients | Electron desktop, browser SPA, admin dashboard |
| Edge | TLS termination, optional reverse proxy |
| API | Stateless NestJS instances (REST + Socket.IO + SSE) |
| Data | Postgres (source of truth), Redis (presence / pub-sub / caches), MinIO (blobs) |
| Directory | Optional Windows AD for enterprise login |

---

## 2. Monorepo layout

npm workspaces — one lockfile, root scripts orchestrate workspaces with `-w <package>`.

```
RELAY/
├── package.json                 # workspaces + root scripts
├── package-lock.json
├── scripts/setup-env.js         # copy *.env.example → .env
├── backend/                     # relay-backend · NestJS API
├── desktop/                     # relay-desktop · Electron + React
├── admin/                       # relay-admin · Vite admin UI
├── infra/
│   ├── postgres/                # init.sql · migrations/
│   └── docker/migrate.Dockerfile
├── docs/
├── docker-compose.yml
└── docker-compose.prod.yml
```

| Directory | Package | Role |
|-----------|---------|------|
| `backend/` | `relay-backend` | REST, WebSocket, SSE, migrations |
| `desktop/` | `relay-desktop` | Chat UI (Electron + browser) |
| `admin/` | `relay-admin` | Admin dashboard (`:5174`) |

> Nest’s `backend/src/modules/admin/` is the **Admin API**, not the `admin/` frontend workspace.

### Root scripts

| Script | Purpose |
|--------|---------|
| `npm run setup` | Env templates + install |
| `npm run dev` / `dev:all` | Concurrent local stack |
| `npm run dev:infra` | Postgres + Redis + MinIO |
| `npm run build` / `lint` | All workspaces |
| `npm run migrate` | Apply SQL migrations |
| `npm run check:schema-drift` | `init.sql` ↔ migrations CI guard |

### CI / Docker

- **CI/CD** — root `npm ci`; images built with **repo root** as context (`backend/Dockerfile`)
- **Compose** — `api.build.context: .`, `dockerfile: backend/Dockerfile`
- **Migrate image** — `infra/docker/migrate.Dockerfile` runs `migrate.mjs`

---

## 3. Module boundaries

Modular monolith today; each Nest module is a future service candidate.

| Module | Responsibility | Future service |
|--------|----------------|----------------|
| `auth` | Login, JWT + refresh, device sessions, providers | Auth |
| `directory` | AD/LDAP config, bind encryption, sync, auth audit | Directory / IdP |
| `users` | Profiles, search, avatars | Users |
| `contacts` | Contact list | Contacts |
| `conversations` | DMs, channels, groups, ACL | Conversations |
| `messages` | Persistence, threads, polls, search, reactions | Messaging |
| `calls` | 1:1 DM voice/video signaling + history | Calls |
| `tasks` | Tasks + assignment acceptance | Tasks |
| `notes` | Personal/shared notes + revisions | Notes |
| `stories` | 24h ephemeral stories | Stories |
| `storage` | S3 uploads, content proxy, scanning | Storage |
| `audit` | Append-only audit trail | Audit |
| `admin` | Stats, users, storage metrics | Admin API |
| `presence` | Online / typing | Presence |
| `realtime` | Gateway, broadcast, SSE bus | Realtime |

---

## 4. Auth & sessions

Provider-based auth; local and AD share one token path. Sessions are Telegram-style **device sessions**.

### Providers

```
                 ┌────────────────────────┐
                 │ AuthenticationManager  │
                 └───────────┬────────────┘
              ┌──────────────┴──────────────┐
              ▼                             ▼
     ┌─────────────────┐          ┌──────────────────────┐
     │ LocalAuthProvider│          │ ActiveDirectoryAuth  │
     │ email + bcrypt   │          │ LDAP bind + provision│
     └────────┬─────────┘          └──────────┬───────────┘
              └───────────────┬───────────────┘
                              ▼
                   AuthService.issueTokens
                   (user_sessions · JWT · refresh)
```

- Interface: `IAuthenticationProvider` under `backend/src/modules/auth/providers/`
- Config in `directory_configurations` (≈5s cache; admin PUT invalidates — **no restart**)
- AD passwords never stored; `users.password_hash` nullable for directory users
- Bind password encrypted at rest (`DIRECTORY_ENCRYPTION_KEY`, AES-256-GCM)

### Device sessions

```
Client (+ clientInfo) ──login──► user_sessions (device_label, ip, last_active)
                                      │ 1:N
Access JWT { sub, email, sid }        ▼
REST / WS ◄── validate sid ──── refresh_tokens (session_family_id)
```

| Step | Behavior |
|------|----------|
| Login / register | Sends `clientInfo`; reuses session row for same device when possible |
| Provider login | `POST /auth/login` with `provider` + `email` or `username` |
| AD success | LDAP auth → policy/groups → create/sync user → same tokens |
| Refresh | Rotates opaque refresh token; **same** `sessionId` |
| Access token | Requires `sid`; REST + WS check revocation (Redis → DB) |
| Terminate | Revoke DB + refresh, invalidate cache, `session:terminated`, disconnect sockets |
| New device | `session:created` to other sessions |

| Runtime | Access | Refresh | Session id |
|---------|--------|---------|------------|
| Electron | Renderer memory | Main-process encrypted file | With session |
| Browser | Memory | `localStorage` | `localStorage` + JWT `sid` |

---

## 5. Realtime

### WebSocket (preferred)

```
                 ┌─────────────┐
                 │ Redis Pub/Sub│
                 └──────┬──────┘
         ┌──────────────┼──────────────┐
         ▼              ▼              ▼
   ┌──────────┐   ┌──────────┐   ┌──────────┐
   │ API · WS │   │ API · WS │   │ API · WS │
   │ + adapter│   │ + adapter│   │ + adapter│
   └──────────┘   └──────────┘   └──────────┘
```

- Namespace `/realtime`, `transports: ['websocket']` only (no sticky sessions)
- Rooms: `conversation:{id}`, `user:{userId}`, `session:{sessionId}`
- `@socket.io/redis-adapter` fans room events across instances
- Connect: JWT + active session → join user/session rooms → presence
- Every handler: `WsJwtGuard` (session re-check) + membership / rate limits on sensitive events

### SSE fallback

When WebSocket is blocked, clients use **SSE** inbound + **REST** under `/api/v1/realtime/*` outbound.

```
Client ── WS (preferred) ──► RealtimeGateway
   │                              │
   │ SSE /realtime/stream         │ emit + Redis bus
   │ REST /realtime/*             ▼
   └─────────────────────► RealtimeBroadcast + RealtimeSseService
```

| Piece | Role |
|-------|------|
| `RealtimeEventBusService` | Redis channels `rt:user:*`, `rt:session:*`, `rt:conversation:*`, `rt:global` |
| `RealtimeBroadcastService` | Socket.IO rooms **and** bus publish (multi-instance SSE) |
| `RealtimeActionsService` | Shared send / read / typing used by WS + REST |

Auth on the stream: `Authorization: Bearer` or `access_token` query (for native `EventSource`). Keepalive every 25s.

Desktop (`realtime.ts`): try WebSocket (~8s), then EventSource + REST. **Calls require WebSocket** — disabled in SSE mode.

---

## 6. Message delivery

```
Client A                API                     Postgres / Redis              Client B
   │── message:send ───►│                           │                           │
   │                    │── assertMember ──────────►│                           │
   │                    │── INSERT + sequence ─────►│                           │
   │                    │── room conversation:{id} ─┼──────────────────────────►│
   │◄── message:ack ────│                           │         message:receive   │
```

| Guarantee | Detail |
|-----------|--------|
| Ordering | Monotonic `sequence` per conversation (`GENERATED ALWAYS AS IDENTITY`) |
| Dedup | `clientMessageId` — idempotent sends |
| Cross-chat | No global order across conversations |

Timeline endpoints return **roots only** (`thread_root_id IS NULL`). Replies use thread APIs.

---

## 7. Feature domains

### Threads

| Piece | Purpose |
|-------|---------|
| `messages.thread_root_id` | Reply → absolute root (`NULL` = timeline) |
| `reply_count` / `latest_reply_at` | Denormalized on root |
| `message_thread_reads` | Per-user thread read cursor |

Realtime replies include `threadRootId` + `thread: { replyCount, latestReplyAt }` so clients update the chip without putting replies in the main feed.

### Group polls

Groups only (not DMs/channels). `content_type = application/vnd.relay.poll+json`.

| Table | Role |
|-------|------|
| `polls` | Question, anonymous, multi-choice, closed |
| `poll_options` | 2–10 options |
| `poll_votes` | Unique `(poll_id, user_id, option_id)` |

Sender closes; vote/close push viewer-specific `message:updated`.

### Tasks

Assignment acceptance: `unassigned` → `pending` (`pending_assignee_id`) → `assigned`. Realtime: `task:updated` / `task:deleted`.

### Notes

Roles: `owner` / `contributor` / `reader`. Optimistic `version` → `409` on stale write. Revisions in `note_revisions`. Realtime: `note:updated` / `note:deleted`.

### Stories

24h ephemeral media for author’s **contacts** (+ self). Views, likes, reply→DM with `story_id`. Realtime: `story:created` / `story:deleted`.

### Calls (1:1 DM)

WebRTC over Socket.IO signaling. One active call per user; **15s** ring timeout; in-memory registry (multi-instance needs Redis registry). History in `call_records`.

### Search & files

- **Search** — Postgres FTS (`search_vector` GIN), min 2 chars, membership-scoped
- **Attachments list** — `GET /conversations/:id/attachments?kind=…` with cursor pagination

---

## 8. Database

```
users ──┬── conversation_members ── conversations
        ├── messages
        │     ├── thread_root_id → messages
        │     ├── story_id → stories
        │     ├── polls → options → votes
        │     ├── attachments (metadata → MinIO)
        │     ├── mentions · reactions · deliveries · reads
        │     └── message_thread_reads
        ├── user_contacts
        ├── stories ── views / likes
        ├── tasks ── task_user_reads
        ├── notes ── members · revisions
        ├── refresh_tokens · user_sessions · call_records
        └── directory_* · authentication_audit_logs

direct_conversation_pairs · channel_invites · audit_logs
```

**Directory user fields** (migration `034`): `authentication_provider`, `ad_guid`, `ad_sid`, org fields, `directory_groups`; nullable `password_hash`.

| Delivery | Path |
|----------|------|
| Fresh DB | `infra/postgres/init.sql` (+ seeded `schema_migrations`) |
| Upgrades | `infra/postgres/migrations/*.sql` via `npm run migrate` |
| CI | `npm run check:schema-drift` |

**Hot indexes** (selected):

- `messages(conversation_id, sequence DESC)` — feed / roots partial / thread replies
- `messages(search_vector)` GIN — FTS
- `attachments(conversation_id, created_at DESC)`
- `user_sessions(user_id)` partial (not revoked)
- `tasks` / `notes` / `stories` / `call_records` list & badge indexes

---

## 9. Object storage

```
Client ── multipart upload ──► StorageService ──► MinIO / S3
                                  │
                                  ├── MIME · size · file scan
                                  ├── UUID object key
                                  └── attachments row (Postgres metadata)

Client ── GET /attachments/:id/content (JWT) ──► streamed bytes
```

| Principle | Detail |
|-----------|--------|
| Metadata in Postgres | `attachments` — never store blobs in DB |
| Keys | `chat/YYYY/MM/DD/{uuid}.{ext}` |
| Primary download | Authenticated API proxy (`/content`) |
| Optional | Short-lived presigned `/download` for integrations |
| Scanning | Dangerous / double extensions blocked; magic-byte sniff; optional ClamAV |

| Env | Default bucket | Content |
|-----|----------------|---------|
| `S3_BUCKET_AVATARS` | `avatars` | Avatars |
| `S3_BUCKET_ATTACHMENTS` | `attachments` | Images |
| `S3_BUCKET_VIDEOS` | `videos` | Video |
| `S3_BUCKET_VOICE` | `voice` | Audio |
| `S3_BUCKET_DOCUMENTS` | `documents` | PDF / Office / zip |
| `S3_BUCKET_BACKUPS` | `backups` | Reserved |

Clients resolve `/content` with JWT → optional IndexedDB cache (`mediaCache.ts`) → `blob:` URLs. Legacy `backend/uploads/` remains for pre-MinIO files only.

---

## 10. Security

### Tokens

1. Login → access JWT (15m, `sid`) + opaque refresh (7d, SHA-256 at rest)
2. REST: `Authorization: Bearer` · WS: `handshake.auth.token`
3. `401` → `POST /auth/refresh` (rotate refresh, same session)
4. Logout / revoke → terminate session + push `session:terminated`

### CSRF

Not required: access and refresh are **not** cookies — browsers do not auto-attach them cross-site. If refresh moves to `HttpOnly` cookies, add CSRF then.

### CSP

| Surface | Mechanism |
|---------|-----------|
| API | Helmet (`backend/src/config/csp.ts`) |
| Desktop / admin prod | Vite CSP meta (`desktop/csp.ts`, `admin/csp.ts`) |
| Electron packaged | Response header on navigations |
| nginx | CSP + frame deny + nosniff |

Dev Vite omits CSP so HMR works.

### WebSocket

- JWT + session on connect; `WsJwtGuard` on every event
- Membership / call checks on sensitive actions
- Removed members leave `conversation:{id}` rooms
- Per-action Redis token-bucket rate limits
- Session revoke → hard disconnect

### Login CAPTCHA

After `LOGIN_FAIL_CAPTCHA_THRESHOLD` (default **3**) failures in `LOGIN_FAIL_WINDOW_SECONDS` (default **900**): require CAPTCHA. Built-in math challenge by default; Cloudflare Turnstile when `TURNSTILE_*` keys are set.

### Uploads

Dangerous extensions, double-extension names, and MIME/content mismatch rejected. Optional ClamAV via `FILE_SCAN_CLAMAV_*`.

### AD / LDAP

LDAPS or StartTLS preferred; encrypted bind secret; group allow/deny + `system_admin` → `is_admin`; scheduled sync.

### Rate limits (selected)

| Target | Limit |
|--------|-------|
| Global HTTP | 100 / min / IP |
| `/auth/register` | 5 / min |
| `/auth/login` | 10 / min |
| WS `message:send` | Bucket 15 · refill 0.5/s |
| WS `user:typing` | 6 · 1.5/s per conversation |
| WS `call:invite` | 3 · 0.1/s |

Messages sanitized with `sanitize-html` (escape mode). Mentions parsed server-side.

### Secrets

Secrets live in **environment variables** (not source). `.env` is gitignored; production Zod validation rejects weak JWT/DB settings. No cloud Secret Manager integration yet — use protected env / orchestrator secrets in deploy.

---

## 11. Clients

### Chat (`desktop/` — `relay-desktop`)

```
AuthProvider → PresenceProvider → ChatPage
api.ts · realtime.ts · voiceCall.ts · mediaCache.ts
StoriesTray · ThreadPanel · FileManagementPanel · CallsPanel
TasksPanel · NotesPanel · SessionsPanel · search modals
```

| Flow | Summary |
|------|---------|
| Threads | Reply-in-thread / chip → `ThreadPanel`; roots-only timeline |
| Polls | Groups: create → tap-to-vote → sender closes |
| Files | Header / info → filter tabs → preview / jump / save |
| Calls | DM invite → ICE + WebRTC → history + missed badge |
| Tasks | Create / from-message → accept pending → realtime merge |
| Notes | List · editor · share · history diff · realtime |
| Stories | Tray rings · compose · viewer · like / reply→DM |
| Search | Sidebar or ⌘/Ctrl+K → chats + `GET /messages/search` |

**Dev HTTPS / LAN:** Vite `@vitejs/plugin-basic-ssl`, `host: true`, proxies `/api` + `/socket.io`. On `https://` LAN hosts, API/WS use same origin (proxy). Mic/camera need a secure context — use `https://192.168.x.x:5173`, not plain HTTP.

### Admin (`admin/` — `relay-admin`)

Same JWT; requires `users.is_admin`. Dashboard, users, authentication (LDAP), audit log. Media via the same `/content` proxy.

| Context | API / WS |
|---------|----------|
| localhost | `http://localhost:3000` |
| LAN HTTPS Vite | Same origin (proxy) |
| Production | Edge / host URLs |

Override with `VITE_API_URL` / `VITE_WS_URL`.

---

## 12. Admin & audit

```
admin/ app ── JWT + is_admin ──► AdminModule (/admin/*)
                                    ├── user stats · sessions
                                    ├── storage (DB + MinIO)
                                    ├── DirectoryModule (LDAP · sync)
                                    └── audit_logs (append-only)
```

- **`AuditService`** — fire-and-forget writes from auth, messages, conversations, contacts, notes, tasks, stories, admin
- **`AuthenticationAuditService`** — provider login / config / sync events
- **Storage metrics** — `pg_total_relation_size`, MinIO `ListObjectsV2`, media kind counts

---

## 13. Scaling & trade-offs

| Component | Scale | Notes |
|-----------|-------|-------|
| API + WebSocket | Horizontal | Stateless; Redis adapter required |
| PostgreSQL | Vertical + replicas | Single primary for writes |
| Redis | Cluster / Sentinel | Presence + Socket.IO + caches |
| MinIO / S3 | Horizontal | Shared; clients use API proxy |

| Decision | Upside | Cost |
|----------|--------|------|
| Modular monolith | Fast shipping, shared TX | Discipline at module edges |
| Socket.IO | Rooms + Redis adapter | Heavier than raw WS |
| `sid` in JWT | Fast revoke + Redis cache | User-active still DB on miss |
| Electron + browser | One React app | Two token storage paths |
| SQL migration files | Reviewable | Not ORM auto-migrate |
| npm workspaces | One lockfile | No shared `packages/*` yet |

---

## 14. Observability

| Concern | Implementation |
|---------|----------------|
| HTTP logs | `pino-http` + request IDs |
| Errors | Sentry (`SENTRY_DSN`) + global filter |
| Metrics | Prometheus (WS connections, sends, …) |
| Health | `GET /api/v1/health` |

---

## 15. Configuration

| Variable | Purpose | Default / notes |
|----------|---------|-----------------|
| `DATABASE_URL` | Postgres | required |
| `REDIS_URL` | Redis | required |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | Signing | required (strong in prod) |
| `JWT_ACCESS_EXPIRES_IN` / `JWT_REFRESH_EXPIRES_IN` | TTLs | `15m` / `7d` |
| `CORS_ORIGIN` | Allowlist | `*` (forbid in prod) |
| `S3_*` | Object storage | MinIO defaults in dev |
| `STORAGE_MAX_*_MB` | Upload caps | see `.env.example` |
| `WEBRTC_STUN_URLS` / `TURN_*` | Calls | Google STUN in dev |
| `DIRECTORY_ENCRYPTION_KEY` | LDAP bind encryption | set when AD enabled |
| `LOGIN_FAIL_CAPTCHA_THRESHOLD` | CAPTCHA after N fails | `3` |
| `TURNSTILE_*` | Optional CAPTCHA | unset → math challenge |
| `FILE_SCAN_CLAMAV_*` | Optional AV | unset → baseline scan only |

Env files (from `npm run setup`): root `.env`, `backend/.env`, optional `desktop/.env` / `admin/.env`.

Production: run `npm run validate:env --prefix backend` after `generate:secrets`.

---

## 16. API & event reference

Base path: `/api/v1`. All authenticated routes use `Authorization: Bearer <accessToken>` unless noted.

### Auth

```http
POST /auth/login
Content-Type: application/json

{ "provider": "local", "email": "alice@company.com", "password": "…", "clientInfo": { … } }
```

```http
POST /auth/login
{ "provider": "active_directory", "username": "alice", "password": "…", "clientInfo": { … } }
```

```http
GET /auth/providers
GET /auth/login/protection?identifier=
POST /auth/captcha/challenge
GET /auth/sessions
```

Success response (local and AD identical):

```json
{
  "user": { "id": "…", "email": "…", "username": "alice", "displayName": "Alice" },
  "accessToken": "eyJ…",
  "refreshToken": "…",
  "expiresIn": 900,
  "sessionId": "550e8400-…"
}
```

### Messages & threads

```http
GET /conversations/{id}/messages?cursor=1042
GET /conversations/{id}/messages/{rootId}/thread
GET /conversations/{id}/messages/{rootId}/thread/search?q=hello
GET /conversations/{id}/messages/unread-threads
GET /messages/search?q=hello&limit=40
```

### Polls · tasks · notes · stories · calls · files

| Area | Endpoints (representative) |
|------|----------------------------|
| Polls | `POST …/polls`, `…/vote`, `…/close` |
| Tasks | `POST /tasks`, `…/assign`, `…/accept`, `…/reject`, pending unseen |
| Notes | `GET/POST/PATCH/DELETE /notes`, members, history |
| Stories | `GET /stories/feed`, `POST /stories`, view / like / reply |
| Calls | `GET /calls/ice-servers`, `GET /calls/history`, missed seen |
| Files | `GET /conversations/{id}/attachments?kind=image` |

### WebSocket events

**Client → server:** `message:send`, `message:delivered|read|edit|delete|reaction`, `user:typing`, `conversation:join|leave|delete`, `presence:heartbeat|query`, `call:invite|accept|reject|end|signal`.

**Server → client:** `message:receive|ack|updated|status`, `user:typing|presence`, `session:created|terminated`, `conversation:*`, `task:*`, `note:*`, `story:*`, `call:*`.

Example send:

```json
{
  "conversationId": "…",
  "content": "Hey @bob",
  "clientMessageId": "client-uuid",
  "replyToMessageId": "optional",
  "threadRootId": "optional-root"
}
```

### SSE REST substitutes

| Method | Path | Replaces |
|--------|------|----------|
| POST | `/realtime/messages/send` | `message:send` |
| POST | `/realtime/messages/*` | delivered / read / edit / delete / reaction |
| POST | `/realtime/typing` | `user:typing` |
| POST | `/realtime/presence/*` | heartbeat / query |
| POST | `/realtime/conversations/:id/join` | join (SSE subscription) |

```http
GET /realtime/stream?access_token=<JWT>
Accept: text/event-stream
```
