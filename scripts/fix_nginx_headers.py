#!/usr/bin/env python3
"""Patch nginx on VPS to forward X-Forwarded-Proto/Host for OAuth metadata."""
import os
import sys
import paramiko

HOST = os.environ.get("VPS_HOST", "31.77.148.90")
USER = os.environ.get("VPS_USER", "root")
PASS = os.environ.get("VPS_PASS")
CONF = "/etc/nginx/sites-enabled/sudrf-mcp"

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
        patch = r"""
if ! grep -q 'X-Forwarded-Proto' """ + CONF + r"""; then
  sed -i '/proxy_set_header Host \$host;/a\        proxy_set_header X-Forwarded-Proto \$scheme;\n        proxy_set_header X-Forwarded-Host \$host;' """ + CONF + r"""
  echo patched
else
  echo already patched
fi
nginx -t && systemctl reload nginx
"""
        code, out, err = run(c, patch)
        print(out)
        if err:
            print(err)
        if code != 0:
            sys.exit(code)
    finally:
        c.close()


if __name__ == "__main__":
    main()
