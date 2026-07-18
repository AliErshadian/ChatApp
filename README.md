# ChatApp — Enterprise Internal Messaging Platform

Production-oriented MVP for a Slack-like internal chat system with cross-platform desktop client (Electron), browser dev client (Vite + React), **admin dashboard**, modular NestJS backend, PostgreSQL persistence, Redis-backed real-time scaling, and **MinIO** (S3-compatible) object storage.

The repository is an **npm workspaces** monorepo (`backend`, `desktop`, `admin`) with a single root lockfile and orchestration scripts at the repo root.

## Quick Start (Docker Compose)

```bash
# From repository root
cp .env.example .env

# Start PostgreSQL, Redis, MinIO, and API
docker compose up --build -d

# Verify health
curl http://localhost:3000/api/v1/health
```

### Production-like run (nginx + MinIO)

```bash
# Ensure you set strong secrets first
cp .env.example .env
# edit .env and set JWT_* secrets (32+ chars)

docker compose -f docker-compose.prod.yml up --build -d
curl http://localhost/api/v1/health
```

### Notes

- **Database schema**: initialized from `infra/postgres/init.sql` when the `postgres` container is first created.
- **Incremental migrations**: SQL files in `infra/postgres/migrations/` are applied automatically by `npm run migrate` (or the Compose `migrate` service before `api`). Fresh Compose databases also seed `schema_migrations` from `init.sql`; run `npm run check:schema-drift` after editing either file. If you see a checksum mismatch after a line-ending normalization update, run `node backend/scripts/repair-migration-checksums.mjs` (dev only, when migration SQL on disk matches what was applied).
- **Object storage**: uploads (avatars, message attachments, **story media**) go to **MinIO** (S3-compatible). PostgreSQL stores metadata only in the `attachments` table. Clients download via **`GET /attachments/:id/content`** (API streams from MinIO with JWT) — works on LAN/mobile without exposing MinIO. `GET /attachments/:id/download` still returns presigned URLs for external integrations.
- **MinIO console** (local): http://127.0.0.1:9001 — login `minioadmin` / `minioadmin` (default). Objects live under buckets like `attachments/chat/2026/07/12/{uuid}.png`.
- **Legacy `uploads/`**: older local-disk files may still exist under `backend/uploads/`; new uploads use MinIO. The API still serves `/uploads/*` for backward compatibility.

### Local Development (from repo root)

```bash
# One-time: copy .env files + install all workspace deps
npm run setup

# Optional: start Postgres + Redis + MinIO (if not using full docker compose)
npm run dev:infra

# Run backend + Electron desktop together
npm run dev

# Or run them separately (still from root)
npm run dev:backend
npm run dev:desktop
npm run dev:admin      # Admin dashboard only (http://localhost:5174)
npm run dev:all        # Backend + desktop + admin together
```

### Admin dashboard

Separate web app in `admin/` (port **5174**). Uses the same API with admin-only routes under `/api/v1/admin/*`.

1. Run migrations (existing databases or after pulling new SQL files):

```bash
npm run migrate
```

2. Promote an admin user in Postgres:

```sql
UPDATE users SET is_admin = TRUE WHERE email = 'your@email.com';
```

3. Start API + admin:

```bash
npm run dev:backend
npm run dev:admin
```

Open http://localhost:5174 and sign in with the admin account.

The admin UI includes a compact dashboard, debounced user/audit search, fixed sidebar (bottom nav on mobile), MinIO bucket metrics in the storage panel, and avatar display via the same API content proxy as the chat client.

