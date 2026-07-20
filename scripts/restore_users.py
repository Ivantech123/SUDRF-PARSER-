#!/usr/bin/env python3
"""Find and restore auth-store.json users from legacy VPS paths."""
import json
import os
import sys
import paramiko

HOST = os.environ.get("VPS_HOST", "31.77.148.90")
USER = os.environ.get("VPS_USER", "root")
PASS = os.environ.get("VPS_PASS")
DEPLOY_DIR = os.environ.get("VPS_DEPLOY_DIR", "/var/www/sudrf-mcp")

if not PASS:
    print("Set VPS_PASS env var")
    sys.exit(1)

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass


def run(c, cmd):
    stdin, stdout, stderr = c.exec_command(cmd, timeout=120)
    out = stdout.read().decode("utf-8", "replace")
    err = stderr.read().decode("utf-8", "replace")
    return stdout.channel.recv_exit_status(), out, err


def read_store(c, path):
    code, out, err = run(c, f"cat {path} 2>/dev/null")
    if code != 0 or not out.strip():
        return None
    try:
        return json.loads(out)
    except json.JSONDecodeError as e:
        print(f"  invalid JSON in {path}: {e}")
        return None


def as_map(obj):
    """Normalize users/keys/sessions to dict maps."""
    if isinstance(obj, dict):
        return dict(obj)
    if isinstance(obj, list):
        out = {}
        for item in obj:
            if isinstance(item, dict) and "id" in item:
                out[item["id"]] = item
        return out
    return {}


def summarize(store, path):
    users = as_map(store.get("users"))
    keys = as_map(store.get("keys"))
    sessions = as_map(store.get("sessions"))
    print(f"\n{path}")
    print(f"  users: {len(users)}, keys: {len(keys)}, sessions: {len(sessions)}")
    for u in users.values():
        print(f"    - {u.get('email')} ({u.get('role')})")


def merge_stores(target, source):
    """Merge users/keys/sessions from source into target (Record format)."""
    merged = {
        "version": target.get("version", source.get("version", 1)),
        "users": as_map(target.get("users")),
        "keys": as_map(target.get("keys")),
        "sessions": as_map(target.get("sessions")),
    }

    src_users = as_map(source.get("users"))
    src_keys = as_map(source.get("keys"))
    src_sessions = as_map(source.get("sessions"))

    emails = {u.get("email", "").lower() for u in merged["users"].values()}
    added_users = 0
    added_keys = 0
    added_sessions = 0

    for uid, u in src_users.items():
        email = (u.get("email") or "").lower()
        if email in emails:
            continue
        merged["users"][uid] = u
        emails.add(email)
        added_users += 1

    user_ids = set(merged["users"].keys())
    for kid, k in src_keys.items():
        if kid in merged["keys"]:
            continue
        if k.get("userId") not in user_ids:
            continue
        merged["keys"][kid] = k
        added_keys += 1

    for sid, s in src_sessions.items():
        if sid in merged["sessions"]:
            continue
        if s.get("userId") not in user_ids:
            continue
        merged["sessions"][sid] = s
        added_sessions += 1

    return merged, added_users, added_keys, added_sessions


def main():
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username=USER, password=PASS, timeout=30, allow_agent=False, look_for_keys=False)

    try:
        _, out, _ = run(c, "find /root /opt /var/www -name 'auth-store.json' 2>/dev/null | sort -u")
        paths = [p.strip() for p in out.splitlines() if p.strip()]
        print("Found auth-store files:")
        for p in paths:
            print(f"  {p}")

        stores = {}
        for p in paths:
            s = read_store(c, p)
            if s:
                stores[p] = s
                summarize(s, p)

        current = f"{DEPLOY_DIR}/auth-store.json"
        legacy_candidates = [
            "/opt/sudrf-mcp/auth-store.json",
            "/root/sudrf-mcp/auth-store.json",
        ]

        if current not in stores:
            stores[current] = read_store(c, current) or {
                "version": 1, "users": {}, "keys": {}, "sessions": {}
            }

        target = stores[current]
        total_added_users = 0
        total_added_keys = 0
        total_added_sessions = 0

        for legacy in legacy_candidates:
            if legacy == current or legacy not in stores:
                continue
            merged, au, ak, as_ = merge_stores(target, stores[legacy])
            if au or ak or as_:
                print(f"\nMerging from {legacy}: +{au} users, +{ak} keys, +{as_} sessions")
            target = merged
            total_added_users += au
            total_added_keys += ak
            total_added_sessions += as_

        users = as_map(target["users"])
        keys = as_map(target["keys"])
        print(f"\nResult: {len(users)} users, {len(keys)} keys")

        if total_added_users == 0 and total_added_keys == 0 and total_added_sessions == 0:
            print("Nothing new to restore.")
            print("Users in current store:")
            for u in users.values():
                print(f"  - {u.get('email')} ({u.get('role')})")
            return

        run(c, f"cp -a {current} {current}.bak-$(date +%Y%m%d%H%M%S) 2>/dev/null || true")
        payload = json.dumps(target, ensure_ascii=False, indent=2)
        sftp = c.open_sftp()
        with sftp.file(current, "w") as f:
            f.write(payload)
        sftp.close()

        print(f"\nRestored to {current}")
        print("Users now:")
        for u in users.values():
            print(f"  - {u.get('email')} ({u.get('role')})")

        run(c, "pm2 restart sudrf-mcp --update-env")
        print("\nPM2 restarted. Old passwords and API keys preserved.")

    finally:
        c.close()


if __name__ == "__main__":
    main()
