FROM node:20-alpine

WORKDIR /app

COPY backend/package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY backend/scripts/migrate.mjs ./scripts/migrate.mjs
COPY infra/postgres/migrations ./migrations

ENV MIGRATIONS_DIR=/app/migrations

USER node

CMD ["node", "scripts/migrate.mjs"]
