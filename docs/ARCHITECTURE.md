# ChatApp System Architecture

## 1. High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           CLIENT TIER                                       │
│  ┌──────────────────────┐    ┌──────────────────────┐    ┌────────────────┐ │
│  │  Electron Desktop    │    │  Browser (Vite dev)  │    │  Admin Web     │ │
│  │  Windows / Linux     │    │  LAN or localhost    │    │  (port 5174)   │ │
│  │  ┌────────────────┐  │    │  ┌────────────────┐  │    │  Dashboard,    │ │
│  │  │ React Renderer │  │    │  │ React (same)   │  │    │  users, auth,  │ │
│  │  │ REST + WS      │  │    │  │ localStorage   │  │    │  audit         │ │
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
│  Auth, Directory │ │  Contacts, Conv, │ │  Messages,       │
│  Users, Realtime │ │  Presence,       │ │  Realtime GW     │
│  GW              │ │  Realtime GW     │ │                  │
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
│  sessions,      │  │                 │  │                 │
│  directory_*    │  │                 │  │                 │
└─────────────────┘  └─────────────────┘  └─────────────────┘
                              │
                              │  optional LDAP / LDAPS
                              ▼
                    ┌─────────────────────┐
                    │ Windows Active      │
                    │ Directory           │
                    └─────────────────────┘
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
| `auth` | Registration, login, JWT + refresh rotation, **device sessions**, **provider-based auth** (local + AD) | Auth Service |
| `directory` | AD/LDAP config (hot reload), bind encryption, group mapping, sync scheduler, auth audit | Directory / IdP Service |
| `users` | Profiles, search, avatars, directory profile fields | User Service |
| `contacts` | Contact list | Contacts Service |
| `conversations` | DMs, channels, groups, invites, membership ACL | Conversation Service |
| `messages` | Persistence, ordering, sanitization, mentions, attachments, reactions, **Slack-style threads**, **group polls**, **content search** | Messaging Service |
| `calls` | 1:1 DM voice/video signaling (in-memory registry), call history, unseen missed badge, ICE config | Calls / Signaling Service |
| `tasks` | Task CRUD, assignment acceptance (`pending_assignee_id`), per-user read state, realtime fanout | Tasks Service |
| `notes` | Personal/shared notes, member roles (`owner` / `contributor` / `reader`), revision history, optimistic concurrency, realtime fanout | Notes Service |
| `stories` | Ephemeral stories (24h), contact audience, views, likes, reply→DM, realtime fanout | Stories Service |
| `storage` | S3-compatible object storage (upload, delete, stream content, presigned URLs, `attachments` metadata) | Storage Service |
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

Telegram-style **device sessions** tie refresh tokens and access tokens to a logical device. Authentication is **provider-based**: local email/password and optional Windows Active Directory (LDAP) share the same token issuance path.

### Provider pattern

```
                    ┌──────────────────────────┐
                    │  AuthenticationManager   │
                    │  (strategy selection)    │
                    └────────────┬─────────────┘
               ┌─────────────────┴─────────────────┐
               ▼                                   ▼
    ┌────────────────────┐              ┌────────────────────────┐
    │ LocalAuthProvider  │              │ ActiveDirectoryProvider│
    │ email + bcrypt     │              │ LDAP bind + search     │
    │ PostgreSQL users   │              │ provision / sync user  │
    └─────────┬──────────┘              └───────────┬────────────┘
              └─────────────────┬───────────────────┘
                                ▼
                     AuthService.issueTokens
                     (user_sessions + JWT + refresh)
```

- Interface: `IAuthenticationProvider` (`backend/src/modules/auth/providers/`)
- Runtime config: `directory_configurations` (cached ~5s; admin PUT invalidates cache — **no restart**)
- Adding Azure AD / OAuth / OIDC later: implement the interface and register in `AUTH_PROVIDERS`
- AD passwords are never stored; `users.password_hash` is nullable for directory users
- Bind password encrypted at rest (`SecretEncryptionService`, AES-256-GCM; key from `DIRECTORY_ENCRYPTION_KEY`)

### Device sessions

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
2. **Provider login** (`POST /auth/login`): optional `provider`; `email` (local) or `username` (AD). `GET /auth/providers` drives the login UI.
3. **AD success path**: LDAP authenticate → policy/group checks → auto-create or sync local user → same token issuance as local.
4. **Refresh** rotates the opaque refresh token but keeps the same `sessionId`.
5. **Access token** carries required `sid`; every REST request and WebSocket message validates the session is not revoked (Redis cache first, PostgreSQL on miss).
6. **Terminate session** revokes DB row + refresh tokens, invalidates Redis session cache, emits `session:terminated`, and disconnects sockets.
7. **New login** on another device emits `session:created` to other sessions (excluding the new one).
8. **Session cache** (`SessionCacheService`): `session:valid:{sid}` (TTL = access token lifetime), `session:revoked:{sid}` (short negative cache); `last_active_at` DB writes debounced to ~60s per session.

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
| Object storage (MinIO/S3) | Horizontal | Shared across API instances; clients download via API proxy |

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

### Register / Login (local)

```http
POST /api/v1/auth/login
Content-Type: application/json

{
  "provider": "local",
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

### Login (Active Directory)

```http
POST /api/v1/auth/login
Content-Type: application/json

