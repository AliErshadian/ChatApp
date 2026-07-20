FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json ./
COPY backend/package.json backend/
RUN npm ci -w relay-backend --omit=dev && npm cache clean --force

COPY backend/scripts/migrate.mjs backend/scripts/migrate.mjs
COPY infra/postgres/migrations infra/postgres/migrations

ENV MIGRATIONS_DIR=/app/infra/postgres/migrations

USER node
WORKDIR /app/backend

CMD ["node", "scripts/migrate.mjs"]
