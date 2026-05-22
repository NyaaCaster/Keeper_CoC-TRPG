#!/bin/bash
set -e
COMPOSE_FILE="docker-compose.yml"
PROJECT="keeper-coc-trpg"

echo "Stopping containers..."
docker compose -p "$PROJECT" -f "$COMPOSE_FILE" down

echo "Rebuilding image..."
docker compose -p "$PROJECT" -f "$COMPOSE_FILE" build

echo "Removing dangling images..."
DANGLING=$(docker images -f "dangling=true" -q)
if [ -n "$DANGLING" ]; then docker rmi -f $DANGLING; fi

echo "Starting containers..."
docker compose -p "$PROJECT" -f "$COMPOSE_FILE" up -d

echo "Done. Running containers:"
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