{
  "provider": "active_directory",
  "username": "alice",
  "password": "...",
  "clientInfo": { "clientType": "electron", "deviceLabel": "ChatApp, Windows" }
}
```

```http
GET /api/v1/auth/providers
```

Returns enabled providers and `defaultProvider` for the login UI (no auth required).

```json
{
  "user": { "id": "...", "email": "...", "username": "alice", "displayName": "Alice Smith" },
  "accessToken": "eyJhbG...",
  "refreshToken": "a1b2c3...",
  "expiresIn": 900,
  "sessionId": "550e8400-e29b-41d4-a716-446655440099"
}
```

Response shape is identical for local and AD — clients do not need a separate token path.
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

- Returns **channel/timeline roots only** (`thread_root_id IS NULL`); thread replies are loaded via the thread endpoints
- Root payloads include `replyCount`, `latestReplyAt`, and `unreadReplyCount` (per-user)

### Slack-style Threads

Thread replies hang under a root message and stay out of the main feed.

| Column / table | Purpose |
|----------------|---------|
| `messages.thread_root_id` | Reply → absolute thread root (`NULL` for timeline messages) |
| `messages.reply_count` / `latest_reply_at` | Denormalized meta on the root |
| `message_thread_reads` | Per-user last-read cursor for a thread (migration `027`) |

```http
GET /api/v1/conversations/{id}/messages/{rootId}/thread
GET /api/v1/conversations/{id}/messages/{rootId}/thread/search?q=hello
GET /api/v1/conversations/{id}/messages/unread-threads
```

- **Open thread**: returns `{ root, replies, firstUnreadMessageId }`, then marks the thread read for the viewer
- **Send**: `message:send` / attachment upload may include `threadRootId` (and optional `replyToMessageId` for quote-in-thread)
- **Realtime**: thread replies broadcast as `message:receive` with `threadRootId` + `thread: { replyCount, latestReplyAt }`; clients update the root chip and keep replies out of the main list
- **Unread threads bar**: `unread-threads` lists threads with ≥1 unread reply (count = number of threads, not reply volume)

### Group Polls

Telegram-style polls in **group** conversations only (not DMs/channels). Migration `028_polls`.

| Table | Purpose |
|-------|---------|
| `polls` | One poll per message (`question`, `anonymous`, `allows_multiple`, `closed_at` / `closed_by`) |
| `poll_options` | Option text + position (2–10) |
| `poll_votes` | Unique `(poll_id, user_id, option_id)` |

Message `content_type` = `application/vnd.chatapp.poll+json`; `content` = question (list preview / search).

```http
POST /api/v1/conversations/{id}/polls
POST /api/v1/conversations/{id}/polls/{pollId}/vote
POST /api/v1/conversations/{id}/polls/{pollId}/close
```

- **Create**: any group member who can send; body `{ question, options, anonymous?, allowsMultiple?, clientMessageId? }` → `message:receive` with `poll` payload
- **Vote**: tap-to-vote (`optionId`); single choice switches vote; multiple choice toggles; results visible after the viewer has voted or the poll is closed
- **Close**: **message sender only**; further votes rejected
- **Realtime**: vote/close broadcast viewer-specific `message:updated` (correct `votedByMe` / `canClose` per member)
- Anonymous polls never expose voter identities to clients (aggregates only)

### Tasks (assignment acceptance)

Personal/shared tasks with optional conversation and message links. Migrations `029_tasks`, `030_task_assignment_acceptance`.

| Column / table | Purpose |
|----------------|---------|
| `tasks` | `title`, `description`, `conversation_id`, `source_message_id`, `created_by`, `assigned_to`, `pending_assignee_id`, `assignment_version`, `assignment_offered_at`, `assignment_responded_at`, `due_at`, `completed_at` |
| `task_user_reads` | Per-user read cursor for pending invites (`last_read_at` vs `assignment_offered_at`) |

**Assignment states** (derived, not stored):

| Status | Condition |
|--------|-----------|
| `unassigned` | No `assigned_to` and no `pending_assignee_id` |
| `pending` | `pending_assignee_id` set (awaiting accept/reject) |
| `assigned` | `assigned_to` set, no pending offer |

```http
POST /api/v1/tasks
POST /api/v1/tasks/from-message
POST /api/v1/tasks/:id/assign
POST /api/v1/tasks/:id/accept
POST /api/v1/tasks/:id/reject
GET  /api/v1/tasks/pending/unseen-count
POST /api/v1/tasks/pending/seen
```

- **Create with external assignee**: sets `pending_assignee_id`; recipient sees task in **Pending** only until accept
- **Self-assign**: `assigned_to = creator` immediately
- **Reassign**: creator offers to new user; current `assigned_to` kept until accept; `assignment_version` bumps for race-safe accept/reject
- **Access**: creator, accepted assignee, or pending recipient
- **Realtime**: `TaskRealtimePublisher` → `emitToUsers` on `task:updated` / `task:deleted` (WebSocket + SSE via Redis `rt:user:*`)

### Notes (personal & shared)

Personal and shared notes with member roles and revision history. Migration `031_notes`.

| Column / table | Purpose |
|----------------|---------|
| `notes` | `title`, `body`, `created_by`, `version` (optimistic concurrency), timestamps |
| `note_members` | `(note_id, user_id)` PK; `role` enum `owner` \| `contributor` \| `reader`; `invited_by` |
| `note_revisions` | Snapshot per version: `title`, `body`, `changed_fields[]`, `edited_by`, `version` |

```http
GET    /api/v1/notes?scope=all|mine|shared
POST   /api/v1/notes
PATCH  /api/v1/notes/:id
DELETE /api/v1/notes/:id
GET    /api/v1/notes/:id/history
DELETE /api/v1/notes/:id/history
POST   /api/v1/notes/:id/members
```

- **Create**: owner member row + initial revision (v1)
- **Edit**: owner or contributor; optional `version` in body → `409 Conflict` on stale write
- **Share**: owner adds members as `reader` or `contributor`; owner can change roles or remove access
- **History**: every save appends `note_revisions`; members can view; owner can clear all revisions
- **Access**: must be in `note_members`; list scoped by `scope` (`mine` = created by user, `shared` = shared with user)
- **Realtime**: `NoteRealtimePublisher` → `note:updated` / `note:deleted` to all member user ids (WebSocket + SSE)

### Stories (ephemeral, contact audience)

Instagram/Telegram-style photo/video stories with 24h expiry. Visible to the author’s **contacts** (+ self). Migrations `032_stories`, `033_story_likes`.

| Column / table | Purpose |
|----------------|---------|
| `stories` | `author_id`, `attachment_id`, optional `caption`, `created_at`, `expires_at` |
| `story_views` | `(story_id, viewer_id)` PK; `viewed_at` |
| `story_likes` | `(story_id, user_id)` PK; `liked_at` |
| `messages.story_id` | Optional FK for DM replies that quote a story |

```http
GET    /api/v1/stories/feed
GET    /api/v1/stories/user/:userId
POST   /api/v1/stories                    # multipart media + caption
POST   /api/v1/stories/:id/view
GET    /api/v1/stories/:id/viewers        # owner only
POST   /api/v1/stories/:id/like
DELETE /api/v1/stories/:id/like
POST   /api/v1/stories/:id/reply          # → DM + story-quoted message
DELETE /api/v1/stories/:id
```

- **Audience**: author’s contacts (via `user_contacts`) and the author; expired stories are hidden from viewers
- **Create**: image/video upload through `StorageService`; attachment ACL allows story audience to stream content
- **View**: idempotent upsert; owner does not create a view row for self
- **Like**: non-owner only; liking also ensures a view row so likers appear in the viewers list
- **Viewers** (owner): list of viewers with `liked` / `likedAt` (likers sorted first); includes `viewCount` / `likeCount` on owner’s story payloads
- **Reply**: creates/opens a DM with the author and sends a message with `story_id` (quoted story card in the bubble)
- **Realtime**: `StoryRealtimePublisher` → `story:created` / `story:deleted` to author + contact user ids (WebSocket + SSE)
- **Throttle**: `POST /stories/:id/view` allows a higher per-route limit (idempotent browsing)

### List Conversation Attachments (file management)

```http
GET /api/v1/conversations/{id}/attachments?kind=image&cursor=2026-07-12T10:00:00.000Z&limit=50
Authorization: Bearer eyJhbG...
```

- Scoped to conversation members; excludes deleted and user-hidden messages
- **Filters** (`kind`): `all` (default), `mine`, `shared`, `image`, `video`, `document`, `audio`, `voice`
- **Pagination**: cursor = ISO `createdAt` of last item; `nextCursor` in response
- Returns metadata + uploader display name; clients fetch bytes via `GET /attachments/:id/content`

```json
{
  "items": [
    {
      "id": "...",
      "originalName": "report.pdf",
      "mimeType": "application/pdf",
      "size": "1048576",
      "url": "/api/v1/attachments/.../content",
      "uploadedBy": "...",
      "messageId": "...",
      "caption": "Q2 numbers",
      "createdAt": "2026-07-12T10:30:00.000Z",
      "uploader": { "id": "...", "displayName": "Alice", "username": "alice" }
    }
  ],
  "nextCursor": null
}
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
  "replyToMessageId": "optional-msg-uuid",
  "threadRootId": "optional-root-uuid"
}
```

### `message:receive` (Server → Client)

Includes `mentions`, `reactions`, `replyTo`, attachment fields when applicable. Thread replies also include `threadRootId` and `thread: { replyCount, latestReplyAt }` so clients can sync the root reply chip without putting the reply in the main feed. Poll messages include `poll: { id, question, anonymous, allowsMultiple, closed, resultsVisible, options[{ id, text, voteCount, votedByMe }], totalVoters, myOptionIds, canClose }`.

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

### Voice / video call signaling (1:1 DMs, WebSocket only)

**Client → Server** (with ack callbacks):

| Event | Payload | Description |
|-------|---------|-------------|
| `call:invite` | `{ conversationId, mediaType? }` | Start outbound call (`mediaType`: `audio` default, or `video`); server returns `callId` |
| `call:accept` | `{ callId }` | Callee accepts |
| `call:reject` | `{ callId }` | Callee declines |
| `call:end` | `{ callId }` | Hang up active or cancel ringing call |
| `call:signal` | `{ callId, type, payload }` | WebRTC `offer` / `answer` / `ice` |

**Server → Client:**

| Event | Description |
|-------|-------------|
| `call:incoming` | Ringing notification to callee (`caller` profile, `mediaType`) |
| `call:accepted` | Caller notified that callee joined |
| `call:ended` | Call finished (`reason`: ended, rejected, cancelled, busy, timeout, unavailable) |
| `call:signal` | Forwarded SDP/ICE from peer |

**REST:**

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/calls/ice-servers` | STUN/TURN list from env (`WEBRTC_STUN_URLS`, optional `TURN_*`) |
| GET | `/api/v1/calls/history` | Paginated call history (`filter`, `cursor`, `limit`) |
| GET | `/api/v1/calls/missed/unseen-count` | Unseen missed-call count for nav badge |
| POST | `/api/v1/calls/missed/seen` | Mark missed calls seen (`call_records.callee_seen_at`) |

