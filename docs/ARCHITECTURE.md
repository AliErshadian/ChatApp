# ChatApp System Architecture

## 1. High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           CLIENT TIER                                       │
│  ┌──────────────────────┐    ┌──────────────────────┐                       │
│  │  Electron (Windows)  │    │  Electron (Linux)    │                       │
│  │  ┌────────────────┐  │    │  ┌────────────────┐  │                       │
│  │  │ React Renderer │  │    │  │ React Renderer │  │                       │
│  │  │ REST + WS      │  │    │  │ REST + WS      │  │                       │
│  │  └───────┬────────┘  │    │  └───────┬────────┘  │                       │
│  │  Main: Tray, Notify│    │  Main: Tray, Notify│                          │
│  └──────────┼──────────┘    └──────────┼──────────┘                          │
└─────────────┼──────────────────────────┼────────────────────────────────────┘
              │ HTTPS/WSS (TLS)          │
              ▼                          ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                        EDGE / LOAD BALANCER                                 │
│                   (nginx / ALB — TLS termination)                           │
│              Sticky sessions optional (Socket.IO polling fallback)            │
└──────────────────────────────┬──────────────────────────────────────────────┘
                               │
              ┌────────────────┼────────────────┐
              ▼                ▼                ▼
┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐
│   API Instance 1 │ │   API Instance 2 │ │   API Instance N │
│  ┌────────────┐  │ │  ┌────────────┐  │ │  ┌────────────┐  │
│  │ Auth Module│  │ │  │ Auth Module│  │ │  │ Auth Module│  │
│  │ Messages   │  │ │  │ Messages   │  │ │  │ Messages   │  │
│  │ Presence   │  │ │  │ Presence   │  │ │  │ Presence   │  │
│  │ Realtime GW│  │ │  │ Realtime GW│  │ │  │ Realtime GW│  │
│  └─────┬──────┘  │ │  └─────┬──────┘  │ │  └─────┬──────┘  │
└────────┼─────────┘ └────────┼─────────┘ └────────┼─────────┘
         │                    │                    │
         └────────────────────┼────────────────────┘
                              │
         ┌────────────────────┼────────────────────┐
         ▼                    ▼                    ▼
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│   PostgreSQL    │  │     Redis       │  │  Object Storage │
│  users          │  │  presence TTL   │  │  (S3 — future)  │
│  conversations  │  │  typing keys    │  │  file uploads   │
│  messages       │  │  Socket.IO      │  │                 │
│  memberships    │  │  pub/sub adapter│  │                 │
└─────────────────┘  └─────────────────┘  └─────────────────┘
```

## 2. Service Boundaries (Modular Monolith → Microservices Path)

The MVP ships as a **modular monolith** with clean boundaries that map 1:1 to future microservices:

| Module | Responsibility | Future Service |
|--------|---------------|----------------|
| `auth` | Registration, login, JWT issuance, refresh rotation | Auth Service |
| `users` | Profile lookup, search | User Service |
| `conversations` | Channel/DM lifecycle, membership ACL | Conversation Service |
| `messages` | Persistence, ordering, sanitization, read receipts | Messaging Service |
| `presence` | Online/offline, typing indicators | Presence Service |
| `realtime` | WebSocket gateway, event routing | Realtime Gateway |

Extraction path: each module already owns its entities and service layer. Split by deploying separate NestJS apps sharing protobuf/REST contracts.

## 3. Message Delivery Event Flow

```
Client A                    API Gateway              PostgreSQL        Redis           Client B
   │                            │                       │               │                │
   │── message:send ───────────►│                       │               │                │
   │   {conversationId,         │                       │               │                │
   │    content, clientMsgId}   │                       │               │                │
   │                            │── assertMember() ────►│               │                │
   │                            │◄──────────────────────│               │                │
   │                            │── INSERT message ────►│               │                │
   │                            │◄── id, sequence ──────│               │                │
   │                            │                       │               │                │
   │                            │── emit to room ───────────────────────────────────────►│
   │                            │   conversation:{id}   │               │  message:receive│
   │                            │── emit to user room ────────────────────────────────►│
   │                            │   user:{memberId}     │               │  (sidebar sync) │
   │◄── message:ack ────────────│                       │               │                │
   │   {clientMessageId, msg}   │                       │               │                │
