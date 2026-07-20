#!/usr/bin/env python3
"""Upload web/dist to VPS."""
import os
import sys
from pathlib import Path
import paramiko

ROOT = Path(__file__).resolve().parent.parent
HOST = os.environ.get("VPS_HOST", "31.77.148.90")
PASS = os.environ.get("VPS_PASS")
DEPLOY = os.environ.get("VPS_DEPLOY_DIR", "/var/www/sudrf-mcp")

if not PASS:
    print("Set VPS_PASS")
    sys.exit(1)

web_dist = ROOT / "web" / "dist"
if not web_dist.exists():
    print("Run: cd web && npm run build")
    sys.exit(1)

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(HOST, username="root", password=PASS, timeout=30, allow_agent=False, look_for_keys=False)
sftp = c.open_sftp()

def mkdir_p(path):
    parts = path.split("/")
    cur = ""
    for p in parts:
        if not p:
            continue
        cur += "/" + p
        try:
            sftp.stat(cur)
        except OSError:
            try:
                sftp.mkdir(cur)
            except OSError:
                pass

n = 0
for f in web_dist.rglob("*"):
    if not f.is_file():
        continue
    rel = f.relative_to(web_dist).as_posix()
    remote = f"{DEPLOY}/web/dist/{rel}"
    mkdir_p("/".join(remote.split("/")[:-1]))
    sftp.put(str(f), remote)
    n += 1
    print("upload", rel)

sftp.close()
_, out, _ = c.exec_command(f"chmod -R a+rX {DEPLOY}/web/dist")
out.read()
c.close()
print(f"done: {n} files")
