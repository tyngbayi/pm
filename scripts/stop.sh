#!/usr/bin/env bash
set -euo pipefail

CONTAINER_NAME="pm-app"

if ! docker container inspect "$CONTAINER_NAME" >/dev/null 2>&1; then
    echo "Project Management app container does not exist."
    exit 0
fi

if [ "$(docker container inspect --format '{{.State.Running}}' "$CONTAINER_NAME")" = "true" ]; then
    docker stop "$CONTAINER_NAME"
fi

docker rm "$CONTAINER_NAME"