```

### Ordering Guarantees

- Each message receives a monotonic `sequence` (PostgreSQL `GENERATED ALWAYS AS IDENTITY`)
- Per-conversation ordering is guaranteed by `sequence`
- Client-side deduplication via `clientMessageId` (idempotent sends on reconnect)
- Cross-conversation ordering is not guaranteed (not required for chat UX)

## 4. WebSocket Scaling (Multi-Instance)

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
    └─────┬──────┘  └─────┬──────┘  └─────┬──────┘
          │               │               │
       Client A        Client B        Client C
```

**How it works:**
1. `@socket.io/redis-adapter` publishes room events to Redis
2. All instances subscribe and emit to their local connected clients
3. Room membership (`conversation:{id}`, `user:{id}`) is instance-local but events propagate globally
4. Presence stored in Redis (not in-memory) so any instance can query it

**Sticky sessions:** Required only for HTTP long-polling fallback. With `transports: ['websocket']` only, sticky sessions are unnecessary.

## 5. Horizontal Scaling Strategy

| Component | Scale Method | Notes |
|-----------|-------------|-------|
| API + WebSocket | Horizontal (stateless + Redis adapter) | Add instances behind LB |
| PostgreSQL | Vertical + read replicas | Writes are single-primary; reads can fan out |
| Redis | Redis Cluster / Sentinel | Presence + pub/sub |
| Connection count | ~10K connections/instance | Tune ulimit, use dedicated realtime nodes |

**Future optimizations:**
- Separate realtime nodes from REST nodes (different k8s deployments)
- Message write-behind queue (Kafka/NATS) for burst traffic
- CQRS: message feed served from read-optimized projection

## 6. Trade-offs

| Decision | Pros | Cons |
|----------|------|------|
| Modular monolith vs microservices | Faster MVP, simpler ops, shared transactions | Must enforce module boundaries via code review |
| Socket.IO vs raw WebSocket | Rooms, fallback transport, Redis adapter | Heavier protocol than raw WS |
| PostgreSQL sequences vs Snowflake IDs | Simple, DB-enforced ordering | Write throughput ceiling on single primary |
| Electron vs Tauri | Mature desktop APIs, faster delivery | Larger binary, higher memory |
| JWT access tokens | Stateless verification, fast WS auth | Cannot revoke mid-flight (mitigated by short TTL) |
| Redis presence vs DB | Sub-ms reads, auto-expiry | Eventually consistent across reconnects |

## 7. REST API Payload Examples

### Register

```http
POST /api/v1/auth/register
Content-Type: application/json

{
  "email": "alice@company.com",
  "username": "alice",
  "displayName": "Alice Smith",
  "password": "securepass123"
}
```

```json
{
  "user": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "email": "alice@company.com",
    "username": "alice",
    "displayName": "Alice Smith"
  },
  "accessToken": "eyJhbG...",
  "refreshToken": "a1b2c3...",
  "expiresIn": 900
}
```

### Create Channel

```http
POST /api/v1/conversations/channels
Authorization: Bearer eyJhbG...
Content-Type: application/json

{
  "name": "engineering",
  "description": "Engineering team channel",
  "memberIds": ["550e8400-e29b-41d4-a716-446655440001"]
}
```

### List Messages (cursor pagination)

```http
GET /api/v1/conversations/{id}/messages?cursor=1042&limit=50
Authorization: Bearer eyJhbG...
```

```json
{
  "messages": [
    {
      "id": "msg-uuid",
      "conversationId": "conv-uuid",
      "senderId": "user-uuid",
      "content": "Hello team!",
      "contentType": "text/plain",
      "sequence": "1043",
      "createdAt": "2026-07-03T10:30:00.000Z",
      "sender": {
        "id": "user-uuid",
        "displayName": "Alice Smith",
        "username": "alice"
      }
    }
  ],
  "nextCursor": "993"
}
```

## 8. WebSocket Event Payloads

### `message:send` (Client → Server)

```json
{
  "conversationId": "550e8400-e29b-41d4-a716-446655440010",
  "content": "Hey, are you available for a quick sync?",
  "clientMessageId": "client-generated-uuid-for-dedup"
}
```

### `message:receive` (Server → Client)