**Persistence:** each completed call is written to `call_records` (migrations `022`–`025`) with `media_type`, `end_reason`, timestamps, and optional duration. Category helpers map per viewer: unanswered timeout → **Missed** for callee, **Cancelled** for caller; `callee_seen_at` tracks the unseen badge.

**Constraints:** DM conversations only; one active call per user; **15s** ring timeout; in-memory call registry (single-instance friendly; Redis-backed registry would be needed for multi-instance call state). **Not available over SSE fallback** — clients must use WebSocket.

### Task events (WebSocket + SSE)

| Event | Direction | Payload |
|-------|-----------|---------|
| `task:updated` | Server → Client | Full `TaskItem` (create, edit, assign, accept, reject, complete, reassign) |
| `task:deleted` | Server → Client | `{ taskId }` |

Recipients: creator, accepted assignee, pending assignee, and prior assignee when access is removed. Delivered to `user:{userId}` rooms and SSE `rt:user:{userId}` channels.

### Note events (WebSocket + SSE)

| Event | Direction | Payload |
|-------|-----------|---------|
| `note:updated` | Server → Client | Full `NoteItem` (create, edit, share, permission change, clear history) |
| `note:deleted` | Server → Client | `{ noteId }` |

Recipients: all `note_members` user ids. Delivered to `user:{userId}` rooms and SSE `rt:user:{userId}` channels.

