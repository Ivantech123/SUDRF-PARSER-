#!/usr/bin/env python3
"""Restart PM2 with ecosystem env and verify OAuth metadata uses HTTPS."""
import json
import os
import sys
import paramiko

HOST = os.environ.get("VPS_HOST", "31.77.148.90")
USER = os.environ.get("VPS_USER", "root")
PASS = os.environ.get("VPS_PASS")
DEPLOY_DIR = os.environ.get("VPS_DEPLOY_DIR", "/var/www/sudrf-mcp")

if not PASS:
    print("Set VPS_PASS"); sys.exit(1)

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass


def run(c, cmd):
    stdin, stdout, stderr = c.exec_command(cmd, timeout=120)
    out = stdout.read().decode("utf-8", "replace")
    err = stderr.read().decode("utf-8", "replace")
    return stdout.channel.recv_exit_status(), out, err


def main():
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username=USER, password=PASS, timeout=30, allow_agent=False, look_for_keys=False)
    try:
        run(c, "pm2 stop sudrf-mcp || true")
        run(c, "pm2 delete sudrf-mcp || true")
        run(c, f"cd {DEPLOY_DIR} && pm2 start ecosystem.config.json")
        run(c, "pm2 save")
        run(c, "sleep 2")

        _, out, _ = run(c, "pm2 pid sudrf-mcp")
        pid = out.strip()
        if pid:
            _, env_out, _ = run(c, f"tr '\\0' '\\n' < /proc/{pid}/environ | grep MCP")
            print("Runtime env:")
            print(env_out)

        _, meta, _ = run(c, "curl -s http://127.0.0.1:8080/.well-known/oauth-authorization-server")
        print("\nMetadata:")
        print(meta)
        data = json.loads(meta)
        issuer = data.get("issuer", "")
        if issuer.startswith("https://"):
            print("\nOK: issuer uses HTTPS")
        else:
            print(f"\nFAIL: issuer is {issuer}")
            sys.exit(1)
    finally:
        c.close()


if __name__ == "__main__":
    main()
