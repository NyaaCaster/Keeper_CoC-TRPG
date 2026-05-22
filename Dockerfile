# syntax=docker/dockerfile:1.7

# ---------- Stage 1: deps ----------
# Install the full dependency tree (including devDependencies) so that
# Vite + esbuild + the React toolchain are available for the build stage.
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# ---------- Stage 2: build ----------
# Produce both the Vite frontend bundle and the esbuild-bundled CJS server
# into ./dist (frontend assets next to dist/server.cjs).
FROM node:20-alpine AS builder
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json tsconfig.json vite.config.ts index.html ./
COPY src ./src
COPY server.ts ./
RUN npm run build

# ---------- Stage 3: runtime ----------
# Start from a clean alpine + node base, install ONLY production deps,
# then copy in the built artifacts. esbuild was invoked with
# --packages=external, so every dependency that server.cjs requires at
# runtime must be present in node_modules — the prod-only npm ci handles
# that without dragging Vite/React/Tailwind into the final image.
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000

# tini gives us proper PID 1 signal handling so `docker stop` exits cleanly
RUN apk add --no-cache tini

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund \
 && npm cache clean --force

COPY --from=builder /app/dist ./dist

EXPOSE 3000

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/server.cjs"]