### Story events (WebSocket + SSE)

| Event | Direction | Payload |
|-------|-----------|---------|
| `story:created` | Server → Client | `{ story: StoryItem, author: PublicUser }` |
| `story:deleted` | Server → Client | `{ storyId, authorId }` |

Recipients: story author + that author’s contact user ids. Delivered to `user:{userId}` rooms and SSE `rt:user:{userId}` channels.

## 11. Database Schema Summary

```
users ─────────────┬──── conversation_members ──── conversations
                   │                                    │
                   ├──── messages ──────────────────────┘
                   │    ├── thread_root_id → messages (Slack threads)
                   │    ├── story_id → stories (DM story replies)
                   │    ├── polls → poll_options → poll_votes (group polls)
                   │    ├── attachments (metadata → MinIO blobs)
                   │    ├── message_mentions
                   │    ├── message_reactions
                   │    ├── message_deliveries
                   │    ├── message_read_receipts
                   │    └── message_thread_reads (per-user thread cursor)
                   │
                   ├──── user_contacts
                   ├──── stories ── story_views / story_likes (24h ephemeral)
                   │              └── attachment_id → attachments
                   ├──── tasks ── task_user_reads (pending invite read state)
                   ├──── notes ── note_members (owner / contributor / reader)
                   │              └── note_revisions (per-version history)
                   ├──── refresh_tokens (session_family_id)
                   ├──── user_sessions
                   ├──── call_records (1:1 DM call history)
                   ├──── directory_configurations (singleton auth/LDAP settings)
                   ├──── directory_group_mappings (AD group → chat role)
                   ├──── directory_sync_history
                   └──── authentication_audit_logs (provider login events)

direct_conversation_pairs ── conversations (DM uniqueness)
channel_invites ── conversations
audit_logs ── users (user_id, actor_user_id)
```

**User directory fields** (migration `034_directory_auth`): `authentication_provider`, `ad_guid`, `ad_sid`, `department`, `job_title`, `company`, `phone`, `manager`, `last_directory_sync`, `directory_enabled`, `directory_groups`; `password_hash` nullable for AD-only users.
**Schema delivery:**

- `infra/postgres/init.sql` — full schema for new databases; seeds `schema_migrations` with checksums
- `infra/postgres/migrations/*.sql` — incremental changes; applied by `backend/scripts/migrate.mjs` (`npm run migrate` from repo root)
- `npm run check:schema-drift` — CI guard that `init.sql` matches all migration files (root script → `chatapp-backend`)
- `backend/scripts/repair-migration-checksums.mjs` — dev-only repair when migration SQL on disk matches what was applied but checksums in `schema_migrations` are stale (e.g. after line-ending normalization)

Key indexes:

