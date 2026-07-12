# ChatApp System Architecture

## 1. High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           CLIENT TIER                                       │
│  ┌──────────────────────┐    ┌──────────────────────┐    ┌────────────────┐ │
│  │  Electron Desktop    │    │  Browser (Vite dev)  │    │  Admin Web     │ │
│  │  Windows / Linux     │    │  LAN or localhost    │    │  (port 5174)   │ │
│  │  ┌────────────────┐  │    │  ┌────────────────┐  │    │  Dashboard,    │ │
│  │  │ React Renderer │  │    │  │ React (same)   │  │    │  users, audit  │ │
│  │  │ REST + WS      │  │    │  │ localStorage   │  │    │  REST only     │ │
│  │  └───────┬────────┘  │    │  └───────┬────────┘  │    └───────┬────────┘ │
│  │  Main: tray, secure  │    │                      │            │          │
│  │  auth store, notify  │    │                      │            │          │
│  └──────────┼──────────┘    └──────────┼───────────┘            │          │
└─────────────┼──────────────────────────┼──────────────────────────┼──────────┘
              │ HTTPS / WSS (TLS at edge)  │                          │
              ▼                            ▼                          ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                        EDGE / LOAD BALANCER                                 │
│                   (nginx / ALB — TLS termination)                           │
└──────────────────────────────┬────────────────────────────────────────────┘
                               │
              ┌────────────────┼────────────────┐
              ▼                ▼                ▼
┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐
│   API Instance 1 │ │   API Instance 2 │ │   API Instance N │
│  Auth, Users,    │ │  Contacts, Conv, │ │  Messages,       │
│  Messages,       │ │  Presence,       │ │  Realtime GW     │
│  Realtime GW     │ │  Realtime GW     │ │                  │
└────────┬─────────┘ └────────┬─────────┘ └────────┬─────────┘
         └────────────────────┼────────────────────┘
                              │
         ┌────────────────────┼────────────────────┐
         ▼                    ▼                    ▼
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│   PostgreSQL    │  │     Redis       │  │  MinIO (S3)     │
│  users, msgs,   │  │  presence,      │  │  avatars,       │
│  attachments    │  │  Socket.IO      │  │  attachments,   │
│  (metadata),    │  │  pub/sub        │  │  videos, etc.   │
│  sessions, etc. │  │                 │  │                 │
└─────────────────┘  └─────────────────┘  └─────────────────┘
```

## 2. Repository & Monorepo Layout

The codebase is an **npm workspaces** monorepo: one Git repository, one root `package-lock.json`, and three workspace packages. Dependencies are installed and locked at the repository root; root scripts delegate to workspaces with `-w <package-name>`.

```
ChatApp/
├── package.json              # workspaces root + dev/build/lint orchestration
├── package-lock.json         # single lockfile for all workspaces
├── scripts/
│   └── setup-env.js          # copies .env.example → .env (root + each workspace)
├── backend/                  # workspace: chatapp-backend (NestJS API)
├── desktop/                  # workspace: chatapp-desktop (Electron + React)
├── admin/                    # workspace: chatapp-admin (Vite + React admin UI)
├── infra/
│   ├── postgres/             # init.sql, migrations/
│   └── docker/
│       └── migrate.Dockerfile
├── docs/
├── docker-compose.yml
└── docker-compose.prod.yml
```

### Workspace packages

| Directory | Package name | Role |
|-----------|--------------|------|
| `backend/` | `chatapp-backend` | NestJS REST API, WebSocket gateway, migrations |
| `desktop/` | `chatapp-desktop` | Electron shell + React chat client (browser dev via Vite) |
| `admin/` | `chatapp-admin` | Admin dashboard (port 5174) |

There is no `apps/` or `packages/` split today — top-level workspace folders are sufficient for three deployable apps with no shared library package yet.

### Root scripts (from repository root)

| Script | Workspace | Purpose |
|--------|-----------|---------|
| `npm install` / `npm ci` | all | Install or reproduce all workspace dependencies |
| `npm run setup` | all | Copy env templates + `npm install` |
| `npm run dev:backend` | `chatapp-backend` | Nest watch mode |
| `npm run dev:desktop` | `chatapp-desktop` | Electron + Vite dev |
| `npm run dev:admin` | `chatapp-admin` | Admin Vite dev server |
| `npm run dev` / `dev:all` | multiple | Concurrent dev processes |
| `npm run dev:infra` | Docker | Postgres + Redis + MinIO (+ bucket init) |
| `npm run build` | all | Production builds |
| `npm run lint` | all | ESLint in every workspace |
| `npm run migrate` | `chatapp-backend` | Apply SQL migrations |
| `npm run check:schema-drift` | `chatapp-backend` | CI guard: `init.sql` vs migrations |

Per-workspace commands also work, e.g. `npm run build -w chatapp-backend`.

### CI/CD and Docker (monorepo-aware)

- **CI** (`.github/workflows/ci.yml`): `npm ci` at repo root; lint/build/checks run with `-w chatapp-*`. Docker image build uses **repository root** as context (`backend/Dockerfile`).
- **CD** (`.github/workflows/cd.yml`): publishes the backend image from the same root context.
- **API image** (`backend/Dockerfile`): copies root `package.json` + `package-lock.json` and `backend/package.json`, then `npm ci -w chatapp-backend` (prod deps only in the runtime stage).
- **Migrate image** (`infra/docker/migrate.Dockerfile`): same workspace install pattern; runs `backend/scripts/migrate.mjs` against `infra/postgres/migrations/`.
- **Compose** (`docker-compose.yml`, `docker-compose.prod.yml`): `api` service `build.context` is `.` (repo root), `dockerfile: backend/Dockerfile`.

Backend and admin modules inside NestJS (`backend/src/modules/admin/`) are unrelated to the `admin/` frontend workspace — the table in §3 uses Nest module names; the `admin/` folder is the separate admin web client.

## 3. Service Boundaries (Modular Monolith → Microservices Path)

The MVP ships as a **modular monolith** with clean boundaries:

| Module | Responsibility | Future Service |
|--------|---------------|----------------|
| `auth` | Registration, login, JWT + refresh rotation, **device sessions** | Auth Service |
| `users` | Profiles, search, avatars | User Service |
| `contacts` | Contact list | Contacts Service |
| `conversations` | DMs, channels, groups, invites, membership ACL | Conversation Service |
| `messages` | Persistence, ordering, sanitization, mentions, attachments, reactions, **content search** | Messaging Service |
| `storage` | S3-compatible object storage (upload, delete, presigned URLs, `attachments` metadata) | Storage Service |
| `audit` | Append-only audit trail for user and admin actions | Audit Service |
| `admin` | Admin-only stats, user management, storage metrics, audit log API | Admin API |
| `presence` | Online/offline, typing (Redis + in-memory connection registry) | Presence Service |
| `realtime` | WebSocket gateway, event routing, session push events | Realtime Gateway |

Extraction path: each module owns its entities and services; split by deploying separate NestJS apps with shared contracts.

## 4. Message Delivery Event Flow

```
Client A                    API Gateway              PostgreSQL        Redis           Client B
   │                            │                       │               │                │
   │── message:send ───────────►│                       │               │                │
   │   {conversationId,         │                       │               │                │
   │    content, clientMsgId}   │                       │               │                │
   │                            │── assertMember() ────►│               │                │
   │                            │── INSERT message ────►│               │                │
   │                            │◄── id, sequence ──────│               │                │
   │                            │                       │               │                │
   │                            │── emit conversation room ──────────────────────────────►│
   │                            │   conversation:{id}   │               │ message:receive│
   │                            │── user rooms (activity) ─────────────────────────────►│
   │◄── message:ack ────────────│                       │               │                │
```

### Ordering Guarantees

- Monotonic `sequence` per conversation (PostgreSQL `GENERATED ALWAYS AS IDENTITY`)
- Client deduplication via `clientMessageId` (idempotent sends on reconnect)
- Cross-conversation ordering is not guaranteed

## 5. Session & Auth Architecture

Telegram-style **device sessions** tie refresh tokens and access tokens to a logical device.

```
┌─────────────┐     login/register      ┌──────────────────┐
│   Client    │ ───────────────────────►│  user_sessions   │
│  clientInfo │     sessionId (UUID)    │  device_label    │
│ Chrome, Win │                         │  ip, last_active │
└─────────────┘                         └────────┬─────────┘
       │                                         │
       │ access JWT { sub, email, sid }          │ 1:N
       ▼                                         ▼
