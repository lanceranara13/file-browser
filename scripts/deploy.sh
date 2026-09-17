#!/usr/bin/env bash
#
# Deploys this checkout to a Docker host over SSH and rebuilds the container.
#
#   bash scripts/deploy.sh
#
# Override the target with DEPLOY_HOST, DEPLOY_DIR and DEPLOY_URL.
#
# Source only: what git would commit (tracked files plus new ones that are not
# ignored). The server keeps its own `.env`, `files/`, `cache/` and `data/`, and
# none of them are ever sent or overwritten. A snapshot of what is there is taken
# first, so a bad deploy can be undone.
set -euo pipefail

HOST="${DEPLOY_HOST:-home}"
DIR="${DEPLOY_DIR:-/home/lance/file-browser}"
URL="${DEPLOY_URL:-http://localhost:3300/files}"

cd "$(dirname "$0")/.."

echo "→ ${HOST}:${DIR}"

# Snapshot first. Big runtime directories stay out of it; `data/` is the part
# worth keeping.
ssh "$HOST" "set -eu
  cd '$DIR'
  stamp=\$(date +%Y%m%d-%H%M%S)
  tar -czf \"../file-browser-predeploy-\${stamp}.tar.gz\" \
    --exclude=./files --exclude=./cache --exclude=./.deploy-staging .
  echo \"  snapshot: file-browser-predeploy-\${stamp}.tar.gz\""

# The file list comes from git, so .gitignore decides what ships. A file deleted
# but not yet staged is still listed; skip what is not on disk.
git ls-files -z --cached --others --exclude-standard |
  while IFS= read -r -d '' file; do [ -e "$file" ] && printf '%s\0' "$file"; done |
  tar -czf - --null -T - |
  ssh "$HOST" "set -eu
    cd '$DIR'
    # Unpacked whole before anything is replaced, so a cut stream fails harmlessly.
    rm -rf .deploy-staging
    mkdir .deploy-staging
    tar -xzf - -C .deploy-staging
    # Emptied, not merged: a file deleted here has to disappear there too.
    rm -rf app components lib scripts
    cp -a .deploy-staging/. .
    rm -rf .deploy-staging
    echo '  source synced'
    docker compose up -d --build"

echo "→ checking"
ssh "$HOST" "set -eu
  cd '$DIR'
  docker compose ps --format 'table {{.Name}}\t{{.Status}}\t{{.Ports}}'
  code=\$(curl -sf -o /dev/null -w '%{http_code}' '$URL' || true)
  echo \"  GET $URL → \${code:-no answer}\"
  [ \"\$code\" = 200 ]"

echo "✓ deployed"
