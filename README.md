# ChatApp — Enterprise Internal Messaging Platform

Production-oriented MVP for a Slack-like internal chat system with cross-platform desktop client, modular NestJS backend, PostgreSQL persistence, and Redis-backed real-time scaling.

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

- **Database schema**: initialized automatically from `infra/postgres/init.sql` when the `postgres` container is created.
- **Uploads**: in Docker, files are served from `/app/uploads`; `docker-compose.prod.yml` mounts a named volume there.

### Local Development (from repo root)

```bash
# One-time: copy .env files + install backend/desktop deps
npm run setup

# Optional: start Postgres + Redis only (if not using full docker compose)
npm run dev:infra

# Run backend + desktop together
npm run dev

# Or run them separately (still from root)
npm run dev:backend
npm run dev:desktop
```

## Technology Choices

| Layer | Choice | Rationale |
|-------|--------|-----------|
| Backend | **NestJS** | Modular DI, first-class WebSocket gateway, guards/pipes for security, TypeScript parity with client, Redis adapter for horizontal scaling |
| Desktop | **Electron + React** | Cross-platform (Windows/Linux), native notifications, system tray, mature ecosystem |
| Real-time | **Socket.IO + Redis adapter** | Room-based routing, automatic fallback transport, battle-tested multi-instance pub/sub |
| Database | **PostgreSQL** | ACID guarantees, BIGINT sequences for message ordering, relational membership model |
| Cache/Presence | **Redis** | Sub-millisecond presence TTL, typing indicators, Socket.IO adapter |

**Why not FastAPI?** FastAPI excels at REST/async Python workloads, but NestJS provides tighter integration between HTTP guards and WebSocket auth, plus a more opinionated module structure for multi-service decomposition.

**Why not Tauri?** Tauri is lighter than Electron; however Electron offers more mature notification/tray APIs and faster MVP delivery. Migration path to Tauri is feasible since UI is standard React.

## Project Structure

```
ChatApp/
├── package.json                # Root scripts (setup / dev / build)
├── scripts/setup-env.js        # Copies .env.example → .env
├── backend/                    # NestJS API + WebSocket gateway
│   └── src/
│       ├── modules/
│       │   ├── auth/           # JWT auth, refresh tokens
│       │   ├── users/
│       │   ├── conversations/  # Channels + DMs
│       │   ├── messages/       # Persistence, sanitization, read receipts
│       │   ├── presence/       # Redis-backed presence/typing
│       │   └── realtime/       # WebSocket gateway
│       ├── infrastructure/
│       │   ├── redis/
│       │   └── websocket/      # Redis Socket.IO adapter
│       └── common/
├── desktop/                    # Electron + React client
│   ├── electron/               # Main process, tray, notifications
│   └── src/
│       ├── components/
│       ├── context/
│       └── services/           # REST + Socket.IO clients
├── infra/postgres/init.sql     # Schema migrations (init)
├── docs/ARCHITECTURE.md        # Full system design
└── docker-compose.yml
```

## API Reference

Base URL: `http://localhost:3000/api/v1`

### Auth

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/auth/register` | Create account |
| POST | `/auth/login` | Get access + refresh tokens |
| POST | `/auth/refresh` | Rotate tokens |
| POST | `/auth/logout` | Revoke refresh token |

### Conversations & Messages

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/conversations` | List user's conversations |
| POST | `/conversations/channels` | Create channel |
| POST | `/conversations/direct` | Create/get DM |
| GET | `/conversations/:id/messages` | Paginated message history |
| POST | `/conversations/:id/messages/read` | Mark message read |

### WebSocket (`/realtime` namespace)

Connect with `auth: { token: <accessToken> }`.

| Event | Direction | Payload |
|-------|-----------|---------|
| `conversation:join` | Client → Server | `{ conversationId }` |
| `message:send` | Client → Server | `{ conversationId, content, clientMessageId? }` |
| `message:receive` | Server → Client | Message object |
| `user:typing` | Bidirectional | `{ conversationId, userId, isTyping }` |
| `user:presence` | Server → Client | `{ userId, status, lastSeen }` |
| `message:read` | Client → Server | `{ messageId }` |
| `presence:heartbeat` | Client → Server | `{}` |

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for payload examples, scaling strategy, and security details.

## Security

- JWT access tokens (15m) + rotating refresh tokens (7d, SHA-256 hashed at rest)
- WebSocket auth via handshake token verification (same JWT secret)
- `class-validator` input validation on all REST endpoints
- `sanitize-html` for XSS prevention on message content
- `@nestjs/throttler` rate limiting (stricter on auth endpoints)
- Helmet security headers
- TLS termination expected at reverse proxy (nginx/ALB) in production

## Production Deployment Notes

1. Set strong `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` (32+ chars)
2. Place API behind TLS-terminating load balancer
3. Scale API horizontally — Redis adapter syncs Socket.IO across instances
4. Use managed PostgreSQL (RDS/Cloud SQL) with connection pooling (PgBouncer)
5. Redis Cluster for HA presence + pub/sub
6. Set `CORS_ORIGIN` to desktop app origin only
7. Enable structured logging (pino) and APM (Datadog/New Relic)
8. File uploads: add S3-compatible object storage + pre-signed URLs (designed, not in MVP)

## CI/CD

- **CI**: runs backend lint/build, desktop build, and a backend Docker image build on PRs and on `main`.
- **CD**: builds and publishes the backend Docker image to GHCR on pushes to `main` and semantic version tags (`vX.Y.Z`).
  - Image name: `ghcr.io/<owner>/<repo>/backend`

## License

MIT
