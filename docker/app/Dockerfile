# syntax=docker/dockerfile:1
#
# Zeff in a container: the pages, the sync host, the work host (one container: they share the database) and the knowledge servers
# (one container each) — built here from the repository. The AI CLIs the workers run are in it too: Claude Code, GitHub Copilot CLI,
# Codex. The automation browser stays on the host (scripts/chrome-bridge.mjs).
#
#   node scripts/app-docker.mjs --build          (the launcher does it when a service is switched to Docker)
#
# The build needs a lot of memory (Next's production build peaks near 12 GB): Docker Desktop's WSL2 limit must allow it
# (%UserProfile%\.wslconfig, [wsl2] memory=16GB).
ARG NODE_VERSION=24

FROM node:${NODE_VERSION}-bookworm AS build
WORKDIR /app
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ git ca-certificates \
 && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1 \
    ZEFF_TURBOPACK_ROOT=/app \
    NODE_OPTIONS=--max-old-space-size=12288
RUN node scripts/integrations.mjs \
 && npx next build \
 && npx next build knowledge
# The sync host runs from a build folder of its own (what `npm run deploy` does): a copy without the cache.
RUN mkdir .next-sync \
 && for f in $(ls -A .next | grep -v -e '^cache$' -e '^dev$'); do cp -r ".next/$f" ".next-sync/$f"; done
# The builds' caches only speed up the next build — not in the image (over a GB).
RUN rm -rf .next/cache knowledge/.next/cache

FROM node:${NODE_VERSION}-bookworm AS run
RUN apt-get update \
 && apt-get install -y --no-install-recommends git openssh-client ca-certificates curl tini ripgrep python3 \
 && rm -rf /var/lib/apt/lists/*
RUN npm install -g @anthropic-ai/claude-code @github/copilot @openai/codex
RUN git config --system --add safe.directory '*' \
 && git config --system core.fileMode false \
 && git config --system core.autocrlf input
WORKDIR /app
COPY --from=build --chown=node:node /app /app
RUN mkdir -p /app/data /home/node/.claude && chown -R node:node /app/data /home/node
USER node
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    ZEFF_DOCKER=1 \
    HOME=/home/node
EXPOSE 9333 9555
ENTRYPOINT ["tini", "--"]
CMD ["node", "docker/supervisor.mjs"]
