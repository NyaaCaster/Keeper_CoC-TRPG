#!/usr/bin/env python3
"""Keeper_CoC-TRPG Docker rebuild script.

Stops the current container, rebuilds the image with layer caching,
cleans dangling images, and starts a fresh container.

Usage:
    python rebuild.py          # rebuild with layer cache (default)
    python rebuild.py --no-cache  # full rebuild

Equivalent to the former rebuild.ps1 / rebuild.sh — uses Python for
cross-platform portability without execution-policy hurdles.
"""

import subprocess
import sys
import os

COMPOSE_FILE = "docker-compose.yml"
PROJECT = "keeper-coc-trpg"


def run(cmd: list[str], **kwargs) -> subprocess.CompletedProcess:
    print(f"\033[36m> {' '.join(cmd)}\033[0m")
    return subprocess.run(cmd, check=True, **kwargs)


def main() -> None:
    no_cache = "--no-cache" in sys.argv

    os.chdir(os.path.dirname(os.path.abspath(__file__)))

    # 1. Stop
    print("\033[36mStopping containers...\033[0m")
    run(["docker", "compose", "-p", PROJECT, "-f", COMPOSE_FILE, "down"])

    # 2. Build
    print("\033[36mRebuilding image...\033[0m")
    build_cmd = ["docker", "compose", "-p", PROJECT, "-f", COMPOSE_FILE, "build"]
    if no_cache:
        build_cmd.append("--no-cache")
    run(build_cmd)

    # 3. Clean dangling images
    print("\033[36mRemoving dangling images...\033[0m")
    result = subprocess.run(
        ["docker", "images", "-f", "dangling=true", "-q"],
        capture_output=True, text=True
    )
    dangling = result.stdout.strip()
    if dangling:
        ids = dangling.splitlines()
        subprocess.run(["docker", "rmi", "-f"] + ids, check=False)

    # 4. Start
    print("\033[36mStarting containers...\033[0m")
    run(["docker", "compose", "-p", PROJECT, "-f", COMPOSE_FILE, "up", "-d"])

    # 5. Status
    print("\033[32mDone. Running containers:\033[0m")
    run(["docker", "ps", "--format", "table {{.Names}}\t{{.Status}}\t{{.Ports}}"])


if __name__ == "__main__":
    main()