```json
{
  "id": "msg-uuid",
  "conversationId": "550e8400-e29b-41d4-a716-446655440010",
  "senderId": "user-uuid",
  "content": "Hey, are you available for a quick sync?",
  "contentType": "text/plain",
  "clientMessageId": "client-generated-uuid-for-dedup",
  "sequence": "1044",
  "createdAt": "2026-07-03T10:30:05.000Z",
  "sender": {
    "id": "user-uuid",
    "displayName": "Bob Jones",
    "username": "bob"
  }
}
```

### `user:typing` (Bidirectional)

```json
{
  "conversationId": "550e8400-e29b-41d4-a716-446655440010",
  "userId": "user-uuid",
  "isTyping": true
}
```

### `user:presence` (Server → Client)

```json
{
  "userId": "user-uuid",
  "status": "online",
  "lastSeen": "2026-07-03T10:29:00.000Z"
}
```

## 9. Database Schema Summary

```
users ─────────────┬──── conversation_members ──── conversations
                   │                                    │
                   ├──── messages ──────────────────────┘
                   │         │
                   │    message_read_receipts
                   │
                   └──── refresh_tokens

direct_conversation_pairs ── conversations (DM uniqueness)
```

Key indexes:
- `messages(conversation_id, sequence DESC)` — feed pagination
- `messages(conversation_id, sender_id, client_message_id)` — idempotent sends
- `conversation_members(conversation_id, user_id)` UNIQUE — membership ACL

## 10. Security Architecture

### JWT Auth Flow

```
1. Login → Server issues accessToken (15m) + refreshToken (7d, opaque)
2. refreshToken stored as SHA-256 hash in DB
3. Client sends accessToken in Authorization header (REST) and auth.token (WS)
4. On 401 → client calls /auth/refresh with refreshToken
5. Server rotates refresh token (old one revoked)
6. Logout → refresh token revoked in DB
```

### Secure WebSocket Handshake

- Token verified in `handleConnection` before any event subscription
- Unauthenticated connections disconnected immediately
- `WsJwtGuard` on all message handlers
- Conversation membership checked before join/send

### Rate Limiting

| Endpoint | Limit |
|----------|-------|
| Global | 100 req/min per IP |
| `/auth/register` | 5 req/min |
| `/auth/login` | 10 req/min |
| WS `message:send` | Future: per-user token bucket in Redis |

### Message Sanitization

All message content passes through `sanitize-html` with zero allowed tags (escape mode) to prevent stored XSS.

## 11. File Upload Architecture (Design Only)

```
Client                    API                     S3/MinIO
  │                        │                        │
  │── POST /uploads/sign ─►│                        │
  │                        │── Generate pre-signed ►│
  │◄── { uploadUrl, key } ─│                        │
  │                        │                        │
  │── PUT file ────────────────────────────────────►│
  │                        │                        │
  │── message:send ───────►│                        │
  │   { contentType:       │                        │
  │     "image/png",       │                        │
  │     attachmentKey }    │                        │
```

- Max file size enforced at pre-sign time
- Virus scanning via ClamAV sidecar (async)
- CDN in front of object storage for delivery
- Not implemented in MVP

## 12. SSE Fallback (Optional)

For environments blocking WebSocket:

```
GET /api/v1/conversations/{id}/events
Authorization: Bearer ...
Accept: text/event-stream

event: message
data: {"id":"...","content":"..."}

event: typing
data: {"userId":"...","isTyping":true}
```

Implementation: Redis pub/sub listener per connection, same event schema as WebSocket. Not included in MVP but trivially addable as a parallel gateway module.

## 13. Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | required |
| `REDIS_URL` | Redis connection string | required |
| `JWT_ACCESS_SECRET` | Access token signing key | required |
| `JWT_REFRESH_SECRET` | Refresh token signing key | required |
| `JWT_ACCESS_EXPIRES_IN` | Access token TTL | `15m` |
| `JWT_REFRESH_EXPIRES_IN` | Refresh token TTL | `7d` |
| `CORS_ORIGIN` | Allowed origin | `*` |
| `RATE_LIMIT_TTL` | Rate limit window (seconds) | `60` |
| `RATE_LIMIT_MAX` | Max requests per window | `100` |
| `PORT` | API listen port | `3000` |