**MinIO without Docker:** download [MinIO Server for Windows](https://min.io/download) (AMD64), then:

```powershell
mkdir C:\minio-data
.\minio.exe server C:\minio-data --console-address ":9001"
```

Set `S3_ENDPOINT=127.0.0.1` in `backend/.env` (see `backend/.env.example`). Buckets are auto-created on first upload, or create them in the console: `avatars`, `attachments`, `voice`, `videos`, `documents`, `backups`.

**Browser-only client** (no Electron): start the API (`npm run dev:backend`), then `npm run dev:desktop` from the repo root.

- **This machine**: open `https://localhost:5173` (Vite dev uses a self-signed certificate via `@vitejs/plugin-basic-ssl`; accept the browser warning).
- **Another device on LAN**: open `https://<your-LAN-IP>:5173` (not `http://`). Microphone/camera access (voice/video calls, voice messages) requires a **secure context** — plain HTTP on a LAN IP is blocked by browsers.
- On LAN HTTPS, the Vite dev server proxies `/api` and `/socket.io` to the backend on port 3000 (avoids mixed-content issues). On `localhost`, the client talks to `http://localhost:3000` directly.
- Auth persists in `localStorage`. API/WebSocket URLs are resolved in `desktop/src/config/endpoints.ts`. Media downloads use the API proxy, so MinIO does not need to be reachable from other devices.
- If WebSocket is blocked, the client automatically falls back to SSE + REST (text chat only — **voice/video calls require WebSocket**).

## Technology Choices

| Layer | Choice | Rationale |
|-------|--------|-----------|
| Backend | **NestJS** | Modular DI, first-class WebSocket gateway, guards/pipes for security, TypeScript parity with client, Redis adapter for horizontal scaling |
| Desktop | **Electron + React** | Cross-platform (Windows/Linux/macOS), native notifications, system tray, secure token storage |
| Web client | **Vite + React** | Same UI as Electron; fast iteration without packaging |
| Real-time | **Socket.IO + Redis adapter** (primary); **SSE + REST fallback** when WebSocket is blocked | Room-based routing; Redis pub/sub for multi-instance and SSE fanout |
| Database | **PostgreSQL** | ACID guarantees, BIGINT sequences for message ordering, relational membership model |
| Cache/Presence | **Redis** | Presence TTL, typing indicators, Socket.IO adapter |
| Object storage | **MinIO** (S3-compatible) | Horizontally scalable file storage; AWS SDK v3; swappable to AWS S3 via env |

**Why not FastAPI?** NestJS integrates HTTP guards and WebSocket auth in one process with a consistent module layout.

**Why not Tauri?** Electron offers mature notification/tray APIs and encrypted credential storage today; the UI is standard React and could be repackaged later.

## Project Structure

```
ChatApp/
├── package.json                # npm workspaces root (backend, desktop, admin)
├── package-lock.json           # Single lockfile for all workspaces
├── scripts/setup-env.js        # Copies .env.example → .env
├── backend/                    # NestJS API + WebSocket gateway
│   └── src/
│       ├── modules/
│       │   ├── auth/           # JWT, refresh rotation, device sessions
│       │   ├── audit/          # User behavior audit trail
│       │   ├── users/
│       │   ├── contacts/
│       │   ├── conversations/  # DMs, channels, groups, invites
│       │   ├── messages/       # Text, attachments, mentions, reactions, threads, polls, search
│       │   ├── calls/          # 1:1 DM voice/video calls (WebRTC signaling, history, ICE)
│       │   ├── tasks/          # Tasks with assignment acceptance, unread invites, realtime
│       │   ├── notes/          # Personal/shared notes, roles, revision history, realtime
│       │   ├── stories/        # Ephemeral stories (24h), views, likes, replies → DM
│       │   ├── admin/          # Admin-only REST (stats, users, storage)
│       │   ├── presence/
│       │   └── realtime/       # WebSocket gateway, SSE stream, event bus, REST fallback
│       ├── storage/            # S3-compatible object storage (MinIO provider)
│       │   ├── storage.service.ts
│       │   ├── storage.controller.ts
│       │   ├── storage.repository.ts   # attachments list queries
│       │   ├── providers/s3-storage.provider.ts
│       │   └── entities/attachment.entity.ts
│       ├── infrastructure/
│       │   ├── redis/
│       │   └── websocket/      # Redis Socket.IO adapter
│       └── observability/      # Pino logging, Sentry, Prometheus metrics
├── desktop/                    # Electron + React client
│   ├── electron/               # Main process, tray, secure auth store
│   └── src/
│       ├── components/
│       │   ├── StoriesTray.tsx          # Story rings above chat list
│       │   ├── StoryComposerModal.tsx   # Create photo/video story
│       │   ├── StoryViewerModal.tsx     # Progress, like, reply, viewers sheet
│       │   ├── MessageStoryQuote.tsx    # Story quote in DM reply bubbles
│       │   ├── ThreadPanel.tsx          # Slack-style thread (replies, search, files)
│       │   ├── CreatePollModal.tsx      # Group poll create (Anonymous / Multiple choice)
│       │   ├── MessagePoll.tsx          # In-chat poll card (tap-to-vote, close)
│       │   ├── FileManagementPanel.tsx  # Per-chat shared files UI
│       │   ├── CallsPanel.tsx           # Call history (filters, callback)
│       │   ├── TasksPanel.tsx           # Tasks (open/pending/completed, accept/reject, assign)
│       │   ├── CreateTaskModal.tsx      # Manual task create + assign
│       │   ├── AssigneePicker.tsx       # Shared assignee search picker
│       │   ├── NotesPanel.tsx           # Notes (personal/shared, share, history diff)
│       │   └── VoiceCallModal.tsx       # Voice/video call overlay
│       ├── services/
│       │   └── voiceCall.ts             # WebRTC peer connection manager
│       └── utils/
│           ├── messageScroll.ts         # First-unread / bottom scroll helpers
│           ├── noteDiff.ts              # Line diff for note revision history
│           └── mediaDevices.ts          # Mic/camera access + HTTPS/LAN error messages
├── admin/                      # Admin dashboard (Vite + React, port 5174)
│   └── src/
│       ├── pages/              # Dashboard, users, user detail, audit log
│       ├── services/           # Admin API client
│       └── components/
├── infra/postgres/
│   ├── init.sql                # Full schema for new databases
│   └── migrations/             # Incremental SQL migrations (002–033+)
├── docs/
│   ├── ARCHITECTURE.md
│   └── PROJECT_REVIEW.md
└── docker-compose.yml
```

## API Reference

Base URL: `http://localhost:3000/api/v1`

### Auth

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/auth/register` | Create account (optional `clientInfo` for device label) |
| POST | `/auth/login` | Get access + refresh tokens + `sessionId` |
| POST | `/auth/refresh` | Rotate tokens (preserves session) |
| POST | `/auth/logout` | Revoke refresh token and session |
| GET | `/auth/sessions` | List active devices/sessions |
| DELETE | `/auth/sessions/:sessionId` | Terminate a session (remote logout) |
| DELETE | `/auth/sessions/others?except=:sessionId` | Terminate all other sessions |

### Admin (`/admin/*`, requires `is_admin`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/admin/me` | Current admin profile |
| GET | `/admin/stats` | Platform statistics (users, messages, conversations, audit activity) |
| GET | `/admin/storage` | Storage breakdown (DB tables, MinIO buckets, message kinds) |
| GET | `/admin/users` | Paginated user list (`page`, `limit`, `q`, `isActive`, `role`, `sort`) |
| GET | `/admin/users/:id` | User detail |
| PATCH | `/admin/users/:id` | Update `isActive`, `isAdmin` |
| GET | `/admin/users/:id/sessions` | User's active sessions |
| DELETE | `/admin/users/:id/sessions/:sessionId` | Force logout device |
| DELETE | `/admin/users/:id/sessions` | Terminate all user sessions |
| GET | `/admin/audit-logs` | Paginated audit trail (`page`, `limit`, `userId`, `category`, `action`, `from`, `to`, `q`) |

The **admin dashboard** (`admin/`, port 5174) includes Dashboard (stats + collapsible storage panel with MinIO bucket usage), Users (filters, avatars, detail, sessions), and Audit log (expandable rows, date/action filters).

The **audit trail** records sign-in/out, messages, conversations, contacts, tasks, notes, stories, profile changes, and admin actions. Apply migration `019_audit_logs.sql` on existing databases.

Access tokens include a `sid` claim (session id). Refresh tokens are SHA-256 hashed at rest and grouped by `session_family_id` / `user_sessions.id`.

### Conversations & Messages

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/conversations` | List conversations (pins, unread, last message) |
| POST | `/conversations/channels` | Create channel |
| POST | `/conversations/groups` | Create group |
| POST | `/conversations/direct` | Create/get DM |
| GET/POST | `/conversations/:id/messages` | History (channel roots only) + send (REST); realtime preferred for send |
| GET | `/conversations/:id/messages/unread-threads` | Threads with unread replies for the current user (count = number of threads) |
| GET | `/conversations/:id/messages/:messageId/thread` | Thread root + replies (marks thread read); returns `firstUnreadMessageId` |
| GET | `/conversations/:id/messages/:messageId/thread/search` | Full-text search within a thread (`q`, `limit`) |
| GET | `/conversations/:id/attachments` | List shared files (`kind`, `cursor`, `limit`; filter: all/mine/shared/image/video/document/audio/voice) |
| POST | `/conversations/:id/messages/attachment` | Upload file attachment (stored in MinIO; optional `threadRootId` / `replyToMessageId`) |
| POST | `/conversations/:id/polls` | Create a **group** poll (`question`, `options` 2–10, `anonymous`, `allowsMultiple`) |
| POST | `/conversations/:id/polls/:pollId/vote` | Tap-to-vote (`optionId`; single = switch, multi = toggle) |
| POST | `/conversations/:id/polls/:pollId/close` | Close poll (**sender only**) |
| PATCH/DELETE | `/conversations/:id/messages/:messageId` | Edit / delete message |
| GET | `/messages/search` | Full-text search (`q`, `limit`; min 2 chars; Postgres FTS + GIN index) |
| POST | `/conversations/:id/messages/:messageId/reactions` | Toggle reaction |
| POST | `/contacts` | Add contact |
| GET | `/users/search` | Partial user search (username, display name, email) |

### Voice & video calls (1:1 DMs only)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/calls/ice-servers` | STUN/TURN ICE server list for WebRTC (`WEBRTC_STUN_URLS`, optional `TURN_*` in `backend/.env`) |
| GET | `/calls/history` | Call history (`filter`, `cursor`, `limit`; filters: all/incoming/outgoing/missed/cancelled/not_answered) |
| GET | `/calls/missed/unseen-count` | Count of unseen missed calls for the current user (nav badge) |
| POST | `/calls/missed/seen` | Mark all missed calls as seen (clears badge when opening Calls) |

Signaling is over WebSocket only (not SSE). DM membership is enforced server-side; groups and channels are not supported. Unanswered rings auto-end after **15s** (`timeout`): history shows **Missed** for the callee and **Cancelled** for the caller.

### Tasks

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/tasks` | List tasks (`status`: `open` \| `completed` \| `all` \| `pending`; optional `conversationId`) |
| GET | `/tasks/pending/unseen-count` | Unread pending-assignment count for nav badge |
| POST | `/tasks/pending/seen` | Mark pending invites seen (clears badge when opening Tasks) |
| POST | `/tasks` | Create task manually (`title`, optional `description`, `assignedTo`, `dueAt`, `conversationId`) |
| POST | `/tasks/from-message` | Create task from message (`messageId` + optional overrides) |
| POST | `/tasks/:id/assign` | Assign / reassign / unassign (`assigneeId`, optional `version` for race safety) |
| POST | `/tasks/:id/accept` | Accept pending assignment (recipient only) |
| POST | `/tasks/:id/reject` | Reject pending assignment (recipient only) |
| POST | `/tasks/:id/cancel-assignment` | Cancel pending offer (creator only) |
| PATCH | `/tasks/:id` | Update title, description, due date, completed |
| DELETE | `/tasks/:id` | Delete task (creator only) |

**Assignment flow:** assigning another user creates a **pending invitation** — they must **Accept** before the task appears in their Open list. Self-assign and unassigned tasks skip pending. Reassignment keeps the current assignee until the new recipient accepts; rejection leaves the prior assignment unchanged. Unread pending invites drive the Tasks nav badge; opening Tasks marks them seen.

### Notes

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/notes` | List notes (`scope`: `all` \| `mine` \| `shared`) |
| POST | `/notes` | Create note (`title`, optional `body`) |
| GET | `/notes/:id` | Get note (membership required) |
| PATCH | `/notes/:id` | Update title/body (`version` optional for optimistic concurrency) |
| DELETE | `/notes/:id` | Delete note (owner only) |
| GET | `/notes/:id/history` | Revision history (who changed what) |
| DELETE | `/notes/:id/history` | Clear revision history (owner only) |
| GET | `/notes/:id/members` | List members and roles |
| POST | `/notes/:id/members` | Share note (`userId`, `role`: `reader` \| `contributor`) |
| PATCH | `/notes/:id/members/:userId` | Change member role (owner only) |
| DELETE | `/notes/:id/members/:userId` | Remove access (owner or self-leave) |

**Sharing & permissions:** owner can share with **reader** (view only) or **contributor** (edit). Each save records a revision (`note_revisions`) with `changed_fields`, editor, and version. Updates use optimistic concurrency via `version` (409 on conflict). Realtime: `note:updated` / `note:deleted` to all members (WebSocket + SSE).

### Stories

Ephemeral photo/video stories (24h), visible to the author’s **contacts** (and self). Migrations `032_stories`, `033_story_likes`.

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/stories/feed` | Story rings for self + contacts (`hasUnseen`, `storyCount`, latest) |
| GET | `/stories/user/:userId` | Active stories for a user (oldest first; `viewedByMe`, `likedByMe`; owner also gets `viewCount` / `likeCount`) |
| POST | `/stories` | Create story (multipart `media` + optional `caption`; image/video) |
| POST | `/stories/:id/view` | Mark viewed (idempotent; higher throttle for browsing) |
| GET | `/stories/:id/viewers` | List viewers (**owner only**); includes `liked` / `likedAt` |
| POST | `/stories/:id/like` | Like story (non-owner; also ensures a view row) |
| DELETE | `/stories/:id/like` | Unlike story |
| POST | `/stories/:id/reply` | Reply → opens/creates DM with story-quoted message (`messages.story_id`) |
| DELETE | `/stories/:id` | Delete story (**owner only**) |

**Product rules:** audience = author’s contacts (+ self); media expires after 24h; replies become DM messages with a story quote. Realtime: `story:created` / `story:deleted` to author + contacts (WebSocket + SSE).

### Attachments (object storage)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/attachments/upload` | Upload file (`conversationId` required); metadata in Postgres, blob in MinIO |
| GET | `/attachments/:id` | Attachment metadata (auth + membership check) |
| GET | `/attachments/:id/content` | Stream file bytes through API (JWT; used by clients) |
| GET | `/attachments/:id/download` | Presigned MinIO URL JSON (2-minute expiry; optional/external) |
| DELETE | `/attachments/:id` | Delete object + metadata |

Message attachments also flow through `POST /conversations/:id/messages/attachment`, which uses the storage layer internally. Clients fetch media via `/content` with JWT, cache blobs in IndexedDB, and display via `blob:` URLs (`desktop/src/utils/storageUrl.ts`, `desktop/src/utils/mediaCache.ts`).

See controllers under `backend/src/modules/` for the full surface area (invites, avatars, pins, forwards, etc.).

### WebSocket (`/realtime` namespace)

Connect with `auth: { token: <accessToken> }`. Clients join `user:{userId}` and `session:{sessionId}` rooms automatically. This is the **preferred** transport.

| Event | Direction | Description |
|-------|-----------|-------------|
| `conversation:join` / `leave` | Client → Server | Room membership |
| `message:send` | Client → Server | Send message (optional `clientMessageId`, `replyToMessageId`, **`threadRootId`**) |
| `message:receive` / `message:ack` | Server ↔ Client | Delivery + optimistic UI ack (thread replies include `threadRootId` + `thread` meta; polls include `poll` payload) |
| `message:updated` / `message:hidden` | Server → Client | Edit/delete sync; **poll vote & close** tallies (viewer-specific `poll` on update) |
| `message:status` | Server → Client | Delivered/read receipts |
| `message:reaction` | Server → Client | Reaction updates |
| `conversation:created` / `updated` / `hidden` | Server → Client | Sidebar sync |
| `user:typing` | Bidirectional | Typing indicators |
| `user:presence` / `presence:sync` | Server → Client | Online/offline |
| `session:created` | Server → Client | New login on another device |
| `session:terminated` | Server → Client | Force logout (session revoked) |
| `presence:heartbeat` | Client → Server | Keep-alive |
| `call:invite` / `call:accept` / `call:reject` / `call:end` | Client → Server | 1:1 voice/video call signaling (DM only; invite may include `mediaType`: `audio` \| `video`) |
| `call:signal` | Client → Server | WebRTC offer/answer/ICE trickle |
| `call:incoming` / `call:accepted` / `call:ended` | Server → Client | Call state sync (`incoming` includes `mediaType`) |
| `call:signal` | Server → Client | Forwarded WebRTC SDP/ICE to peer |
| `task:updated` | Server → Client | Task created/updated/assigned/accepted/rejected/completed (full `TaskItem` payload) |
| `task:deleted` | Server → Client | Task removed (`{ taskId }`) |
| `note:updated` | Server → Client | Note created/updated/shared/permission changed (full `NoteItem` payload) |
| `note:deleted` | Server → Client | Note removed (`{ noteId }`) |
| `story:created` | Server → Client | New story for a contact/self (`story` + `author`) |
| `story:deleted` | Server → Client | Story removed (`{ storyId, authorId }`) |

### SSE fallback (`/realtime/*`)

When WebSocket is blocked (corporate proxies, strict firewalls), the desktop/browser client automatically falls back to:

- **Server → client**: `GET /realtime/stream?access_token=<JWT>` (`text/event-stream`, named events matching WebSocket event names)
- **Client → server**: REST endpoints under `/realtime/*`

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/realtime/stream` | SSE event stream (auth via Bearer or `access_token` query) |
| POST | `/realtime/messages/send` | Send text message |
| POST | `/realtime/messages/delivered` | Mark delivered |
| POST | `/realtime/messages/read` | Mark read |
| POST | `/realtime/messages/edit` | Edit message |
| POST | `/realtime/messages/delete` | Delete message |
| POST | `/realtime/messages/reaction` | Toggle reaction |
| POST | `/realtime/conversations/:id/join` | Subscribe SSE to conversation events |
| POST | `/realtime/conversations/:id/leave` | Unsubscribe conversation |
| DELETE | `/realtime/conversations/:id` | Delete/hide conversation |
| POST | `/realtime/typing` | Typing indicator |
| POST | `/realtime/presence/heartbeat` | Presence keep-alive |
| POST | `/realtime/presence/query` | Batch presence lookup |

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for payload examples, scaling strategy, security details, and monorepo layout (§2).

See [docs/PROJECT_REVIEW.md](docs/PROJECT_REVIEW.md) for strengths, risks, and roadmap.

## Client Features (current)

- DMs, channels, and groups with invites and member management
- Message edit/delete, **Slack-style threads**, **group polls**, quote replies within a thread, forwards, reactions, attachments (images/video/audio/documents via MinIO)
- **Threads**: Reply opens a side panel (root + replies); thread replies stay out of the main feed; reply-count chip on roots; per-thread tabs for **Replies / Search / Files**; reactions work on thread messages
- **Unread threads bar** (top of chat): shows how many threads have unread replies; click cycles to each unread thread root in the timeline
- Open chat/thread: scroll to **first unread** (loads older history if needed); if nothing unread, scroll to **bottom**
- **Polls** (groups only): composer poll button → create modal (Anonymous, Multiple choice); tap option to vote; results after vote/close; **Close Poll** for sender only; list preview `Poll: {question}`
- `@mentions` with autocomplete and in-app mention toasts
- In-app notifications: mentions, new DMs, added to group/channel, new device login
- Read/delivered ticks, typing indicators, presence
- Profile avatars, conversation pins, contact list
- **Search**: sidebar filter (chats/groups/channels + message content); global search (`Ctrl+K` / `Cmd+K`); click result to jump and scroll to message
- **File management**: per-chat shared files panel (📁 in header or conversation info); tabs for All, My uploads, Shared, Images, Videos, Documents, Audio, Voice; preview, download, jump to message
- **Voice & video calls** (DMs only): 📞 / 📹 in DM header; WebRTC audio/video with Socket.IO signaling; phone-style controls (mute, speaker, camera); desktop video overlay with compact corner controls; **15s** ring timeout; call history tab (`CallsPanel`) with filters; unseen missed-call badge on Calls nav; requires WebSocket (not SSE fallback)
- **Tasks**: nav tab with pending-invite badge; create manually or **Convert to Task** from message menu; assign with **acceptance required**; Pending tab (count + Accept/Reject); Open/Completed filters; due date, complete toggle, reassign (creator), delete (creator); live updates via `task:updated` / `task:deleted` (WebSocket + SSE)
- **Notes**: nav tab (desktop rail; mobile **More** ⋮ menu with Tasks and Profile); personal notes and shared notes with **reader** / **contributor** roles; editor with save/delete; share panel (search people, role picker); **change history** with GitHub-style before/after diff; owner can **clear history**; live sync via `note:updated` / `note:deleted` (WebSocket + SSE)
- **Stories**: tray above the chat list (`StoriesTray`); compose photo/video + caption; viewer with progress bars, like, reply (pauses while typing), owner viewers sheet (who viewed / liked); replies open the DM with a story quote; ring turns gray after all stories seen; live feed via `story:created` / `story:deleted`
- **Devices** (Profile → Devices): Telegram-style session list, terminate device, terminate all others
- **Offline cache** (Profile → Offline cache): IndexedDB blob cache for avatars/attachments; view size and clear cache
- **Realtime fallback**: automatic SSE + REST when WebSocket cannot connect
- Electron: system tray, native notifications, encrypted refresh-token store, deep links (`chatapp://`); dev loads `https://localhost:5173` with self-signed cert trust

### LAN / microphone & camera (dev)

Browsers only expose `navigator.mediaDevices` in secure contexts (`https://` or `localhost`). The Vite dev server serves HTTPS (`@vitejs/plugin-basic-ssl`) with `host: true` so other devices can open `https://<LAN-IP>:5173`. Optional TURN (`TURN_URL`, `TURN_USERNAME`, `TURN_PASSWORD` in `backend/.env`) helps when peers are behind restrictive NAT.

## Security

- JWT access tokens (15m, includes `sid`) + rotating refresh tokens (7d, hashed at rest)
- Per-device sessions in `user_sessions`; revoked sessions fail REST, WebSocket, and SSE immediately
- WebSocket auth on handshake; session validated on each access-token use
- `class-validator` on REST DTOs; `sanitize-html` on message content
- `@nestjs/throttler` (stricter on auth endpoints)
- Helmet security headers; CORS allowlist (LAN/private origins supported in dev)
- File uploads: MIME/size validation, UUID object keys; downloads via authenticated API proxy (no public buckets; MinIO internal to server)
- TLS termination expected at reverse proxy in production

## Object Storage (MinIO / S3)

Files are **never stored in PostgreSQL** — only metadata (`attachments` table). Blobs live in MinIO buckets:

| Bucket | Purpose |
|--------|---------|
| `avatars` | User and conversation avatars |
| `attachments` | Message images |
| `videos` | Message videos |
| `voice` | Audio messages |
| `documents` | PDF, Office docs, zip |
| `backups` | Reserved for future use |

Configure via `backend/.env` (`S3_ENDPOINT`, `S3_PORT`, `S3_ACCESS_KEY`, etc.). The API connects to MinIO internally (`S3_ENDPOINT=127.0.0.1` in dev). Clients never need direct MinIO access — only the API port. Production requires S3 env vars (validated at startup). Switching to AWS S3 is a configuration change only — the `S3StorageProvider` uses AWS SDK v3 with `forcePathStyle`.

## Production Deployment Notes

1. Set strong `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` (32+ chars)
2. Place API behind TLS-terminating load balancer
3. Scale API horizontally — Redis adapter syncs Socket.IO across instances; Redis event bus fans out SSE streams
4. Use managed PostgreSQL with connection pooling (PgBouncer)
5. Redis Cluster / Sentinel for HA presence + pub/sub
6. Set `CORS_ORIGIN` to explicit client origins in production
7. Enable structured logging (pino), Sentry (`SENTRY_DSN`), and metrics (Prometheus)
8. Use managed S3 or self-hosted MinIO for object storage (required for multi-instance deployments)
9. Validate production env before deploy: `npm run build -w chatapp-backend && NODE_ENV=production npm run validate:env -w chatapp-backend`

## CI/CD

- **CI**: root `npm ci`; backend, desktop, and admin lint/build via workspaces; Docker image build (repo root context) on PRs and `main`
- **CD**: publishes backend image to GHCR on `main` and version tags (`vX.Y.Z`)
  - Image: `ghcr.io/<owner>/<repo>/backend`

## License

MIT
