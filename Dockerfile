# ═══════════════════════════════════════════════════════
# Pin Desk — Production Dockerfile (Next.js App)
# Uses Node.js for stable builds (Bun crashes on some VPS CPUs)
# ═══════════════════════════════════════════════════════

# ---- Stage 1: Dependencies ----
FROM node:20-alpine AS deps
WORKDIR /app

COPY package.json package-lock.json* ./
# Force install ALL dependencies (including devDependencies) for build.
# Coolify sets NODE_ENV=production at build time, which makes npm skip devDeps.
# We need devDeps (@tailwindcss/postcss, typescript, eslint) during build.
ENV NODE_ENV=development
RUN if [ -f package-lock.json ]; then npm ci --include=dev; else npm install --include=dev; fi

# ---- Stage 2: Build ----
FROM node:20-alpine AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Generate Prisma client
RUN npx prisma generate

# Build Next.js (standalone output)
# Set a dummy DATABASE_URL so Prisma doesn't crash during static page generation
# (this is never actually connected to at build time, just needs to be a
# syntactically valid Postgres URL for the Prisma client constructor).
ENV NEXT_TELEMETRY_DISABLED=1
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build"
# Next.js build needs NODE_ENV=production for optimizations, but node_modules
# are already installed (with devDeps) in the deps stage above.
ENV NODE_ENV=production
RUN npm run build

# ---- Stage 3: Production ----
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# Cap the V8 old-space heap below the container's memory limit so V8 GCs
# under pressure instead of the kernel OOM-killer taking the process down
# mid-request. Tune together with the `app` service memory limit
# (384 MB heap inside 640 MB works for 50k-row CSV imports).
ENV NODE_OPTIONS="--max-old-space-size=384"

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Copy standalone output
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./

# Copy static assets
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Copy public folder
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

# Copy Prisma schema (needed for db push at runtime)
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma

# Copy seed script (for runtime seeding)
COPY --from=builder --chown=nextjs:nodejs /app/prisma/seed.ts ./prisma/seed.ts

# Copy node_modules for prisma CLI + tsx + seed deps at runtime
COPY --from=builder --chown=nextjs:nodejs /app/node_modules ./node_modules

# Copy runtime entrypoint script
COPY --from=builder --chown=nextjs:nodejs /app/entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh

# The pin-publishing worker is NOT in this image — it runs as its own
# container/service (docker-compose.yml `worker`, built from Dockerfile.worker).
# Keeping it out avoids accidentally running a second publisher/dispatcher
# alongside the dedicated worker service.

# Copy package.json (needed for npx tsx to resolve)
COPY --from=builder --chown=nextjs:nodejs /app/package.json ./package.json

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Runtime entrypoint: db push → seed (if needed) → start server + worker
CMD ["sh", "./entrypoint.sh"]
