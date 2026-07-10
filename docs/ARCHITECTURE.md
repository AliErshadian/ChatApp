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
│   PostgreSQL    │  │     Redis       │  │  Local uploads  │
│  users, msgs,   │  │  presence,      │  │  (/uploads —    │
│  sessions, etc. │  │  Socket.IO      │  │  S3 future)     │
│                 │  │  pub/sub        │  │                 │
└─────────────────┘  └─────────────────┘  └─────────────────┘
```

## 2. Service Boundaries (Modular Monolith → Microservices Path)

The MVP ships as a **modular monolith** with clean boundaries:

| Module | Responsibility | Future Service |
|--------|---------------|----------------|
| `auth` | Registration, login, JWT + refresh rotation, **device sessions** | Auth Service |
| `users` | Profiles, search, avatars | User Service |
| `contacts` | Contact list | Contacts Service |
| `conversations` | DMs, channels, groups, invites, membership ACL | Conversation Service |
| `messages` | Persistence, ordering, sanitization, mentions, attachments, reactions, **content search** | Messaging Service |
| `audit` | Append-only audit trail for user and admin actions | Audit Service |
| `admin` | Admin-only stats, user management, storage metrics, audit log API | Admin API |
| `presence` | Online/offline, typing (Redis + in-memory connection registry) | Presence Service |
| `realtime` | WebSocket gateway, event routing, session push events | Realtime Gateway |

Extraction path: each module owns its entities and services; split by deploying separate NestJS apps with shared contracts.

## 3. Message Delivery Event Flow

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

## 4. Session & Auth Architecture

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
3. **Access token** carries `sid`; every authenticated request checks the session is not revoked.
4. **Terminate session** revokes DB row + all refresh tokens for that family, emits `session:terminated` to `session:{id}` room, and disconnects sockets.
5. **New login** on another device emits `session:created` to other sessions (excluding the new one).

**Client storage:**

| Runtime | Access token | Refresh token | Session id |
|---------|--------------|---------------|------------|
| Electron | Renderer memory | Main process encrypted file | Stored with session |
| Browser | Memory + short-lived in memory | `localStorage` | `localStorage` + JWT `sid` |

## 5. WebSocket Scaling (Multi-Instance)

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

## 6. Horizontal Scaling Strategy

| Component | Scale Method | Notes |
|-----------|-------------|-------|
| API + WebSocket | Horizontal | Stateless; Redis adapter required |
| PostgreSQL | Vertical + read replicas | Single primary for writes |
| Redis | Cluster / Sentinel | Presence + Socket.IO pub/sub |
| File uploads | Not horizontally safe yet | Local disk; move to S3/MinIO |

## 7. Trade-offs

| Decision | Pros | Cons |
|----------|------|------|
| Modular monolith | Fast iteration, shared transactions | Requires discipline at module edges |
| Socket.IO | Rooms, Redis adapter | Heavier than raw WebSocket |
| Session in JWT (`sid`) | Fast revocation check | DB lookup per request (acceptable for MVP) |
| Electron + browser client | One React codebase | Two auth storage paths to maintain |
| SQL migration files | Simple, reviewable | Not auto-applied by ORM yet |

## 8. REST API Payload Examples

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

### Search Messages (content)

```http
GET /api/v1/messages/search?q=hello&limit=40
Authorization: Bearer eyJhbG...
```

- Minimum query length: 2 characters
- Scoped to conversations the user is a member of (excludes hidden chats/messages)
- Matches `content`, `caption`, and `file_name` via `ILIKE`
- Returns snippet, sender, conversation name/type, and timestamps

## 9. WebSocket Event Payloads

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

## 10. Database Schema Summary

```
users ─────────────┬──── conversation_members ──── conversations
                   │                                    │
                   ├──── messages ──────────────────────┘
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

- `infra/postgres/init.sql` — full schema for new databases
- `infra/postgres/migrations/*.sql` — incremental changes (apply to existing DBs)

Key indexes:

- `messages(conversation_id, sequence DESC)` — feed pagination
- `messages(conversation_id, sender_id, client_message_id)` — idempotent sends
- `audit_logs(created_at DESC)`, `audit_logs(action)` — admin audit queries
- `user_sessions(user_id)` partial where not revoked
- `refresh_tokens(user_id, session_family_id)` — session token lookup

## 11. Security Architecture

### JWT Auth Flow

```
1. Login → accessToken (15m, includes sid) + refreshToken (opaque, 7d)
2. refreshToken stored as SHA-256 hash; session metadata in user_sessions
3. REST: Authorization: Bearer; WS: auth.token on handshake
4. On 401 → POST /auth/refresh (rotates refresh token, same sessionId)
5. Logout / terminate → revoke session + refresh tokens; push session:terminated
6. validateAccessToken checks user active + session not revoked
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

## 12. Client Architecture (Desktop / Browser / Admin)

### Chat client (desktop / browser)

```
┌─────────────────────────────────────────────────────────┐
│ AuthProvider → restore session (refresh if needed)      │
│ PresenceProvider → realtime.connect(), session events   │
│ ChatPage → conversations, messages, in-app toasts     │
├─────────────────────────────────────────────────────────┤
│ api.ts          REST client, token refresh, sessions    │
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

### Admin client (`admin/`)

Separate Vite + React app (port 5174). Uses the same JWT auth; requires `users.is_admin = TRUE`.

- **Dashboard**: user/message/conversation counts, recent activity, storage breakdown
- **Users**: list with role/status filters; detail with session count, message stats
- **Audit log**: filterable paginated trail with expandable metadata

**Service URL resolution** (`endpoints.ts`): on LAN hosts, API/WS target the same hostname on port 3000 instead of hardcoded `localhost`.

## 13. Admin & Audit Architecture

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
- Upload folder sizes (`avatars`, `channel-avatars`, `message-attachments`)
- Message counts by media kind (text, image, video, etc.)

## 14. File Upload Architecture (Current)

- Multipart upload to API → stored under `uploads/` on disk
- Served at `/uploads/...` with cross-origin resource policy for avatars/attachments
- **Production gap**: not safe across multiple API instances without shared/object storage

## 15. Observability

| Component | Implementation |
|-----------|----------------|
| HTTP logging | `pino-http` with request IDs |
| Errors | Sentry (`SENTRY_DSN`); global filter reports + returns JSON errors |
| Metrics | Prometheus gauges/counters (e.g. WS connections, message sends) |
| Health | `GET /api/v1/health` |

## 16. Environment Variables

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

**Desktop / Admin (Vite):** `VITE_API_URL`, `VITE_WS_URL` override defaults when not using LAN auto-detection.

## 17. SSE Fallback (Optional, not implemented)

For WebSocket-blocked environments, an SSE endpoint could mirror Redis pub/sub events. Not included in MVP.
