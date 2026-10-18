# Claude Code in a Docker container

For a computer that cannot have the Claude CLI installed: Zeff, its launcher, the sync host, the work host and the knowledge servers stay
exactly where they are (on the host). **Claude Code runs in a service container** — "Claude" next to "Zeff", "Sync" and "Work" in the
launcher's tray — which has Claude Code, git and your repos mounted. The Copilot CLI (and Codex) stay on the host.

```
host (Windows)                                       Docker
┌──────────────────────────────────────────┐        ┌────────────────────────────────────────┐
│ Zeff launcher → Zeff · Sync · Work · …   │        │ container "zeff-claude"                │
│                                          │        │  claude · git · ripgrep · python · node │
│ Zeff runs  scripts/claude-docker.mjs     │─ exec ►│  /host/documents  ← your Documents      │
│   (instead of the Claude CLI)            │        │  /host/zeff/…     ← what Zeff hands over│
│                                          │◄ MCP ──│  /home/node       ← volume: the sign-in │
│ Zeff's MCP server  127.0.0.1:9333        │        └────────────────────────────────────────┘
└──────────────────────────────────────────┘
```

Zeff starts Claude in several places (the workers, live sessions, the mail review, the document reader). All of them run the file
`CLAUDE_CLI` names — `scripts/claude-docker.mjs`. It forwards the call into the container with `docker exec -i`: the arguments, the
stream-json on stdin/stdout and the exit code stay as they are. Only these are put right:

- **the working folder and every argument that is a mounted path** — `C:\Users\you\Documents\PROJ\repo` → `/host/documents/PROJ/repo`;
- **Zeff's MCP server** — `127.0.0.1:9333` → `host.docker.internal:9333` (the config is read on the host and handed over inline);
- **the environment** — only Claude's own variables and the run's identity go in, none of the host's.

## Set it up

1. Docker Desktop installed and running.
2. In the launcher's config (`zeff-launcher.json`, next to Zeff.exe) set:
   ```json
   { "claudeDocker": true, "claudeMounts": "C:\\Users\\you\\Documents=/host/documents" }
   ```
   (`claudeMounts` is optional: without it your Documents folder is mounted. More folders: `A=/host/a;B=/host/b`.)
   Restart the launcher. It builds the image on the first start (`docker/claude/Dockerfile`, a few minutes) and keeps the container up.
   Without the launcher: `npm run claude:up` and `CLAUDE_CLI=<path>\scripts\claude-docker.mjs` in Zeff's environment.
3. Sign in once — Claude's sign-in lives in the volume `zeff-claude-home`, so it survives rebuilds:
   ```
   docker exec -it zeff-claude claude
   ```
   (it prints a link; sign in, then `/exit`).

`npm run claude:status` says whether the image and the container are there. `npm run claude:down` removes the container,
`npm run claude:build` rebuilds the image (add the toolchains your repos need to `docker/claude/Dockerfile`: a JDK, Maven, …).

## What is mounted — and what is not

| host | container | |
|---|---|---|
| your Documents folder (`claudeMounts`) | `/host/documents` | read-write — your repos |
| `data/work/attachments` | `/host/zeff/attachments` | read-only — the pictures and files sent with a prompt |
| `data/documents` | `/host/zeff/documents` | read-only — the documents Claude reads |
| volume `zeff-claude-home` | `/home/node` | the sign-in and Claude's settings, session files |

Zeff's databases, tokens and sign-ins (`data/` otherwise) are **not** mounted. The container runs as a normal user, with
`no-new-privileges` and a process limit. It can reach the internet (the API) and the host (Zeff's MCP server) — nothing else of yours
is shared but the folders above.

## Ending a run

Zeff ends a worker by ending its process on the host. That would leave the `claude` inside the container (and what it started) running,
so the work host also asks the shim to end it there: each run's `claude` leads its own process group, whose id is kept in
`/tmp/zeff-run/<run>.pid` in the container (`claude-docker.mjs --kill <run>`).

## Limits

- **MCP servers that are programs to start** (the Jira "send" mode, plugins' `workerMcpServers` with a command) cannot run in the
  container — they point at Windows paths and programs. They are left out, with a line on stderr. Zeff's own MCP server (an address)
  works.
- **Repos outside the mounted folders**: a working folder that is not mounted runs in the container's `/tmp` — add the folder to
  `claudeMounts` (and restart the launcher: a changed mount recreates the container).
- **git worktrees** a worker makes in a repo have the container's absolute paths in the repo's `.git` metadata. The repo works in the
  container; Windows git may not follow a worktree made there (`git worktree prune` fixes the list).
- **Line endings and file modes**: the container's git is set to `core.autocrlf input` and ignores file modes (Windows folders show 777).
  Checkouts on the host with `autocrlf true` can show line-ending differences.
- **Signing in with the login button** in Zeff's settings runs the CLI without a terminal: use `docker exec -it zeff-claude claude`.
