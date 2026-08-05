# syntax=docker/dockerfile:1.7

# ---- base ----
FROM node:22-alpine AS base
RUN apk add --no-cache libc6-compat
ENV NEXT_TELEMETRY_DISABLED=1
RUN corepack enable && corepack prepare pnpm@10.30.3 --activate
WORKDIR /app

# ---- deps ----
# Install with --ignore-scripts: the `prepare` script (effect-language-service
# patch) is editor tooling, not needed to build or run.
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --ignore-scripts

# ---- builder ----
FROM base AS builder
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm build

# ---- runner ----
FROM node:22-alpine AS runner
RUN apk add --no-cache libc6-compat
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
WORKDIR /app
RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001
# Standalone server + static assets + public. The standalone output already
# bundles a traced node_modules, so no full dependency install is needed here.
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
# Bind-mount target for config/knowhere-keys.json (see AGENTS.md). Created
# up front so `-v ...:/app/config/knowhere-keys.json:ro` works without a
# rebuild, and owned by the non-root nextjs user for the fallback file.
RUN mkdir -p /app/config && chown nextjs:nodejs /app/config
USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
