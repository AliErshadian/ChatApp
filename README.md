# ChatApp — Enterprise Internal Messaging

Slack-style internal chat for teams: Electron desktop, browser client, admin dashboard, NestJS API, PostgreSQL, Redis, and MinIO object storage.

Monorepo via **npm workspaces** (`backend`, `desktop`, `admin`).

## Contents

- [Features](#features)
- [Stack](#stack)
- [Quick start](#quick-start)
- [Local development](#local-development)
- [Admin dashboard](#admin-dashboard)
- [Active Directory (LDAP)](#active-directory-ldap)
- [Project structure](#project-structure)
- [API reference](#api-reference)
- [Realtime](#realtime)
- [Security](#security)
- [Object storage](#object-storage)
- [Production](#production)
- [CI/CD](#cicd)
- [Docs](#docs)
- [License](#license)

## Features

| Area | Highlights |
|------|------------|
| Messaging | DMs, channels, groups; edit/delete; threads; polls; mentions; reactions; forwards; FTS search |
| Media | Attachments via MinIO; API content proxy; IndexedDB offline cache |
| Calls | 1:1 DM voice/video (WebRTC); history; missed badge; WebSocket required |
| Work | Tasks (assignment accept/reject); shared notes with roles & history |
| Stories | 24h photo/video for contacts; likes; reply → DM quote |
| Auth | Local email/password **and** optional Active Directory (LDAP); device sessions; remote logout |
| Admin | Stats, users, storage, audit log, Authentication settings |
| Realtime | Socket.IO (+ Redis); automatic SSE + REST fallback when WS is blocked |

## Stack

| Layer | Choice |
|-------|--------|
| API | NestJS (REST + Socket.IO) |
| Desktop | Electron + React (Vite) |
| Admin / web | Vite + React |
| DB | PostgreSQL |
| Cache / fanout | Redis |
| Files | MinIO (S3-compatible; AWS S3 via env) |

## Quick start

### Docker Compose

```bash
cp .env.example .env
docker compose up --build -d
curl http://localhost:3000/api/v1/health
```

Production-like (nginx + TLS edge):

```bash
cp .env.example .env   # set strong JWT_* secrets (32+ chars)
docker compose -f docker-compose.prod.yml up --build -d
curl http://localhost/api/v1/health
```

**Schema:** new Postgres volumes load `infra/postgres/init.sql`. Incremental SQL in `infra/postgres/migrations/` is applied by `npm run migrate` (or the Compose `migrate` service). After editing migrations or `init.sql`, run `npm run check:schema-drift`.

**MinIO:** console at http://127.0.0.1:9001 (`minioadmin` / `minioadmin`). Clients never talk to MinIO directly — media goes through `GET /attachments/:id/content` with JWT.

## Local development

```bash
npm run setup          # copy .env files + install workspaces
npm run dev:infra      # Postgres + Redis + MinIO (optional)
npm run dev            # backend + Electron desktop
npm run dev:all        # backend + desktop + admin
npm run dev:backend
npm run dev:desktop
npm run dev:admin      # http://localhost:5174
npm run migrate
```

### Browser client (no Electron)

1. `npm run dev:backend` then `npm run dev:desktop`
2. Open `https://localhost:5173` (self-signed cert — accept the warning)
3. On LAN: `https://<LAN-IP>:5173` (**https** required for mic/camera). Vite proxies `/api` and `/socket.io` to port 3000.

### MinIO without Docker (Windows)

```powershell
mkdir C:\minio-data
.\minio.exe server C:\minio-data --console-address ":9001"
```

Set `S3_ENDPOINT=127.0.0.1` in `backend/.env`. Buckets are created on first upload (or in the console).

## Admin dashboard

Port **5174**. Same JWT API; routes under `/api/v1/admin/*` require `is_admin`.

```bash
npm run migrate
```

```sql
UPDATE users SET is_admin = TRUE WHERE email = 'your@email.com';
```

```bash
npm run dev:backend
npm run dev:admin
```

Open http://localhost:5174. Pages: **Dashboard**, **Users**, **Authentication**, **Audit log**.

## Active Directory (LDAP)

Optional Windows AD login beside local auth. Toggle providers in admin — **no API restart**. Successful AD login issues the **same JWT + refresh token** as local login (Socket.IO unchanged). AD passwords are never stored locally.

```
Login → Authentication Manager → Local (Postgres) or AD (LDAP) → JWT + refresh
```

Future IdPs (Azure AD, OAuth, …) plug in as additional providers without changing the login flow.

### Setup

1. Migrate:

```bash
npm run migrate
```

2. Encrypt bind passwords at rest (recommended). In `backend/.env`:

```bash
# node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
DIRECTORY_ENCRYPTION_KEY=<64-char hex>
```

Restart the backend after changing `.env`.

3. Admin → **Authentication**:

| Tab | Action |
|-----|--------|
| **Providers** | Enable AD (keep Local on while testing). Default provider, auto-create users, sync & policy flags. Save. |
| **LDAP / AD** | Host, port, TLS (**LDAPS** preferred), domain, Base DN, Bind DN/password, filters. Save → **Test Connection**. Optional Preview Users/Groups. |
| **Group mapping** | Map AD groups → System Admin / allow-login / approved security group. |
| **Synchronization** | Manual / hourly / daily / weekly; run Manual Sync as needed. |
| **Failed logins** | Auth audit events. |

4. Desktop login shows **Local** / **Active Directory** when AD is enabled. Sign in with username, `DOMAIN\user`, or UPN.

**LDAP field examples:** host `dc01.corp.local`, port `636`, Base DN `DC=corp,DC=local`, Bind DN = read-only service account. Leave Bind Password blank on later saves to keep the stored secret. Keep Local enabled until AD is verified so you do not lock yourself out.

Migration: `034_directory_auth.sql`.

## Project structure

```
ChatApp/
├── package.json              # workspaces root
├── backend/                  # NestJS API + WebSocket
│   └── src/modules/          # auth, directory, users, messages, calls, tasks, notes, stories, admin, …
│       storage/              # MinIO / S3
│       infrastructure/       # Redis, Socket.IO adapter
│       observability/        # Pino, Sentry, Prometheus
├── desktop/                  # Electron + React chat client
├── admin/                    # Admin UI (Vite, :5174)
├── infra/postgres/           # init.sql + migrations/
├── docs/                     # ARCHITECTURE.md, PROJECT_REVIEW.md
└── docker-compose.yml
```

## API reference

Base URL: `http://localhost:3000/api/v1`

### Auth

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/auth/providers` | Enabled providers + default (public; for login UI) |
| POST | `/auth/register` | Local register (+ optional `clientInfo`) |
| POST | `/auth/login` | Login: `provider` (`local` \| `active_directory`), `email` or `username`, `password` |
| POST | `/auth/login/local` | Legacy local-only login |
| POST | `/auth/refresh` | Rotate tokens (same session) |
| POST | `/auth/logout` | Revoke refresh + session |
| GET | `/auth/sessions` | List devices |
| DELETE | `/auth/sessions/:sessionId` | Terminate session |
| DELETE | `/auth/sessions/others?except=:sessionId` | Terminate other sessions |

AD login example:

```http
POST /api/v1/auth/login
Content-Type: application/json

{
  "provider": "active_directory",
  "username": "jsmith",
  "password": "...",
  "clientInfo": { "clientType": "electron", "deviceLabel": "ChatApp, Windows" }
}
```

Access tokens include `sid`. Refresh tokens are SHA-256 hashed and tied to `user_sessions`.

### Admin (`is_admin`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/admin/me` | Admin profile |
| GET | `/admin/stats` | Platform stats |
| GET | `/admin/storage` | DB + MinIO breakdown |
| GET | `/admin/users` | Paginated users |
| GET / PATCH | `/admin/users/:id` | Detail / `isActive`, `isAdmin` |
| GET / DELETE | `/admin/users/:id/sessions…` | Force logout |
| GET | `/admin/audit-logs` | Audit trail |
| GET / PUT | `/admin/settings/authentication` | Providers + LDAP (hot reload) |
| * | `/admin/settings/authentication/*` | Health, test, preview, sync, mappings, auth audit |

### Conversations & messages

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/conversations` | List (pins, unread, last message) |
| POST | `/conversations/channels` \| `/groups` \| `/direct` | Create |
| GET/POST | `/conversations/:id/messages` | History (roots) / send (REST; prefer WS) |
| GET | `/conversations/:id/messages/unread-threads` | Threads with unread replies |
| GET | `/conversations/:id/messages/:messageId/thread` | Thread + `firstUnreadMessageId` |
| GET | `/conversations/:id/messages/:messageId/thread/search` | Search in thread |
| GET | `/conversations/:id/attachments` | Shared files (`kind`, cursor) |
| POST | `/conversations/:id/messages/attachment` | Upload (MinIO) |
| POST | `/conversations/:id/polls` … `/vote` … `/close` | Group polls |
| PATCH/DELETE | `/conversations/:id/messages/:messageId` | Edit / delete |
| GET | `/messages/search` | Full-text (`q`, min 2 chars) |
| POST | `/conversations/:id/messages/:messageId/reactions` | Toggle reaction |
| POST | `/contacts` | Add contact |
| GET | `/users/search` | User search |

### Calls (1:1 DM, WebSocket signaling)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/calls/ice-servers` | STUN/TURN |
| GET | `/calls/history` | History + filters |
| GET | `/calls/missed/unseen-count` | Badge |
| POST | `/calls/missed/seen` | Clear badge |

Unanswered rings end after **15s** (Missed for callee, Cancelled for caller).

### Tasks

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/tasks` | List (`status`, optional `conversationId`) |
| GET / POST | `/tasks/pending/unseen-count` \| `/seen` | Badge |
| POST | `/tasks` \| `/from-message` | Create |
| POST | `/tasks/:id/assign` \| `/accept` \| `/reject` \| `/cancel-assignment` | Assignment |
| PATCH / DELETE | `/tasks/:id` | Update / delete (creator) |

External assign → pending invite until Accept.

### Notes

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET / POST | `/notes` | List (`scope`) / create |
| GET / PATCH / DELETE | `/notes/:id` | CRUD (`version` concurrency) |
| GET / DELETE | `/notes/:id/history` | Revisions / clear (owner) |
| GET / POST / PATCH / DELETE | `/notes/:id/members…` | Share (reader / contributor) |

### Stories

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/stories/feed` | Rings |
| GET | `/stories/user/:userId` | User stories |
| POST | `/stories` | Create (multipart) |
| POST | `/stories/:id/view` \| `/like` \| `/reply` | View / like / reply→DM |
| GET | `/stories/:id/viewers` | Owner only |
| DELETE | `/stories/:id` \| `/like` | Delete / unlike |

Audience: author's contacts (+ self); 24h expiry.

### Attachments

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/attachments/upload` | Upload |
| GET | `/attachments/:id` | Metadata |
| GET | `/attachments/:id/content` | Stream (JWT; used by clients) |
| GET | `/attachments/:id/download` | Presigned URL (optional) |
| DELETE | `/attachments/:id` | Delete |

More endpoints (invites, avatars, pins, …) live under `backend/src/modules/`.

## Realtime

### WebSocket — `/realtime` (preferred)

Connect with `auth: { token: <accessToken> }`. Rooms: `user:{id}`, `session:{sid}`.

| Events (examples) | Role |
|-------------------|------|
| `message:send` / `receive` / `ack` / `updated` / `status` / `reaction` | Chat |
| `conversation:*`, `user:typing`, `user:presence` | Sidebar / presence |
| `session:created` / `terminated` | Multi-device |
| `call:*` | Voice/video signaling |
| `task:*`, `note:*`, `story:*` | Work / stories |

### SSE fallback

If WebSocket fails, the client uses `GET /realtime/stream?access_token=<JWT>` plus REST under `/realtime/*`. Text chat works; **calls require WebSocket**.

Details: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Security

- **Content Security Policy (CSP)**
  - API: Helmet deny-by-default CSP (`backend/src/config/csp.ts`)
  - Desktop / admin production builds: CSP meta injected by Vite
  - Electron (packaged): CSP response header on all navigations
  - Prod nginx: CSP + `X-Frame-Options` / `nosniff` / `Referrer-Policy`
  - Dev Vite skips CSP so HMR / Fast Refresh keep working
- **CSRF**: not required with the current token model — access tokens go only in the `Authorization: Bearer` header; refresh tokens are sent in the JSON body (`POST /auth/refresh`), never in cookies. Browsers do not auto-attach those on cross-site requests, so classic cookie CSRF does not apply. If refresh tokens are later moved to `HttpOnly` cookies, add CSRF protection (e.g. double-submit token) at that time.
- **WebSocket (`/realtime`)**
  - JWT verified on connect (`handshake.auth.token`); session must be active
  - `WsJwtGuard` re-checks session on every event; revoked sessions disconnect immediately
  - Sensitive events re-assert conversation membership / call participation
  - Removed members are forced out of `conversation:{id}` rooms
  - Per-user Redis token-bucket rate limits on all mutating / signaling events
  - Session revoke → `session:terminated` + hard `disconnectSockets`
- **Login CAPTCHA**: after N failed attempts (default 3), CAPTCHA is required — built-in math challenge, or Cloudflare Turnstile when `TURNSTILE_*` keys are set
- Provider auth: local and optional AD; AD passwords never stored
- LDAP bind password encrypted (`DIRECTORY_ENCRYPTION_KEY`)
- Session revoke kills REST, WS, and SSE immediately
- JWT access (15m, `sid`) + rotating refresh (7d, hashed)
- DTO validation, HTML sanitize, Helmet, CORS allowlist, throttling (stricter on auth)
- **File scanning (uploads)**
  - Dangerous extensions blocked (`.exe`, scripts, `.html`, `.svg`, …)
  - Double-extension names rejected (`photo.jpg.exe`, `invoice.pdf.js`)
  - Magic-byte sniffing: content must match the final extension and declared MIME
  - Optional ClamAV: `FILE_SCAN_CLAMAV_ENABLED=true` + `FILE_SCAN_CLAMAV_HOST` / `PORT`
  - Size limits per category; downloads via authenticated API proxy
- Production: terminate TLS at the reverse proxy

## Object storage

Postgres holds **metadata only** (`attachments`). Blobs in MinIO:

| Bucket | Use |
|--------|-----|
| `avatars` | Profile / conversation avatars |
| `attachments` | Images |
| `videos` / `voice` / `documents` | Media / files |
| `backups` | Reserved |

Configure `S3_*` in `backend/.env`. Switch to AWS S3 with env only (`S3StorageProvider`, path-style).

## Production

1. Strong `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` (32+ chars)
2. `DIRECTORY_ENCRYPTION_KEY` if AD is enabled
3. TLS-terminating load balancer; explicit `CORS_ORIGIN` (no `*`)
4. Horizontal API scale with Redis (Socket.IO adapter + event bus)
5. Managed Postgres (+ pooling) and Redis HA
6. Shared MinIO/S3 across instances
7. Logging (pino), Sentry, Prometheus
8. Validate: `npm run build -w chatapp-backend && NODE_ENV=production npm run validate:env -w chatapp-backend`

## CI/CD

- **CI:** root `npm ci`; lint/build all workspaces; Docker image from repo root on PRs/`main`
- **CD:** backend image to GHCR on `main` and tags `vX.Y.Z` → `ghcr.io/<owner>/<repo>/backend`

## Docs

| Doc | Contents |
|-----|----------|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | System design, auth providers, sessions, events, schema |
| [docs/PROJECT_REVIEW.md](docs/PROJECT_REVIEW.md) | Strengths, risks, roadmap |

## License

MIT
