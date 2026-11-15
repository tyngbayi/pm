#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE_NAME="pm-app:latest"
CONTAINER_NAME="pm-app"

if ! docker image inspect "$IMAGE_NAME" >/dev/null 2>&1; then
    docker build --tag "$IMAGE_NAME" "$ROOT_DIR"
fi

if docker container inspect "$CONTAINER_NAME" >/dev/null 2>&1; then
    if [ "$(docker container inspect --format '{{.State.Running}}' "$CONTAINER_NAME")" = "true" ]; then
        echo "Project Management app is already running at http://localhost:8000"
    else
        docker start "$CONTAINER_NAME"
    fi
else
    docker run --detach --name "$CONTAINER_NAME" --publish 127.0.0.1:8000:8000 "$IMAGE_NAME"
fi

for attempt in {1..30}; do
    if curl --fail --silent http://127.0.0.1:8000/api/health >/dev/null; then
        echo "Project Management app is available at http://localhost:8000"
        exit 0
    fi
    sleep 1
done

echo "Project Management app did not become ready within 30 seconds." >&2
docker logs "$CONTAINER_NAME" >&2
exit 1