┌─────────────┐                         ┌──────────────────┐
│  REST / WS  │◄── validate sid ────────│ refresh_tokens   │
│  requests   │                         │ session_family_id│
└─────────────┘                         └──────────────────┘
```

**Behaviors:**

1. **Login/register** sends `clientInfo` (`deviceLabel`, `platform`, `clientType`, `appName`). Same device reuses an existing session row when possible.
2. **Refresh** rotates the opaque refresh token but keeps the same `sessionId`.
3. **Access token** carries required `sid`; every REST request and WebSocket message validates the session is not revoked (Redis cache first, PostgreSQL on miss).
4. **Terminate session** revokes DB row + refresh tokens, invalidates Redis session cache, emits `session:terminated`, and disconnects sockets.
5. **New login** on another device emits `session:created` to other sessions (excluding the new one).
6. **Session cache** (`SessionCacheService`): `session:valid:{sid}` (TTL = access token lifetime), `session:revoked:{sid}` (short negative cache); `last_active_at` DB writes debounced to ~60s per session.

**Client storage:**

| Runtime | Access token | Refresh token | Session id |
|---------|--------------|---------------|------------|
| Electron | Renderer memory | Main process encrypted file | Stored with session |
| Browser | Memory + short-lived in memory | `localStorage` | `localStorage` + JWT `sid` |

## 6. WebSocket Scaling (Multi-Instance)

```
                    ┌─────────────┐
                    │   Redis     │
                    │  Pub/Sub    │
                    └──────┬──────┘
           ┌───────────────┼───────────────┐
           ▼               ▼               ▼
    ┌────────────┐  ┌────────────┐  ┌────────────┐
    │ Instance 1 │  │ Instance 2 │  │ Instance 3 │
    │ Socket.IO  │  │ Socket.IO  │  │ Socket.IO  │
    │ + Adapter  │  │ + Adapter  │  │ + Adapter  │
    └────────────┘  └────────────┘  └────────────┘
