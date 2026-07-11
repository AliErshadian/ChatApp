# ChatApp — Enterprise Internal Messaging Platform

Production-oriented MVP for a Slack-like internal chat system with cross-platform desktop client (Electron), browser dev client (Vite + React), **admin dashboard**, modular NestJS backend, PostgreSQL persistence, and Redis-backed real-time scaling.

The repository is an **npm workspaces** monorepo (`backend`, `desktop`, `admin`) with a single root lockfile and orchestration scripts at the repo root.

## Quick Start (Docker Compose)

```bash
# From repository root
cp .env.example .env

# Start PostgreSQL, Redis, and API
docker compose up --build -d

# Verify health
curl http://localhost:3000/api/v1/health
```

### Production-like run (nginx + persistent uploads)

```bash
# Ensure you set strong secrets first
cp .env.example .env
# edit .env and set JWT_* secrets (32+ chars)

docker compose -f docker-compose.prod.yml up --build -d
curl http://localhost/api/v1/health
```

### Notes

- **Database schema**: initialized from `infra/postgres/init.sql` when the `postgres` container is first created.
- **Incremental migrations**: SQL files in `infra/postgres/migrations/` are applied automatically by `npm run migrate` (or the Compose `migrate` service before `api`). Fresh Compose databases also seed `schema_migrations` from `init.sql`; run `npm run check:schema-drift` after editing either file.
- **Uploads**: in Docker, files are served from `/app/uploads`; `docker-compose.prod.yml` mounts a named volume there.

### Local Development (from repo root)

```bash
# One-time: copy .env files + install all workspace deps
npm run setup

# Optional: start Postgres + Redis only (if not using full docker compose)
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

**Browser-only client** (no Electron): start the API (`npm run dev:backend`), then `npm run dev:desktop` from the repo root and open `http://localhost:5173`. Auth persists in `localStorage`. The client auto-targets the API on port 3000; when opened via a LAN IP (Vite `host: true`), API/WebSocket URLs follow the same host. If WebSocket is blocked, the client automatically falls back to SSE + REST.

## Technology Choices

| Layer | Choice | Rationale |
|-------|--------|-----------|
| Backend | **NestJS** | Modular DI, first-class WebSocket gateway, guards/pipes for security, TypeScript parity with client, Redis adapter for horizontal scaling |
| Desktop | **Electron + React** | Cross-platform (Windows/Linux/macOS), native notifications, system tray, secure token storage |
| Web client | **Vite + React** | Same UI as Electron; fast iteration without packaging |
| Real-time | **Socket.IO + Redis adapter** (primary); **SSE + REST fallback** when WebSocket is blocked | Room-based routing; Redis pub/sub for multi-instance and SSE fanout |
| Database | **PostgreSQL** | ACID guarantees, BIGINT sequences for message ordering, relational membership model |
| Cache/Presence | **Redis** | Presence TTL, typing indicators, Socket.IO adapter |

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
│       │   ├── messages/       # Text, attachments, mentions, reactions, search
│       │   ├── admin/          # Admin-only REST (stats, users, storage)
│       │   ├── presence/
│       │   └── realtime/       # WebSocket gateway, SSE stream, event bus, REST fallback
│       ├── infrastructure/
│       │   ├── redis/
│       │   └── websocket/      # Redis Socket.IO adapter
│       └── observability/      # Pino logging, Sentry, Prometheus metrics
├── desktop/                    # Electron + React client
│   ├── electron/               # Main process, tray, secure auth store
│   └── src/
├── admin/                      # Admin dashboard (Vite + React, port 5174)
│   └── src/
│       ├── pages/              # Dashboard, users, user detail, audit log
│       ├── services/           # Admin API client
│       └── components/
├── infra/postgres/
│   ├── init.sql                # Full schema for new databases
│   └── migrations/             # Incremental SQL migrations (001–020+)
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
| GET | `/admin/storage` | Storage breakdown (DB tables, upload folders, message kinds) |
| GET | `/admin/users` | Paginated user list (`page`, `limit`, `q`, `isActive`, `role`, `sort`) |
| GET | `/admin/users/:id` | User detail |
| PATCH | `/admin/users/:id` | Update `isActive`, `isAdmin` |
| GET | `/admin/users/:id/sessions` | User's active sessions |
| DELETE | `/admin/users/:id/sessions/:sessionId` | Force logout device |
| DELETE | `/admin/users/:id/sessions` | Terminate all user sessions |
| GET | `/admin/audit-logs` | Paginated audit trail (`page`, `limit`, `userId`, `category`, `action`, `from`, `to`, `q`) |

The **admin dashboard** (`admin/`, port 5174) includes Dashboard (stats + storage panel), Users (filters, detail, sessions), and Audit log (expandable rows, date/action filters).

