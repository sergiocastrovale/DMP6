# TrueNAS Setup

Deploy DMP on TrueNAS Scale. Images are built on your dev machine and pushed to the NAS via `./deploy`.

## Prerequisites

- TrueNAS Scale 25.04+, PostgreSQL app installed
- Docker on your dev machine
- SSH access: user `Kp` with full privileges
- Music at `/mnt/dmp/music/mainstream`, SSD pool at `/mnt/SSD`

---

## 1. Database

```bash
psql -h 192.168.1.241 -p 5432 -U postgres
```

```sql
CREATE USER dmp WITH PASSWORD 'your-password';
CREATE DATABASE dmp OWNER dmp;
GRANT ALL PRIVILEGES ON DATABASE dmp TO dmp;
```

---

## 2. NAS Storage

```bash
ssh nas
mkdir -p path/to/dmp/{img/artists,img/releases,dump,redis}
chown -R 999:999 path/to/dmp
```

---

## 3. SSH Key (first time)

```bash
ssh-keygen -t ed25519 -f ~/.ssh/nas -N ""
```

Add to `~/.ssh/config`:

```
Host nas
    HostName 192.168.1.241
    User Kp
    IdentityFile ~/.ssh/nas
    IdentitiesOnly yes
```

In TrueNAS UI: **Credentials > Local Users > Kp > Edit** → paste `~/.ssh/nas.pub` into **SSH Public Keys**.

Enable SSH: **System > Services > SSH** → Running + Start Automatically.

Set in `web/.env`:

```env
SERVER_HOST=192.168.1.241
SERVER_USER=Kp
DEPLOY_PATH=path/to/dmp
SSH_KEY_PATH=~/.ssh/nas
```

---

## 4. NAS `.env`

```bash
ssh nas && nano path/to/dmp/.env
```

```env
DATABASE_URL=postgresql://dmp:your-password@host.docker.internal:5432/dmp?connection_limit=20&pool_timeout=10
MUSIC_DIR=/mnt/dmp/music/mainstream
DMP_DATA=path/to/dmp
DMP_PORT=3000
```

> Use `host.docker.internal` (not `localhost`) for PostgreSQL - `localhost` resolves to the container itself.

---

## 5. Deploy

```bash
./deploy         # build + transfer + restart
```

---

## 6. Verify

```bash
ssh nas
sudo docker ps
sudo docker inspect --format='{{.State.Health.Status}}' dmp
curl http://localhost:3000/api/health
```

Access: `http://192.168.1.241:3000`

---

## 7. Initial Data Load

**Option A - Restore a backup:**

```bash
# Dev machine
cd web && pnpm backup   # → dump/YYYY-MM-DD-HH-MM-SS.sql.gz
scp "dump/$(ls -t dump/ | head -1)" nas:path/to/dmp/dump/

# NAS
ssh nas
cd path/to/dmp
sudo docker exec -it ix-postgres-postgres-1 psql -U dmp -d postgres -c "DROP DATABASE IF EXISTS dmp;"
sudo docker exec -it ix-postgres-postgres-1 psql -U dmp -d postgres -c "CREATE DATABASE dmp OWNER dmp;"
gunzip -c "dump/$(ls -t dump/ | head -1)" | sudo docker exec -i ix-postgres-postgres-1 psql -U dmp -d dmp
sudo docker restart dmp
```

**Option B - Fresh index + sync** (takes several hours on a large library):

```bash
ssh nas
cd path/to/dmp
./index && ./sync
```

---

## 8. Running Scripts

Shell wrappers are deployed to `DEPLOY_PATH`. They run binaries inside the container via `docker exec`.

```bash
ssh nas
cd path/to/dmp

./index                          # extract metadata from files → DB
./index --only="Artist Name"     # single artist
./index --quick                  # skip unchanged folders (mtime check)
./index --resume                 # continue from last checkpoint
./index --from=a --to=cz         # letter range batch

./sync                           # MusicBrainz sync
./sync --only="Artist Name"      # single artist
./sync --only="Artist" --overwrite
./sync --from=a --to=cz

./refresh                        # ./index && ./sync (same args)
./refresh --only="Artist Name"   # re-index + re-sync specific artist

./audit                          # detect metadata issues → DB
./fix --corrupted                # apply pending fixes
./analysis                       # metadata quality HTML report
./nuke                           # DESTRUCTIVE - full DB reset
```

---

## 9. Long-Running Sessions (tmux)

tmux is pre-installed on TrueNAS Scale. Use it to keep syncs running after you disconnect.

```bash
ssh nas
tmux new -s sync
cd path/to/dmp
./index --from=a --to=z && ./sync --from=a --to=z
```

- **Detach**: `Ctrl+B` then `D` - session keeps running
- **Reattach**: `tmux attach -t sync`
- **List sessions**: `tmux ls`
- **Kill session**: `tmux kill-session -t sync`

If the NAS reboots mid-index, resume with `./index --resume`.

---

## 10. Updates

```bash
./deploy        # rebuild + redeploy
```

---

## 11. Monitoring

```bash
sudo docker logs -f dmp
sudo docker stats dmp
sudo docker restart dmp
```

---

## 12. Performance Tuning

### PostgreSQL

```bash
ssh nas
for setting in \
  "shared_buffers = '8GB'" \
  "effective_cache_size = '24GB'" \
  "work_mem = '256MB'" \
  "maintenance_work_mem = '2GB'" \
  "wal_buffers = '64MB'" \
  "checkpoint_completion_target = 0.9" \
  "min_wal_size = '1GB'" \
  "max_wal_size = '4GB'" \
  "random_page_cost = 1.1" \
  "effective_io_concurrency = 200" \
  "max_worker_processes = 8" \
  "max_parallel_workers = 8" \
  "max_parallel_workers_per_gather = 4" \
  "max_connections = 50"
do
  sudo docker exec ix-postgres-postgres-1 psql -U dmp -d dmp -c "ALTER SYSTEM SET $setting;"
done
sudo docker restart ix-postgres-postgres-1
```

Sized for 32 GB RAM. Settings survive container recreation (written to `postgresql.auto.conf`).

### Redis

Runs as `dmp-redis` sidecar. If unreachable the app falls through to the DB silently.

```bash
mkdir -p path/to/dmp/redis
```

### ZFS (music dataset)

```bash
sudo zfs set recordsize=1M dmp/music
sudo zfs set primarycache=metadata dmp/music
sudo zfs set atime=off dmp/music
```

---

## 13. Cloudflare Tunnel (dmp.nrnas.com)

1. Cloudflare dash → **Zero Trust → Networks → Connectors → Create a tunnel**
   - Type: Docker, Name: `dmp`
   - Copy the token from the shown `docker run` command
2. **Networks → Overview → Route to a published application**
   - Subdomain: `dmp`, Domain: `nrnas.com`
   - Service: HTTP, URL: `dmp:3000`
3. Add the token to the NAS `.env`:
   ```bash
   echo "CLOUDFLARE_TUNNEL_TOKEN=<token>" >> path/to/dmp/.env
   ```
4. Redeploy: `./deploy`

`https://dmp.nrnas.com` will be live once the tunnel connects.