```

- `@socket.io/redis-adapter` propagates room events across instances
- Rooms: `conversation:{id}`, `user:{userId}`, `session:{sessionId}`
- `transports: ['websocket']` only — no sticky sessions required
- Presence: Redis keys + in-memory per-instance connection counts

## 7. Horizontal Scaling Strategy

| Component | Scale Method | Notes |
|-----------|-------------|-------|
| API + WebSocket | Horizontal | Stateless; Redis adapter required |
| PostgreSQL | Vertical + read replicas | Single primary for writes |
| Redis | Cluster / Sentinel | Presence + Socket.IO pub/sub |
| Object storage (MinIO/S3) | Horizontal | Shared across API instances; presigned URL downloads |

## 8. Trade-offs

| Decision | Pros | Cons |
|----------|------|------|
| Modular monolith | Fast iteration, shared transactions | Requires discipline at module edges |
| Socket.IO | Rooms, Redis adapter | Heavier than raw WebSocket |
| Session in JWT (`sid`) | Fast revocation check; Redis cache avoids per-request session DB reads | User active check still hits DB; cache invalidated immediately on revoke |
| Electron + browser client | One React codebase | Two auth storage paths to maintain |
| SQL migration files | Simple, reviewable | Not auto-applied by ORM yet |
| npm workspaces monorepo | One install/lockfile, root orchestration scripts | No shared `packages/*` library yet; clients duplicate types |

## 9. REST API Payload Examples

### Register / Login

```http
POST /api/v1/auth/login
Content-Type: application/json

{
  "email": "alice@company.com",
  "password": "securepass123",
  "clientInfo": {
    "clientType": "browser",
    "platform": "Windows",
    "appName": "Chrome",
    "deviceLabel": "Chrome, Windows",
    "userAgent": "Mozilla/5.0 ..."
  }
}
```

```json
{
  "user": { "id": "...", "email": "...", "username": "alice", "displayName": "Alice Smith" },
  "accessToken": "eyJhbG...",
  "refreshToken": "a1b2c3...",
  "expiresIn": 900,
  "sessionId": "550e8400-e29b-41d4-a716-446655440099"
}
```

### List active sessions

```http
GET /api/v1/auth/sessions
Authorization: Bearer eyJhbG...
```

```json
[
  {
    "sessionId": "550e8400-...",
    "appName": "Chrome",
    "deviceLabel": "Chrome, Windows",
    "platform": "Windows",
    "ipAddress": "192.168.1.10",
    "createdAt": "2026-07-09T12:00:00.000Z",
    "lastActiveAt": "2026-07-10T10:30:00.000Z"
  }
]
```

### List Messages (cursor pagination)

```http
GET /api/v1/conversations/{id}/messages?cursor=1042
Authorization: Bearer eyJhbG...
```

### Search Messages (full-text)

```http
GET /api/v1/messages/search?q=hello&limit=40
Authorization: Bearer eyJhbG...
```

- Minimum query length: 2 characters
- Scoped to conversations the user is a member of (excludes hidden chats/messages)
- **PostgreSQL FTS** on `messages.search_vector` (GIN index) — weighted `content`, `caption`, `file_name`
- Uses `simple` text config (language-neutral) with prefix matching (`term:*`)
- Maintained by DB trigger on insert/update; apply migration `020_message_search_fts.sql` on existing databases

## 10. WebSocket Event Payloads

### `message:send` (Client → Server)

```json
{
  "conversationId": "550e8400-e29b-41d4-a716-446655440010",
  "content": "Hey @bob, can you review this?",
  "clientMessageId": "client-uuid",
  "replyToMessageId": "optional-msg-uuid"
}
```

### `message:receive` (Server → Client)

Includes `mentions`, `reactions`, `replyTo`, attachment fields when applicable.

### `session:created` (Server → Client)

Sent to other devices when a new session is created:

```json
{
  "sessionId": "...",
  "deviceLabel": "Chrome, Windows",
  "appName": "Chrome",
  "platform": "Windows",
  "ipAddress": "192.168.1.10"
}
```

### `session:terminated` (Server → Client)

```json
{ "sessionId": "..." }
```

Client clears local auth and returns to login.

## 11. Database Schema Summary

```
users ─────────────┬──── conversation_members ──── conversations
                   │                                    │
                   ├──── messages ──────────────────────┘
                   │    ├── attachments (metadata → MinIO blobs)
                   │    ├── message_mentions
                   │    ├── message_reactions
                   │    ├── message_deliveries
                   │    └── message_read_receipts
                   │
                   ├──── user_contacts
                   ├──── refresh_tokens (session_family_id)
                   └──── user_sessions

direct_conversation_pairs ── conversations (DM uniqueness)
channel_invites ── conversations
audit_logs ── users (user_id, actor_user_id)
```

**Schema delivery:**

- `infra/postgres/init.sql` — full schema for new databases; seeds `schema_migrations` with checksums
- `infra/postgres/migrations/*.sql` — incremental changes; applied by `backend/scripts/migrate.mjs` (`npm run migrate` from repo root)
- `npm run check:schema-drift` — CI guard that `init.sql` matches all migration files (root script → `chatapp-backend`)

Key indexes:

- `messages(conversation_id, sequence DESC)` — feed pagination
- `messages(search_vector)` GIN — full-text message search
- `messages(conversation_id, sender_id, client_message_id)` — idempotent sends
- `audit_logs(created_at DESC)`, `audit_logs(action)` — admin audit queries
- `user_sessions(user_id)` partial where not revoked
- `refresh_tokens(user_id, session_family_id)` — session token lookup

## 12. Security Architecture

### JWT Auth Flow

```
1. Login → accessToken (15m, includes sid) + refreshToken (opaque, 7d)
2. refreshToken stored as SHA-256 hash; session metadata in user_sessions
3. REST: Authorization: Bearer; WS: auth.token on handshake
4. On 401 → POST /auth/refresh (rotates refresh token, same sessionId)
5. Logout / terminate → revoke session + refresh tokens; push session:terminated
6. validateAccessToken checks user active + session not revoked (Redis session cache → DB fallback)
```

### Secure WebSocket Handshake

- JWT verified in `handleConnection`; `AuthService.validateAccessToken` enforces session
- Join `user:{id}` and `session:{sid}` rooms
- `WsJwtGuard` on subscribed handlers; membership checked before join/send

### Rate Limiting

| Endpoint | Limit |
|----------|-------|
| Global | 100 req/min per IP |
| `/auth/register` | 5 req/min |
| `/auth/login` | 10 req/min |
| WS events | Per-user rate limit guard (partial) |

### Message Sanitization

Message content passes through `sanitize-html` (escape mode) to prevent stored XSS. Mentions parsed server-side and stored in `message_mentions`.

## 13. Client Architecture (Desktop / Browser / Admin)

Workspaces: `chatapp-desktop` (chat UI + Electron) and `chatapp-admin` (dashboard). Both are Vite + React; the chat client also ships as Electron (`desktop/electron/`).

### Chat client (`desktop/` — `chatapp-desktop`)

```
┌─────────────────────────────────────────────────────────┐
│ AuthProvider → restore session (refresh if needed)      │
│ PresenceProvider → realtime.connect(), session events   │
│ ChatPage → conversations, messages, in-app toasts     │
├─────────────────────────────────────────────────────────┤
│ api.ts          REST client, token refresh, sessions    │
│ storageUrl.ts   Presigned URL fetch + cache for media   │
│ realtime.ts     Socket.IO event handlers                │
│ SidebarSearchPanel / GlobalSearchModal                  │
│   → filter conversations + GET /messages/search         │
│   → jump to message (paginate history, scroll + glow)   │
│ InAppNotifications  mentions, new chat, new device      │
│ SessionsPanel   device list (Profile)                   │
└─────────────────────────────────────────────────────────┘
```

**Search flow:**

1. Sidebar or `Ctrl+K` / `Cmd+K` — debounced query (≥2 chars for message content)
2. Top: matching chats, groups, channels (name, members, last message preview)
3. Bottom: message hits from `GET /messages/search`
4. Click message → open conversation, load older pages if needed, scroll to `msg-{id}` with highlight

### Admin client (`admin/` — `chatapp-admin`)

Separate workspace: Vite + React (port 5174). Uses the same JWT auth; requires `users.is_admin = TRUE`. Dev: `npm run dev:admin` from repo root.

- **Dashboard**: user/message/conversation counts, recent activity, storage breakdown
- **Users**: list with role/status filters; detail with session count, message stats
- **Audit log**: filterable paginated trail with expandable metadata

**Service URL resolution** (`endpoints.ts`): on LAN hosts, API/WS target the same hostname on port 3000 instead of hardcoded `localhost`.

## 14. Admin & Audit Architecture

```
┌──────────────┐     JWT + is_admin     ┌─────────────────┐
│  admin/ app  │ ──────────────────────►│  AdminModule    │
│  (5174)      │     /admin/*           │  AdminGuard     │
└──────────────┘                        └────────┬────────┘
                                                 │
                    ┌────────────────────────────┼────────────────────────────┐
                    ▼                            ▼                            ▼
            ┌───────────────┐           ┌───────────────┐           ┌───────────────┐
            │ user stats    │           │ storage stats │           │ audit_logs    │
            │ sessions      │           │ DB + uploads  │           │ (append-only) │
            └───────────────┘           └───────────────┘           └───────────────┘
```

**AuditModule** (global): `AuditService.record()` called from auth, messages, conversations, contacts, and admin actions. Writes to `audit_logs` with action, resource, metadata JSON, IP, and user agent.

**Admin storage metrics** (`AdminStorageService`):

- PostgreSQL table sizes via `pg_total_relation_size`
- Legacy local upload folder sizes (`backend/uploads/` — pre-MinIO data only)
- Message counts by media kind (text, image, video, etc.)
- MinIO object counts/sizes (future enhancement)

## 15. Object Storage Architecture (MinIO / S3)

```
Client                    NestJS API                    Storage Layer
  │                            │                              │
  │── multipart upload ───────►│── StorageService             │
  │                            │   ├── validate MIME/size     │
  │                            │   ├── UUID object key        │
  │                            │   └── S3StorageProvider ────►│ MinIO / AWS S3
  │                            │                              │
  │                            │── StorageRepository ────────►│ PostgreSQL
  │                            │   (attachments metadata)   │ (metadata only)
  │◄── attachment metadata ────│                              │
  │                            │                              │
  │── GET /attachments/:id/download ────────────────────────►│
  │◄── presigned URL (2 min) ──│                              │
```

### Design principles

- **PostgreSQL stores metadata only** — `attachments` table (migration `021_attachments.sql`): `bucket`, `object_key`, `mime_type`, `checksum`, relations to `users`, `conversations`, `messages`.
- **Blobs in object storage** — never in the database. Object keys use `chat/YYYY/MM/DD/{uuid}.{ext}`.
- **Provider abstraction** — `IStorageProvider` + `S3StorageProvider` (AWS SDK v3). Switching MinIO → AWS S3 is env-only (`S3_ENDPOINT`, credentials, region).
- **Presigned URLs only** — clients never receive internal object paths. `GET /attachments/:id/download` returns a short-lived URL.
- **Permission checks** — conversation membership, ownership, avatar bucket read access for authenticated users.
- **Extension hooks** — `StorageHook` interface for future virus scan, compression, thumbnails (not implemented).

### Buckets

| Env var | Default bucket | Content |
|---------|----------------|---------|
| `S3_BUCKET_AVATARS` | `avatars` | User + conversation avatars |
| `S3_BUCKET_ATTACHMENTS` | `attachments` | Message images |
| `S3_BUCKET_VIDEOS` | `videos` | Message videos |
| `S3_BUCKET_VOICE` | `voice` | Audio messages |
| `S3_BUCKET_DOCUMENTS` | `documents` | PDF, Office, zip |
| `S3_BUCKET_BACKUPS` | `backups` | Reserved |

Buckets are auto-created by `S3StorageProvider` on startup (with retries in development). Docker Compose also runs `minio-init` via `mc`.

### Upload entry points

| Route | Used by |
|-------|---------|
| `POST /attachments/upload` | Direct upload API |
| `POST /conversations/:id/messages/attachment` | Chat message attachments |
| `POST /users/me/avatar` | Profile avatar |
| `POST /conversations/:id/avatar` | Channel/group avatar |

All delegate to `StorageService.upload()`.

### Client download flow

1. Message `content` references `/api/v1/attachments/{id}/download` (not a direct file URL).
2. Desktop client (`storageUrl.ts`) fetches presigned URL with JWT, caches until near expiry.
3. `<img>`, `<video>`, `<audio>` use the presigned URL.

### Legacy local disk

`backend/uploads/` and `GET /uploads/*` remain for **pre-migration** files. New uploads use MinIO. Message forward of legacy attachments still copies from local disk when no `attachments` row exists.

## 16. Observability

| Component | Implementation |
|-----------|----------------|
| HTTP logging | `pino-http` with request IDs |
| Errors | Sentry (`SENTRY_DSN`); global filter reports + returns JSON errors |
| Metrics | Prometheus gauges/counters (e.g. WS connections, message sends) |
| Health | `GET /api/v1/health` |

## 17. Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | required |
| `REDIS_URL` | Redis connection string | required |
| `JWT_ACCESS_SECRET` | Access token signing key | required |
| `JWT_REFRESH_SECRET` | Refresh token signing key | required |
| `JWT_ACCESS_EXPIRES_IN` | Access token TTL | `15m` |
| `JWT_REFRESH_EXPIRES_IN` | Refresh token TTL | `7d` |
| `CORS_ORIGIN` | Allowed origins (comma-separated) | `*` |
| `LOG_LEVEL` | Pino log level | `info` |
| `SENTRY_DSN` | Sentry project DSN | optional |
| `SENTRY_RELEASE` | Release tag for Sentry | optional |
| `RATE_LIMIT_TTL` / `RATE_LIMIT_MAX` | Global rate limit | `60` / `100` |
| `PORT` | API listen port | `3000` |
| `S3_ENDPOINT` | MinIO/S3 host | `127.0.0.1` |
| `S3_PORT` | MinIO/S3 port | `9000` |
| `S3_SSL` | Use HTTPS for S3 endpoint | `false` |
| `S3_ACCESS_KEY` / `S3_SECRET_KEY` | Object storage credentials | `minioadmin` (dev) |
| `S3_REGION` | AWS region (required for SDK) | `us-east-1` |
| `S3_BUCKET_*` | Bucket names per media type | see §15 |
| `S3_PRESIGNED_URL_EXPIRES_SECONDS` | Download URL TTL | `120` |
| `STORAGE_MAX_*_MB` | Per-category upload size limits | see `backend/.env.example` |

**Production:** `S3_ENDPOINT`, credentials, region, and bucket env vars are required (Zod validation in `backend/src/config/env.ts`).

**Per-workspace env files** (created by `npm run setup` from `*.env.example`):

| File | Workspace | Notes |
|------|-----------|-------|
| `.env` | root / Compose | Postgres, Redis, shared Compose vars |
| `backend/.env` | `chatapp-backend` | `DATABASE_URL`, JWT secrets, `PORT`, etc. |
| `desktop/.env` | `chatapp-desktop` | optional `VITE_API_URL`, `VITE_WS_URL` |
| `admin/.env` | `chatapp-admin` | optional `VITE_API_URL` |

**Desktop / Admin (Vite):** `VITE_API_URL`, `VITE_WS_URL` override defaults when not using LAN auto-detection.

## 18. SSE Fallback (WebSocket-blocked environments)

When WebSocket is unavailable (corporate proxies, strict firewalls), clients can fall back to **Server-Sent Events** for server → client delivery and **REST** under `/api/v1/realtime/*` for client → server actions.

### Architecture

```
┌──────────────┐   WS (preferred)    ┌─────────────────────┐
│ Desktop /    │ ───────────────────►│ RealtimeGateway     │
│ Browser      │                     │ (Socket.IO)         │
└──────┬───────┘                     └──────────┬──────────┘
       │                                          │
       │ SSE GET /realtime/stream                 │ emit + publish
       │ REST POST /realtime/*                    ▼
       └────────────────────────────────►┌─────────────────────┐
                                         │ RealtimeBroadcast   │
                                         │ + Redis event bus   │
                                         └──────────┬──────────┘
                                                    │
                              rt:user:* / rt:session:* / rt:conversation:*
                                                    ▼
                                         ┌─────────────────────┐
                                         │ RealtimeSseService  │
                                         │ (text/event-stream) │
                                         └─────────────────────┘
```

- **Event bus** (`RealtimeEventBusService`): Redis pub/sub channels (`rt:user:{id}`, `rt:session:{id}`, `rt:conversation:{id}`, `rt:global`). Falls back to in-process delivery when Redis publish fails.
- **Broadcast layer** (`RealtimeBroadcastService`): every server → client event is emitted to Socket.IO rooms **and** published to the bus so SSE subscribers (including on other API instances) receive the same payloads.
- **Shared actions** (`RealtimeActionsService`): message send, read receipts, typing, etc. Used by both the WebSocket gateway and REST fallback controller.

### SSE stream

```http
GET /api/v1/realtime/stream?access_token=<JWT>
Accept: text/event-stream
```

- Auth: `Authorization: Bearer` **or** `access_token` query param (required for native `EventSource`, which cannot set headers).
- On connect: joins user/session channels, subscribes to all conversation memberships, registers presence, sends `presence:sync`.
- Events use named SSE types matching WebSocket event names, e.g. `event: message:receive`.
- Keepalive comments every 25s.

### REST fallback endpoints (`/api/v1/realtime/*`)

| Method | Endpoint | Replaces WS event |
|--------|----------|-------------------|
| POST | `/realtime/messages/send` | `message:send` |
| POST | `/realtime/messages/delivered` | `message:delivered` |
| POST | `/realtime/messages/read` | `message:read` |
| POST | `/realtime/messages/edit` | `message:edit` |
| POST | `/realtime/messages/delete` | `message:delete` |
| POST | `/realtime/messages/reaction` | `message:reaction` |
| DELETE | `/realtime/conversations/:id` | `conversation:delete` |
| POST | `/realtime/conversations/:id/join` | `conversation:join` (SSE subscription) |
| POST | `/realtime/conversations/:id/leave` | `conversation:leave` |
| POST | `/realtime/typing` | `user:typing` |
| POST | `/realtime/presence/heartbeat` | `presence:heartbeat` |
| POST | `/realtime/presence/query` | `presence:query` |

### Desktop client behavior

`desktop/src/services/realtime.ts` tries **WebSocket first** (~8s timeout). On failure it connects via **EventSource** to `/realtime/stream` and routes outbound operations to the REST endpoints above (`api.sendRealtimeMessage`, etc.).

SSE mode is automatic; no user configuration required.