- `messages(conversation_id, sequence DESC)` — feed pagination
- `messages(conversation_id, sequence DESC) WHERE thread_root_id IS NULL` — main timeline (channel roots)
- `messages(thread_root_id, sequence ASC) WHERE thread_root_id IS NOT NULL` — thread reply order
- `messages(search_vector)` GIN — full-text message search
- `messages(conversation_id, sender_id, client_message_id)` — idempotent sends
- `message_thread_reads(user_id, last_read_at DESC)` — unread thread queries
- `attachments(conversation_id, created_at DESC)` — per-chat file listing
- `call_records(caller_id, ended_at DESC)`, `call_records(callee_id, ended_at DESC)` — call history
- `call_records` partial index on unseen missed (`answered_at IS NULL AND callee_seen_at IS NULL`)
- `tasks(pending_assignee_id, assignment_offered_at DESC)` partial — pending offers
- `task_user_reads(user_id, last_read_at DESC)` — unread pending count
- `notes(created_by, updated_at DESC)` — note list for owner
- `note_members(user_id, joined_at DESC)` — notes shared with user
- `note_revisions(note_id, version DESC)` — revision history
- `stories(author_id, expires_at DESC)`, `stories(expires_at)` — feed / expiry
- `story_views(viewer_id, viewed_at DESC)` — viewer history
- `story_likes(user_id, liked_at DESC)` — like history
- `audit_logs(created_at DESC)`, `audit_logs(action)` — admin audit queries
- `user_sessions(user_id)` partial where not revoked
- `refresh_tokens(user_id, session_family_id)` — session token lookup

## 12. Security Architecture

### JWT Auth Flow

```
1. Login (local or AD) → accessToken (15m, includes sid) + refreshToken (opaque, 7d)
2. refreshToken stored as SHA-256 hash; session metadata in user_sessions
3. REST: Authorization: Bearer; WS: auth.token on handshake
4. On 401 → POST /auth/refresh (rotates refresh token, same sessionId)
5. Logout / terminate → revoke session + refresh tokens; push session:terminated
6. validateAccessToken checks user active + session not revoked (Redis session cache → DB fallback)
```

### Content Security Policy (CSP)

| Surface | How CSP is applied |
|---------|-------------------|
| NestJS API | Helmet (`backend/src/config/csp.ts`) — deny-by-default for any HTML from the API |
| Desktop / browser SPA | Vite injects `<meta http-equiv="Content-Security-Policy">` on **production** builds (`desktop/csp.ts`) |
| Admin SPA | Same pattern (`admin/csp.ts`) |
| Electron packaged | `session.webRequest.onHeadersReceived` sets CSP header (skipped in Vite HMR dev) |
| nginx (prod compose) | CSP + `X-Frame-Options DENY`, `nosniff`, `Referrer-Policy` |

SPA policy allows `'self'` scripts, React inline styles, `blob:` media, Google Fonts (desktop), and `http(s)` / `ws(s)` connect for LAN API hosts. Dev servers omit CSP so Vite HMR works.

### CSRF

**Not required** under the current design:

| Token | Transport | Auto-sent by browser on cross-site request? |
|-------|-----------|-----------------------------------------------|
| Access JWT | `Authorization: Bearer` header | No |
| Refresh token | JSON body on `POST /auth/refresh` | No |
| Session id | Inside JWT `sid` claim | N/A |

Storage: Electron encrypted file / renderer memory; browser `localStorage` (admin + web client). No auth cookies (`Set-Cookie` / `HttpOnly` refresh) are used.

CORS still restricts which origins may call the API with credentials-style requests. If refresh tokens are later moved to cookies, introduce CSRF defense (synchronizer or double-submit token) before enabling that path.

### Active Directory / LDAP

- Service bind with encrypted bind password; user bind verifies credentials (password never persisted)
- Prefer LDAPS or StartTLS; optional certificate validation
- Provisioning: auto-create local user; sync display name, email, department, title, company, phone, groups, status
- Group mappings: allow/deny login, approved security groups, `system_admin` → `users.is_admin`
- Scheduled sync: manual / hourly / daily / weekly (`@nestjs/schedule`)
- Admin APIs under `/admin/settings/authentication/*` (hot-reload config)

### Secure WebSocket Handshake

- JWT verified in `handleConnection` (`handshake.auth.token` or `Authorization`); `AuthService.validateAccessToken` enforces active user + non-revoked session
- Join `user:{id}` and `session:{sid}` rooms
- `WsJwtGuard` on every subscribed handler re-validates the session (disconnects if revoked)
- Membership / call-participant checks on sensitive actions (`conversation:join`, send/typing, call signaling, etc.)
- `presence:query` limited to users who share a conversation with the requester
- On member removal / conversation leave-delete: sockets leave `conversation:{id}` so they stop receiving room broadcasts
- Session revoke: emit `session:terminated` then `disconnectSockets(true)` on `session:{sid}`

### Rate Limiting

| Endpoint | Limit |
|----------|-------|
| Global | 100 req/min per IP |
| `/auth/register` | 5 req/min |
| `/auth/login` | 10 req/min |
| `/admin/settings/authentication/test-connection` | 10 req/min |
| `/admin/settings/authentication/sync` | 5 req/min |
| `POST /stories/:id/view` | 120 req/min (idempotent browsing) |
| WS `message:send` | Token bucket (default capacity 15, refill 0.5/s; env-overridable) |
| WS `user:typing` | Token bucket (default 6 / 1.5/s per conversation) |
| WS other mutating events | Per-action token buckets (`WsRateLimitGuard`; Redis + in-memory fallback) |
| WS `call:invite` / `call:signal` | Strict invite (3 / 0.1/s); generous signal (120 / 30/s per call) |

