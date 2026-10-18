# syntax=docker/dockerfile:1
#
# Claude Code for Zeff: a service container that stays up, with Claude Code and the tools a worker needs in a repo. Zeff runs the
# CLI in it through scripts/claude-docker.mjs (`docker exec`). Your repos are mounted (ZEFF_CLAUDE_MOUNTS), the sign-in lives in
# the volume mounted on /home/node:
#
#   npm run claude:up            builds the image if it is missing and starts the container
#   docker exec -it zeff-claude claude          sign in once (it prints a link), then /exit
#
# Add the toolchains your repos need here (a JDK, Maven, Python packages …) and `npm run claude:build`.
ARG NODE_VERSION=24
FROM node:${NODE_VERSION}-bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends git openssh-client ca-certificates curl ripgrep tini python3 python3-pip make g++ unzip jq \
 && rm -rf /var/lib/apt/lists/*
RUN npm install -g @anthropic-ai/claude-code @github/copilot @openai/codex
# Folders from Windows show other owners and file modes: git must not mind. (Claude Code refuses its bypass modes as root: the node user.)
RUN git config --system --add safe.directory '*' \
 && git config --system core.fileMode false \
 && git config --system core.autocrlf input
COPY health.js /usr/local/bin/health.js
RUN mkdir -p /home/node/.claude /tmp/zeff-run && chown -R node:node /home/node /tmp/zeff-run
USER node
ENV HOME=/home/node \
    DISABLE_AUTOUPDATER=1
WORKDIR /home/node
EXPOSE 9335
ENTRYPOINT ["tini", "--"]
CMD ["node", "/usr/local/bin/health.js"]
