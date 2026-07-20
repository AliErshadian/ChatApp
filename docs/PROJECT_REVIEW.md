# RELAY — Project Review

**Date:** 2026-07-20 · Snapshot of the codebase: strengths, gaps, and a prioritized roadmap.

Companion: [ARCHITECTURE.md](./ARCHITECTURE.md) (system design) · [README.md](../README.md) (quick start)

---

## Contents

1. [Overview](#1-overview)
2. [What’s implemented](#2-whats-implemented)
3. [Strengths](#3-strengths)
4. [Risks & gaps](#4-risks--gaps)
5. [Recently shipped](#5-recently-shipped)
6. [Roadmap](#6-roadmap)
7. [Production readiness](#7-production-readiness)
8. [Related docs](#8-related-docs)

---

## 1. Overview

| | |
|--|--|
| **Product** | Internal Slack-style chat for teams |
| **API** | NestJS — REST + Socket.IO + SSE fallback |
| **Data** | PostgreSQL · Redis · MinIO (S3) |
| **Auth** | Local email/password **and** optional Active Directory (LDAP) |
| **Clients** | Electron desktop · browser (same React app) · admin dashboard (`:5174`) |
| **Repo** | npm workspaces monorepo (`relay-backend`, `relay-desktop`, `relay-admin`) |
| **Infra** | Docker Compose (dev + prod-like with nginx) |

```
RELAY/
├── backend/          # NestJS API + realtime
├── desktop/          # Electron + React chat client
├── admin/            # Admin dashboard (Vite)
├── infra/            # Postgres init/migrations · nginx · migrate image
├── docs/             # Architecture + this review
├── docker-compose.yml
├── docker-compose.prod.yml
└── .github/workflows/
```

---

## 2. What’s implemented

### Platform

| Area | Status |
|------|--------|
| Messaging | DMs, channels, groups · edit/delete · forwards · reactions · mentions · FTS search |
| Threads | Slack-style roots + side panel · unread thread bar · first-unread scroll |
| Polls | Groups only · tap-to-vote · anonymous / multi · sender closes |
| Media | MinIO uploads · API content proxy · IndexedDB offline cache · per-chat file browser |
| Calls | 1:1 DM voice/video (WebRTC) · history · missed badge · **WebSocket required** |
| Tasks | Assign with accept/reject · pending badge · realtime |
| Notes | Shared notes · roles · revision history + diff · realtime |
| Stories | 24h contact audience · likes · reply → DM quote · realtime |
| Sessions | Device list · remote logout · Redis session cache |
| Admin | Stats · users · storage · audit · **Authentication** (AD/LDAP) |
| Realtime | Socket.IO + Redis adapter · automatic SSE + REST fallback |

### Auth & directory

- Provider pattern: `LocalAuthProvider` + `ActiveDirectoryAuthProvider` → same JWT/session path
- Access JWT (15m, `sid`) · rotating refresh (7d, hashed) · `user_sessions`
- AD: hot-reload config · encrypted bind password · provision/sync · group mappings · auth audit
- Login CAPTCHA after N failed attempts (math challenge; optional Turnstile)
- Desktop: Local / AD toggle when AD is enabled

### Security (current baseline)

| Control | Notes |
|---------|-------|
| Tokens | bcrypt · hashed refresh · session revoke kills REST/WS/SSE |
| CSP | Helmet API · Vite meta (prod) · Electron headers · nginx |
| CSRF | Not required (Bearer + JSON refresh, no auth cookies) |
| WebSocket | JWT on connect · `WsJwtGuard` · membership checks · rate limits · hard disconnect on revoke |
| Uploads | Extension blocklist · double-extension reject · magic-byte sniff · optional ClamAV |
| Secrets | Env vars · `.env` gitignored · Zod prod validation · `generate:secrets` / `validate:env` / `check:secrets` |
| Messages | `sanitize-html` · server-side mentions |

### Clients

**Desktop / browser** — Electron secure store + tray; Vite HTTPS LAN; threads, polls, files, calls, tasks, notes, stories, search (`Ctrl/Cmd+K`), devices, offline cache.

**Admin** — Dashboard, users, Authentication (LDAP), audit log; media via same content proxy.

### Ops

- Migrations `002`–`034` + `init.sql` · `npm run migrate` · CI schema-drift check
- Observability: pino · Sentry · Prometheus · `GET /health`
- CI: lint + build (all workspaces) · CD: backend Docker image

---

## 3. Strengths

- **Modular Nest boundaries** — clear path toward service extraction
- **One auth pipeline** for local + AD (and future IdPs)
- **Realtime resilience** — Socket.IO preferred, SSE+REST when WS is blocked
- **Security above typical MVP** — sessions, CSP, CAPTCHA, upload scanning, WS guards
- **LAN-friendly media** — clients never need MinIO ports; JWT content proxy
- **Feature depth** — threads, polls, calls, tasks, notes, stories without forking the core model
- **Dev ergonomics** — workspaces, `dev:all`, Compose, CI from one lockfile
- **Admin + audit** — operational visibility and Authentication settings without code deploys for AD toggles

---

## 4. Risks & gaps

### Security & config

| Risk | Mitigation |
|------|------------|
| CORS `*` in dev | Set explicit `CORS_ORIGIN` in production |
| Weak Compose defaults (`minioadmin`, `relay_secret`) | Override in prod; Zod rejects weak DB password / JWT |
| No cloud Secret Manager | Use orchestrator / vault secrets injected as env |
| AD misconfig can lock out AD-only users | Keep Local enabled during rollout; set `DIRECTORY_ENCRYPTION_KEY` |
| Routine dependency CVEs | `npm audit` / Dependabot |

### Correctness & scale

| Risk | Notes |
|------|-------|
| **No automated tests** | Auth, ACL, messaging, sessions, storage, calls, LDAP untested in CI |
| Call registry in-memory | Breaks across multi-instance API; needs Redis for HA calls |
| TURN not bundled | Some NAT/firewall setups need coturn (or similar) |
| Gateway fanout | Some paths still emit per-member; watch large channels |

---

## 5. Recently shipped

Grouped (2026-07); see git history for commit-level detail.

| Theme | Highlights |
|-------|------------|
| **Directory auth** | Migration `034` · LDAP module · admin Authentication UI · multi-provider desktop login |
| **Security hardening** | CSP · CSRF documented · login CAPTCHA · file scan · WS rate limits + room kick · secrets tooling |
| **Stories** | Feed · compose · viewer · likes · reply→DM · realtime |
| **Notes & tasks** | Sharing roles · history diff · assignment acceptance · badges · realtime |
| **Calls** | Voice + video · history · missed badge · 15s ring timeout · HTTPS LAN for media |
| **Threads & polls** | Side panel · unread bar · group polls with live tallies |
| **Storage** | MinIO · content proxy · file browser · offline IndexedDB cache |
| **Realtime** | SSE fallback · Redis session cache |
| **Platform** | npm workspaces · admin app · audit log · FTS search · migration runner + drift CI |

---

## 6. Roadmap

### P0 — before real production

- [ ] **Automated tests** — auth/refresh, membership ACL, send/edit/delete, session revoke, task accept, note ACL, **mocked AD login**
- [ ] **Explicit production CORS** (no `*`)
- [ ] Strong secrets in deploy (no Compose defaults for JWT / DB / MinIO)

### P1 — high value next

- [ ] OpenAPI for REST + formal realtime event catalog
- [ ] Signed desktop release pipeline (Windows / Linux)
- [ ] Azure AD / OIDC via the same provider interface
- [ ] Optional Secret Manager / Docker-K8s secrets wiring

### P2 — polish & scale

- [ ] Room-only fanout audit (drop leftover per-member loops)
- [ ] coturn (or managed TURN) in Compose
- [ ] Redis-backed call registry for multi-instance signaling
- [ ] LDAP pooling / stricter StartTLS cert pinning
- [ ] Content-based secret scanning in CI (e.g. gitleaks)

---

## 7. Production readiness

| Item | Status |
|------|--------|
| CI lint + build (backend · desktop · admin) | Done |
| CI automated tests | **Missing** |
| Production env validation (Zod) | Done |
| CD publishes backend image | Done |
| Migrations in deploy (`migrate` job) | Done |
| WebSocket allowlist + websocket-only | Done |
| SSE fallback | Done |
| Session revoke + Electron secure store | Done |
| CSP / upload scan / login CAPTCHA | Done |
| Object storage + API content proxy | Done |
| Basic observability (logs · Sentry · health) | Done |
| Explicit prod CORS (no `*`) | **Todo** |
| HA voice/video (Redis registry + TURN) | **Todo** |

---

## 8. Related docs

| Doc | Use for |
|-----|---------|
| [README.md](../README.md) | Quick start, AD setup, API summary, security notes |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | Diagrams, modules, auth, realtime, schema, env reference |
| `backend/.env.example` | Full env defaults (storage, WebRTC, CAPTCHA, ClamAV, directory) |

Key env groups: `JWT_*`, `DATABASE_URL`, `REDIS_URL`, `S3_*`, `WEBRTC_*` / `TURN_*`, `DIRECTORY_ENCRYPTION_KEY`, `LOGIN_FAIL_CAPTCHA_*`, `TURNSTILE_*`, `FILE_SCAN_CLAMAV_*`, `SENTRY_*`, `LOG_LEVEL`.