### Message Sanitization

Message content passes through `sanitize-html` (escape mode) to prevent stored XSS. Mentions parsed server-side and stored in `message_mentions`.

## 13. Client Architecture (Desktop / Browser / Admin)

Workspaces: `chatapp-desktop` (chat UI + Electron) and `chatapp-admin` (dashboard). Both are Vite + React; the chat client also ships as Electron (`desktop/electron/`).

### Chat client (`desktop/` — `chatapp-desktop`)

```
┌─────────────────────────────────────────────────────────┐
│ AuthProvider → restore session (refresh if needed)      │
│ PresenceProvider → realtime.connect(), session events   │
│ ChatPage → conversations, messages, threads, polls, stories tray, in-app toasts │
├─────────────────────────────────────────────────────────┤
│ api.ts          REST client, token refresh, sessions    │
│ storageUrl.ts   API content proxy fetch + blob URL resolution │
│ mediaCache.ts   IndexedDB LRU cache for offline media         │
│ realtime.ts     Socket.IO event handlers (+ call signaling)     │
│ voiceCall.ts    WebRTC RTCPeerConnection, audio/video tracks, ICE │
│ mediaDevices.ts Mic/camera access; HTTPS/LAN error messages       │
│ messageScroll.ts First-unread / bottom scroll in chat panes       │
│ StoriesTray / StoryComposerModal / StoryViewerModal  ephemeral stories │
│ MessageStoryQuote  story quote card in DM reply bubbles           │
│ ThreadPanel     Slack thread (replies, in-thread search/files)    │
│ CreatePollModal / MessagePoll  group polls (tap-to-vote, close) │
│ FileManagementPanel  per-chat files (filter tabs, preview)    │
│ CallsPanel      call history filters + callback                │
│ TasksPanel      tasks (open/pending/completed, accept/reject)  │
│ CreateTaskModal / AssigneePicker  task create + assign         │
│ NotesPanel      notes (list, editor, share, history diff)      │
│ VoiceCallModal  voice/video UI (mute, speaker, camera, end)    │
│ ConversationInfoPanel  details + link to shared files           │
│ SidebarSearchPanel / GlobalSearchModal                  │
│   → filter conversations + GET /messages/search         │
│   → jump to message (paginate history, scroll + glow)   │
│ InAppNotifications  mentions, new chat, new device      │
│ SessionsPanel   device list (Profile)                   │
│ CacheManagementPanel  offline cache stats + clear       │
└─────────────────────────────────────────────────────────┘
```

**Thread flow:**

1. Menu **Reply in thread** (or reply-count chip) opens `ThreadPanel` for the root message
2. Thread replies send with `threadRootId`; main timeline stays roots-only and updates `replyCount` / unread badge from realtime `thread` meta
3. Panel tabs: Replies (with reactions), Search (`…/thread/search`), Files (attachments in the thread)
4. Opening a thread marks it read (`message_thread_reads`); `firstUnreadMessageId` scrolls to the first unread reply (else bottom)
5. Chat header bar lists **N unread threads**; click cycles to each unread root in the timeline

**Poll flow (groups only):**

1. Composer poll button opens `CreatePollModal` (question, 2–10 options, Anonymous, Multiple choice)
2. Server inserts message + poll tables; clients render `MessagePoll` in the bubble
3. Tap an option to vote immediately; tallies arrive via `message:updated`
4. Sender sees **Close Poll**; after close (or after the viewer has voted), percentages show

**Open-chat scroll:**

1. On open, if the conversation has unread messages, load older pages until the true first unread is included (`messageScroll.ts`)
2. Scroll the messages pane so the unread divider sits at the top; if nothing is unread, pin to the bottom

**Search flow:**

1. Sidebar or `Ctrl+K` / `Cmd+K` — debounced query (≥2 chars for message content)
2. Top: matching chats, groups, channels (name, members, last message preview)
3. Bottom: message hits from `GET /messages/search`
4. Click message → open conversation, load older pages if needed, scroll to `msg-{id}` with highlight

**File management flow:**

1. Open from chat header (📁) or conversation info → **Open shared files**
2. Filter tabs: All files, My uploads, Shared, Images, Videos, Documents, Audio, Voice
3. `GET /conversations/:id/attachments` with `kind` + cursor pagination
4. Thumbnails for images/videos; preview modals; **Jump** scrolls to source message; **Save** downloads via cached blob URL

**Voice / video call flow (DM only):**