The **audit trail** records sign-in/out, messages, conversations, contacts, profile changes, and admin actions. Apply migration `019_audit_logs.sql` on existing databases.

Access tokens include a `sid` claim (session id). Refresh tokens are SHA-256 hashed at rest and grouped by `session_family_id` / `user_sessions.id`.

### Conversations & Messages

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/conversations` | List conversations (pins, unread, last message) |
| POST | `/conversations/channels` | Create channel |
| POST | `/conversations/groups` | Create group |
| POST | `/conversations/direct` | Create/get DM |
| GET/POST | `/conversations/:id/messages` | History + send (REST); realtime preferred for send |
| POST | `/conversations/:id/messages/attachment` | Upload file attachment |
| PATCH/DELETE | `/conversations/:id/messages/:messageId` | Edit / delete message |
| GET | `/messages/search` | Full-text search (`q`, `limit`; min 2 chars; Postgres FTS + GIN index) |
| POST | `/conversations/:id/messages/:messageId/reactions` | Toggle reaction |
| POST | `/contacts` | Add contact |
| GET | `/users/search` | Partial user search (username, display name, email) |

See controllers under `backend/src/modules/` for the full surface area (invites, avatars, pins, forwards, etc.).

### WebSocket (`/realtime` namespace)

Connect with `auth: { token: <accessToken> }`. Clients join `user:{userId}` and `session:{sessionId}` rooms automatically. This is the **preferred** transport.

| Event | Direction | Description |
|-------|-----------|-------------|
| `conversation:join` / `leave` | Client → Server | Room membership |
| `message:send` | Client → Server | Send message (with optional `clientMessageId`, reply, mentions) |
| `message:receive` / `message:ack` | Server ↔ Client | Delivery + optimistic UI ack |
| `message:status` | Server → Client | Delivered/read receipts |
| `message:updated` / `message:hidden` | Server → Client | Edit/delete sync |
| `message:reaction` | Server → Client | Reaction updates |
| `conversation:created` / `updated` / `hidden` | Server → Client | Sidebar sync |
| `user:typing` | Bidirectional | Typing indicators |
| `user:presence` / `presence:sync` | Server → Client | Online/offline |
| `session:created` | Server → Client | New login on another device |
| `session:terminated` | Server → Client | Force logout (session revoked) |
| `presence:heartbeat` | Client → Server | Keep-alive |

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
- Message edit/delete, replies, forwards, reactions, attachments (images/video/files)
- `@mentions` with autocomplete and in-app mention toasts
- In-app notifications: mentions, new DMs, added to group/channel, new device login
- Read/delivered ticks, typing indicators, presence
- Profile avatars, conversation pins, contact list
- **Search**: sidebar filter (chats/groups/channels + message content); global search (`Ctrl+K` / `Cmd+K`); click result to jump and scroll to message
- **Devices** (Profile → Devices): Telegram-style session list, terminate device, terminate all others
- **Realtime fallback**: automatic SSE + REST when WebSocket cannot connect
- Electron: system tray, native notifications, encrypted refresh-token store, deep links (`chatapp://`)

## Security

- JWT access tokens (15m, includes `sid`) + rotating refresh tokens (7d, hashed at rest)
- Per-device sessions in `user_sessions`; revoked sessions fail REST, WebSocket, and SSE immediately
- WebSocket auth on handshake; session validated on each access-token use
- `class-validator` on REST DTOs; `sanitize-html` on message content
- `@nestjs/throttler` (stricter on auth endpoints)
- Helmet security headers; CORS allowlist (LAN/private origins supported in dev)
- TLS termination expected at reverse proxy in production

## Production Deployment Notes

1. Set strong `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` (32+ chars)
2. Place API behind TLS-terminating load balancer
3. Scale API horizontally — Redis adapter syncs Socket.IO across instances; Redis event bus fans out SSE streams
4. Use managed PostgreSQL with connection pooling (PgBouncer)
5. Redis Cluster / Sentinel for HA presence + pub/sub
6. Set `CORS_ORIGIN` to explicit client origins in production
7. Enable structured logging (pino), Sentry (`SENTRY_DSN`), and metrics (Prometheus)
8. Move uploads to object storage for multi-instance deployments (local disk today)
9. Validate production env before deploy: `npm run build -w chatapp-backend && NODE_ENV=production npm run validate:env -w chatapp-backend`

## CI/CD

- **CI**: root `npm ci`; backend, desktop, and admin lint/build via workspaces; Docker image build (repo root context) on PRs and `main`
- **CD**: publishes backend image to GHCR on `main` and version tags (`vX.Y.Z`)
  - Image: `ghcr.io/<owner>/<repo>/backend`

## License

MIT
