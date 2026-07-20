FROM node:20-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
COPY backend/package.json backend/
RUN npm ci -w relay-backend

COPY backend ./backend
WORKDIR /app/backend
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# Create an unprivileged user for runtime
RUN addgroup -S nodejs && adduser -S nodeuser -G nodejs

COPY package.json package-lock.json ./
COPY backend/package.json backend/
RUN npm ci -w relay-backend --omit=dev && npm cache clean --force

COPY --from=builder /app/backend/dist ./dist

# If you rely on static uploads, mount a volume at /app/uploads in production
RUN mkdir -p /app/uploads && chown -R nodeuser:nodejs /app

USER nodeuser
EXPOSE 3000

# Basic container-level healthcheck (expects your app to expose /api/v1/health)
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+ (process.env.PORT||3000) +'/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/main.js"]