1. Caller taps 📞 (audio) or 📹 (video) in DM header → `call:invite` (`mediaType`) → server validates DM membership, busy state, emits `call:incoming` to callee
2. Client fetches `GET /calls/ice-servers`, acquires mic (and camera for video) via `getUserMedia` (`mediaDevices.ts`)
3. WebRTC offer/answer + trickle ICE exchanged through `call:signal` (server forwards to peer, excluding sender session)
4. Callee accepts via `VoiceCallModal` → `call:accept` → media flows peer-to-peer (STUN; TURN optional for hard NAT)
5. Active UI: mobile full-screen phone layout; desktop video overlays compact corner controls on the stream (local preview mirrored)
6. Hang up / reject / **15s unanswered timeout** → `call:end` or server timeout → persist `call_records` → `call:ended` → cleanup tracks and `RTCPeerConnection`
7. Calls tab (`CallsPanel`) loads `GET /calls/history`; opening Calls marks missed as seen (`POST /calls/missed/seen`) and clears the nav badge (`GET /calls/missed/unseen-count`)

**Task flow:**

1. Create manually (`CreateTaskModal`) or **Convert to Task** from message context menu (`POST /tasks/from-message`)
2. External assignee → pending invitation (`pending_assignee_id`); recipient sees **Pending** tab with count; must **Accept** to join Open list
3. Creator can reassign, cancel pending invite, or delete; accepted assignee can edit/complete (not reassign)
4. Nav badge = unread pending invites (`GET /tasks/pending/unseen-count`); opening Tasks clears via `POST /tasks/pending/seen`
5. Realtime: `task:updated` / `task:deleted` merge into `TasksPanel` without refresh (SSE-compatible)

**Notes flow:**

1. Open **Notes** from nav (desktop rail; mobile **More** ⋮ menu groups Tasks, Notes, Profile)
2. Filter list: All / Mine / Shared with me; create new note
3. Editor: title + body; **Save** (optimistic `version`); owner **Delete**
4. Owner opens **Share** side panel → pick reader or contributor role → search and add people; manage members list
5. **History** side panel lists revisions; GitHub-style line diff (`noteDiff.ts`) shows before/after per changed field; owner can **Clear history**
6. Realtime: `note:updated` / `note:deleted` merge into list and open editor without duplicates (`upsertNote` dedupe)

**Stories flow:**

1. `StoriesTray` above the chat list loads `GET /stories/feed` (self ring + contact rings; blue ring = unseen)
2. Compose (`StoryComposerModal`): pick image/video, optional caption → `POST /stories`
3. Open a ring → `StoryViewerModal` loads `GET /stories/user/:id`; auto-advances with progress bars; tap next/prev; pause while reply input focused
4. Non-owner: like toggle + reply form; reply creates DM with story quote and jumps to that conversation
5. Owner: Views button → bottom sheet of viewers with heart for likers; can add another story or delete
6. Marking views updates the ring (`hasUnseen`); feed refreshes on `story:created` / `story:deleted`

**Dev HTTPS / LAN:**

- Vite dev (`desktop/vite.config.ts`): `@vitejs/plugin-basic-ssl`, `host: true`, proxies `/api` and `/socket.io` to `http://127.0.0.1:3000`
- `endpoints.ts`: on `https://` + non-localhost host (LAN phone/laptop), API/WS use same origin (through Vite proxy); on `localhost` / Electron, direct `http://localhost:3000`
- Microphone/camera APIs require secure context — `http://192.168.x.x` is blocked; use `https://192.168.x.x:5173`

### Admin client (`admin/` — `chatapp-admin`)

Separate workspace: Vite + React (port 5174). Uses the same JWT auth; requires `users.is_admin = TRUE`. Dev: `npm run dev:admin` from repo root.

- **Dashboard**: user/message/conversation counts, recent activity, collapsible storage breakdown (MinIO + DB)
- **Users**: list with role/status filters, avatars, debounced search; detail with session count, message stats
- **Authentication**: provider toggles, LDAP connection (test/preview), group mappings, sync interval/history, auth statistics and failed-login audit
- **Audit log**: filterable paginated trail with expandable metadata, debounced search

Admin avatars and attachments use the same API content proxy as the chat client (`admin/src/utils/storageUrl.ts`, `mediaCache.ts`).

**Service URL resolution** (`endpoints.ts`):

| Context | API | WebSocket |
|---------|-----|-----------|
| `localhost` / `127.0.0.1` (dev) | `http://localhost:3000/api/v1` | `http://localhost:3000` |
| LAN `https://192.168.x.x:5173` (dev) | `https://192.168.x.x:5173/api/v1` (Vite proxy) | `https://192.168.x.x:5173` (Vite proxy) |
| LAN `http://192.168.x.x:5173` | `http://192.168.x.x:3000/api/v1` | `http://192.168.x.x:3000` |
| Production HTTPS | same host, port 3000 or edge URL | WSS at same host |

Override with `VITE_API_URL` / `VITE_WS_URL` in `desktop/.env`.

## 14. Admin & Audit Architecture

```
┌──────────────┐     JWT + is_admin     ┌─────────────────┐
│  admin/ app  │ ──────────────────────►│  AdminModule    │
│  (5174)      │     /admin/*           │  AdminGuard     │
└──────────────┘                        └────────┬────────┘
                                                 │
     ┌───────────────────┬───────────────────────┼───────────────────────┐
     ▼                   ▼                       ▼                       ▼
┌─────────────┐  ┌─────────────┐  ┌──────────────────────────┐  ┌─────────────┐
│ user stats  │  │ storage     │  │ DirectoryModule          │  │ audit_logs  │
│ sessions    │  │ DB + MinIO  │  │ /settings/authentication │  │ append-only │
└─────────────┘  └─────────────┘  │ LDAP, sync, mappings     │  └─────────────┘
                                  └──────────────────────────┘
```

