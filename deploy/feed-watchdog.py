#!/usr/bin/env python3
"""
Restarts the realtime service when the F1 feed stalls during a session.

The realtime service can stop receiving from F1 without an error: its clients stay
connected and keep the last state (US GP 2026, 22:04). Run every minute by
f1-feed-watchdog.timer: it listens to the feed for a while and restarts the service
when a session is running and no update arrives.

  feed-watchdog.py [--dry-run]
"""

import json
import os
import socket
import subprocess
import sys
import time
import urllib.request

URL = os.environ.get("REALTIME_URL", "http://localhost:4000") + "/api/realtime"
COMPOSE_DIR = os.environ.get("COMPOSE_DIR", "/opt/f1-dash-v4")
# during a session car data alone arrives several times a second
LISTEN_S = 20
# a restart takes a few seconds, give the feed time to come back before trying again
COOLDOWN_S = 300
STAMP = "/run/f1-feed-watchdog.last"


def listen():
    """the session status and the number of updates seen in LISTEN_S seconds"""
    status, updates, buffer = None, 0, b""
    end = time.time() + LISTEN_S

    try:
        with urllib.request.urlopen(URL, timeout=LISTEN_S) as response:
            while time.time() < end:
                chunk = response.read1(65536)
                if not chunk:
                    break
                buffer += chunk.replace(b"\r\n", b"\n")

                while b"\n\n" in buffer:
                    block, buffer = buffer.split(b"\n\n", 1)
                    lines = block.decode("utf8", "replace").split("\n")
                    event = next((line.split(":", 1)[1].strip() for line in lines if line.startswith("event:")), None)
                    data = "\n".join(line[5:].lstrip() for line in lines if line.startswith("data:"))
                    if not data:
                        continue

                    if event == "update":
                        updates += 1
                    message = json.loads(data)
                    status = (message.get("SessionStatus") or {}).get("Status", status)
    except (socket.timeout, TimeoutError):
        pass

    return status, updates


def main():
    dry_run = "--dry-run" in sys.argv

    try:
        status, updates = listen()
    except Exception as error:  # the service may be restarting, the next run checks again
        print(f"feed not reachable: {error}")
        return

    stalled = status == "Started" and updates == 0
    print(f"session {status}, {updates} updates in {LISTEN_S}s{', stalled' if stalled else ''}")
    if not stalled:
        return

    if os.path.exists(STAMP) and time.time() - os.path.getmtime(STAMP) < COOLDOWN_S:
        print("restarted less than 5 minutes ago, waiting")
        return

    if dry_run:
        print("would restart realtime")
        return

    open(STAMP, "w").close()
    subprocess.run(["docker", "compose", "restart", "realtime"], cwd=COMPOSE_DIR, check=False)
    print("realtime restarted")


if __name__ == "__main__":
    main()
