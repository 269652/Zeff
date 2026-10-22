#!/bin/sh
# Zeff on a server (docker/server/README.md): the stack, the knowledge server of each account in KNOWLEDGE (id:port …) and Caddy
# in front — all on the host's network, Zeff's own ports on 127.0.0.1 only, Caddy on 443. Run again after a new image: the
# containers are made anew, the data stays in $DIR/data.
set -eu
DIR=${ZEFF_SERVER_DIR:-/srv/zeff}
DOMAIN=${ZEFF_DOMAIN:?ZEFF_DOMAIN, please (the server's name for HTTPS)}
KNOWLEDGE=${KNOWLEDGE:-privat:9556}
IMAGE=${IMAGE:-zeff-app:local}
TOKEN=$(cat "$DIR/bridge-token")
[ -f "$DIR/data/gate.json" ] || { echo "no password yet: docker/server/README.md, step 4" >&2; exit 1; }

docker rm -f zeff-stack zeff-caddy >/dev/null 2>&1 || true
docker run -d --restart unless-stopped --init --name zeff-stack --network host --security-opt no-new-privileges --memory 3g \
  -v "$DIR/data:/app/data" -v zeff-claude-home:/home/node \
  -e ZEFF_GATE=1 -e ZEFF_BIND=127.0.0.1 -e ZEFF_CDP_BASE=http://127.0.0.1 -e "ZEFF_BRIDGE_TOKEN=$TOKEN" \
  "$IMAGE" >/dev/null
echo "zeff-stack up"

for k in $KNOWLEDGE; do
  id=${k%%:*}
  port=${k##*:}
  docker rm -f "zeff-knowledge-$id" >/dev/null 2>&1 || true
  mkdir -p "$DIR/data/accounts/$id/knowledge"
  docker run -d --restart unless-stopped --init --name "zeff-knowledge-$id" --network host --security-opt no-new-privileges --memory 1g \
    -v "$DIR/data/accounts/$id/knowledge:/knowledge-data" -v zeff-claude-home:/home/node \
    -e "KNOWLEDGE_ACCOUNT=$id" -e ZEFF_URL=http://127.0.0.1:9333 -e KNOWLEDGE_DATA_DIR=/knowledge-data -e "PORT=$port" \
    "$IMAGE" node node_modules/next/dist/bin/next start knowledge -H 127.0.0.1 -p "$port" >/dev/null
  echo "zeff-knowledge-$id up ($port)"
done

docker run -d --restart unless-stopped --name zeff-caddy --network host \
  -v "$DIR/Caddyfile:/etc/caddy/Caddyfile:ro" -v zeff-caddy-data:/data -v zeff-caddy-config:/config -e "ZEFF_DOMAIN=$DOMAIN" \
  caddy:2.10.2 >/dev/null
echo "zeff-caddy up: https://$DOMAIN"
