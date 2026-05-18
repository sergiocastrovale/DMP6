#!/usr/bin/env python3
"""
Batch re-index all artist folders that contain unsplit compound artists.
Queries the DB for unique artist folders from IssueUnsplitArtist, then
chains ./index --only="batch" --overwrite --skip-covers commands.
"""

import subprocess
import sys
import os

BATCH_SIZE = 50
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(SCRIPT_DIR)

USE_DOCKER = not os.path.exists(os.path.join(SCRIPT_DIR, "target", "release", "index"))

def run_bin(name, args):
    if USE_DOCKER:
        cmd = ["docker", "exec", "dmp", name] + args
    else:
        cmd = [os.path.join(SCRIPT_DIR, "target", "release", name)] + args
    return subprocess.run(cmd, cwd=PROJECT_ROOT)

DB_URL = os.environ.get("DATABASE_URL")
if not DB_URL:
    for env_path in [
        os.path.join(SCRIPT_DIR, ".env"),
        os.path.join(PROJECT_ROOT, ".env"),
        os.path.join(PROJECT_ROOT, "web", ".env"),
    ]:
        if os.path.exists(env_path):
            with open(env_path) as f:
                for line in f:
                    line = line.strip()
                    if line.startswith("DATABASE_URL="):
                        DB_URL = line.split("=", 1)[1].strip('"').strip("'")
                        break
            if DB_URL:
                break

if not DB_URL:
    print("ERROR: DATABASE_URL not set and not found in .env")
    sys.exit(1)

DB_URL = DB_URL.replace("host.docker.internal", "localhost")

try:
    import psycopg2
except ImportError:
    print("Installing psycopg2-binary...")
    subprocess.check_call([sys.executable, "-m", "pip", "install", "psycopg2-binary", "-q"])
    import psycopg2

conn = psycopg2.connect(DB_URL)
cur = conn.cursor()

cur.execute("""
    SELECT DISTINCT split_part(t."filePath", '/', 1)
    FROM "LocalReleaseTrack" t
    JOIN "TrackArtist" ta ON ta."trackId" = t.id
    JOIN "IssueUnsplitArtist" i ON i."artistId" = ta."artistId"
    WHERE split_part(t."filePath", '/', 1) != ''
""")

folders = sorted(set(row[0] for row in cur.fetchall()))
cur.close()
conn.close()

if not folders:
    print("No affected artist folders found.")
    sys.exit(0)

print(f"Found {len(folders)} unique artist folders to re-index")
print(f"Batching into groups of {BATCH_SIZE}")
print()

batches = [folders[i:i + BATCH_SIZE] for i in range(0, len(folders), BATCH_SIZE)]
total_batches = len(batches)
failed = []

for idx, batch in enumerate(batches, 1):
    only_arg = ";".join(batch)
    print(f"[{idx}/{total_batches}] Indexing {len(batch)} folders...")
    print(f"  {batch[0]} ... {batch[-1]}")

    result = run_bin("index", [f"--only={only_arg}", "--overwrite", "--skip-covers"])

    if result.returncode != 0:
        print(f"  FAILED (exit {result.returncode})")
        failed.extend(batch)
    else:
        print(f"  OK")
    print()

print(f"Done. {len(folders) - len(failed)}/{len(folders)} folders re-indexed successfully.")
if failed:
    print(f"Failed folders ({len(failed)}):")
    for f in failed:
        print(f"  {f}")

print()
print("Running audit --orphans...")
run_bin("audit", ["--orphans"])

print()
print("Running fix --orphans...")
run_bin("fix", ["--orphans"])

if failed:
    sys.exit(1)