**AuditModule** (global): `AuditService.record()` called from auth, messages, conversations, contacts, notes, tasks, stories, and admin actions. Writes to `audit_logs` with action, resource, metadata JSON, IP, and user agent.

**AuthenticationAuditService** (directory): provider-scoped events (login success/fail, config change, connection test, sync) in `authentication_audit_logs`.

**Admin storage metrics** (`AdminStorageService`):

- PostgreSQL table sizes via `pg_total_relation_size`
- MinIO bucket object counts and total bytes via `S3StorageProvider.getBucketStats()` (`ListObjectsV2`)
- Message counts by media kind (text, image, video, etc.)
- Legacy local upload folder sizes (`backend/uploads/` — pre-MinIO data only, informational)

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
  │── GET /attachments/:id/content (JWT) ───────────────────►│
  │◄── streamed bytes ─────────│◄── getObjectStream() ────────│
  │                            │                              │
  │── GET /attachments/:id/download (optional) ─────────────►│
  │◄── presigned URL JSON ─────│                              │
```

### Design principles

- **PostgreSQL stores metadata only** — `attachments` table (migration `021_attachments.sql`): `bucket`, `object_key`, `mime_type`, `checksum`, relations to `users`, `conversations`, `messages`.
- **Blobs in object storage** — never in the database. Object keys use `chat/YYYY/MM/DD/{uuid}.{ext}`.
- **Provider abstraction** — `IStorageProvider` + `S3StorageProvider` (AWS SDK v3). Switching MinIO → AWS S3 is env-only (`S3_ENDPOINT`, credentials, region).
- **API content proxy (primary client path)** — `GET /attachments/:id/content` streams object bytes through the API with JWT auth. Clients never need direct MinIO access (works on LAN/mobile when only the API port is reachable).
- **Presigned URLs (optional)** — `GET /attachments/:id/download` returns a short-lived MinIO URL for external integrations; chat/admin clients use `/content` instead.
- **Permission checks** — conversation membership, ownership, avatar bucket read access for authenticated users.
- **Upload scanning** — `file-scan.util.ts` rejects dangerous extensions, double-extension filenames, and content that does not match magic bytes / MIME. `FileScanHook` re-checks content on `onBeforeUpload`; optional ClamAV INSTREAM when `FILE_SCAN_CLAMAV_ENABLED=true`.
- **Extension hooks** — `StorageHook` for scan (implemented), compression, thumbnails.

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
| `GET /conversations/:id/attachments` | Per-chat file browser (filter + pagination) |
| `POST /attachments/upload` | Direct upload API |
| `POST /conversations/:id/messages/attachment` | Chat message attachments |
| `POST /stories` | Story media (image/video) |
| `POST /users/me/avatar` | Profile avatar |
| `POST /conversations/:id/avatar` | Channel/group avatar |

All delegate to `StorageService.upload()`.

### Client download flow

1. New uploads store `/api/v1/attachments/{id}/content` in message metadata (not a direct MinIO URL).
2. Client (`storageUrl.ts`) fetches `/content` with JWT, optionally caches the blob in IndexedDB (`mediaCache.ts`), and serves a `blob:` URL.
3. `<img>`, `<video>`, `<audio>` use the blob URL. Profile → Offline cache shows IndexedDB usage and supports clear.
4. Legacy messages may still reference `/download` or `/uploads/*`; those paths remain for backward compatibility.

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
| `WEBRTC_STUN_URLS` | Comma-separated STUN URLs for voice/video calls | Google public STUN (dev) |
| `TURN_URL` | Optional TURN server URL | unset |
| `TURN_USERNAME` / `TURN_PASSWORD` | TURN credentials (all three required to enable) | unset |
| `DIRECTORY_ENCRYPTION_KEY` | AES key for LDAP bind password at rest (64 hex chars preferred) | optional (derived from JWT secrets if unset) |

**Production:** `S3_ENDPOINT`, credentials, region, and bucket env vars are required (Zod validation in `backend/src/config/env.ts`). Set `DIRECTORY_ENCRYPTION_KEY` when Active Directory is enabled.

**Per-workspace env files** (created by `npm run setup` from `*.env.example`):

| File | Workspace | Notes |
|------|-----------|-------|
| `.env` | root / Compose | Postgres, Redis, shared Compose vars |
| `backend/.env` | `chatapp-backend` | `DATABASE_URL`, JWT secrets, `PORT`, etc. |
| `desktop/.env` | `chatapp-desktop` | optional `VITE_API_URL`, `VITE_WS_URL` |
| `admin/.env` | `chatapp-admin` | optional `VITE_API_URL` |

**Desktop / Admin (Vite):** `VITE_API_URL`, `VITE_WS_URL` override defaults when not using LAN auto-detection. `VITE_API_PROXY_TARGET` (desktop dev only) overrides the backend target for the Vite `/api` and `/socket.io` proxies (default `http://127.0.0.1:3000`).

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

SSE mode is automatic; no user configuration required. **Voice and video calls are disabled in SSE mode** — WebSocket is required for `call:*` signaling and WebRTC setup.
