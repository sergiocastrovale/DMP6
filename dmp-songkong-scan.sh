#!/bin/sh
# Enrich a finished DMP download with SongKong (tag-only), in a DEDICATED, ephemeral instance with
# its OWN config/DB so it never collides with the live :4567 server (exclusive H2 lock) NOR with the
# Lidarr automation instance (songkong-auto). Targets ONLY the DMP downloads root.
#   dmp-songkong-scan.sh "/mnt/SSD/Downloads/dmp/Artist/Album/2007 - Album"
# Identity-mounts the downloads volume (host path == container path), matching how dmp/slskd mount it.
# Run as normal user (uses sudo internally) or via root cron.
set -u
SK_IMAGE="songkong/songkong:latest"
LIVE_CFG="/mnt/SSD/songkong"            # live GUI config: license + saved profiles
AUTO_CFG="/mnt/SSD/songkong-auto-dmp"   # dedicated config/DB for DMP automation (separate from lidarr)
DL_HOST="/mnt/SSD/Downloads"            # identity-mounted; matches dmp's real DOWNLOADS_PATH parent
WANT_PROFILE="BPM, AcousticID, Genres, images"
LOCK="$DL_HOST/.dmp-songkong/scan.lock"
TARGET="${1:?usage: dmp-songkong-scan.sh /mnt/SSD/Downloads/dmp/Artist/Album}"

# safety: only ever enrich inside the downloads root, never the spool/state dir
case "$TARGET" in
  "$DL_HOST"/.dmp-songkong|"$DL_HOST"/.dmp-songkong/*) echo "REFUSING: state dir ($TARGET)"; exit 1 ;;
  "$DL_HOST"|"$DL_HOST"/*) : ;;
  *) echo "REFUSING: target must be under $DL_HOST (got: $TARGET)"; exit 1 ;;
esac

# single-run lock (dedicated DB must have one owner at a time)
exec 9>"$LOCK"
if ! flock -n 9; then echo "another dmp-songkong-scan is running; exit"; exit 0; fi

# resolve the named profile -> its properties file (fallback: SongKong default)
PROFILE_FILE=""
for f in "$LIVE_CFG"/Prefs/songkong_fixsongs*.properties; do
  [ -f "$f" ] || continue
  if grep -qiF "profileName=$WANT_PROFILE" "$f"; then PROFILE_FILE=$(basename "$f"); break; fi
done

# seed the dedicated config: carry over license (+ profile if found)
sudo mkdir -p "$AUTO_CFG/Prefs"
sudo cp -f "$LIVE_CFG/Prefs/license.properties" "$AUTO_CFG/Prefs/" 2>/dev/null || true
if [ -n "$PROFILE_FILE" ]; then
  sudo cp -f "$LIVE_CFG/Prefs/$PROFILE_FILE" "$AUTO_CFG/Prefs/"
  PROF="-p $PROFILE_FILE"
  echo "$(date "+%F %T") profile: $WANT_PROFILE ($PROFILE_FILE) | target: $TARGET"
else
  PROF=""
  echo "$(date "+%F %T") profile not found -> SongKong default | target: $TARGET"
fi

# run dedicated ephemeral instance (own DB; safe alongside the live server + lidarr automation).
# identity-mount so $TARGET (a real /mnt/SSD/Downloads/... path from the spool) resolves inside.
sudo docker run --rm \
  -v "$AUTO_CFG:/songkong" \
  -v "$DL_HOST:$DL_HOST" \
  "$SK_IMAGE" -m $PROF "$TARGET"
echo "$(date "+%F %T") dmp-songkong-scan done: $TARGET"
