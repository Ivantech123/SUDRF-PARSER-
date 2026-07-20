#!/usr/bin/env python3
"""Tail live/recent PM2 logs on VPS."""
import os
import sys
import time
import paramiko

HOST = os.environ.get("VPS_HOST", "31.77.148.90")
PASS = os.environ.get("VPS_PASS", "mdSWlQffT0VuegTZ1fpB")
SECS = int(os.environ.get("LOG_SECS", "25"))

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass


def main():
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username="root", password=PASS, timeout=30, allow_agent=False, look_for_keys=False)

    def run(cmd: str) -> str:
        _, o, _ = c.exec_command(cmd, timeout=60)
        return o.read().decode("utf-8", "replace").strip()

    print(f"=== PM2 status ===\n{run('pm2 status')}\n")

    print(f"=== LIVE stream ({SECS}s) ===")
    chan = c.get_transport().open_session()
    chan.exec_command(f"timeout {SECS} pm2 logs sudrf-parser-worker sudrf-mcp --lines 8 --raw 2>&1")
    deadline = time.time() + SECS + 3
    got = False
    while time.time() < deadline:
        if chan.recv_ready():
            got = True
            sys.stdout.write(chan.recv(8192).decode("utf-8", "replace"))
            sys.stdout.flush()
        if chan.exit_status_ready():
            break
        time.sleep(0.2)
    if not got:
        print("(stream empty)\n")

    print("\n=== Go worker stderr (last 40) ===")
    print(run("tail -40 /root/.pm2/logs/sudrf-parser-worker-error-1.log") or "(empty)")

    print("\n=== Go [enrich] lines ===")
    print(run("grep '\\[enrich\\]' /root/.pm2/logs/sudrf-parser-worker-error-1.log | tail -15") or "(none yet)")

    print("\n=== Node out (last 25) ===")
    print(run("tail -25 /root/.pm2/logs/sudrf-mcp-out-0.log") or "(empty)")

    print("\n=== Worker /stats ===")
    print(run("curl -s http://127.0.0.1:8090/stats"))

    c.close()


if __name__ == "__main__":
    main()
