#!/bin/sh
# Enrich a finished DMP download with SongKong (tag-only), in a DEDICATED, ephemeral instance with
# its OWN config/DB so it never collides with the live :4567 server (exclusive H2 lock) NOR with the
# Lidarr automation instance (songkong-auto). Targets ONLY the DMP downloads root.
#   songkong-scan.sh "/mnt/SSD/Downloads/dmp/Artist/Album/2007 - Album"
# Identity-mounts the downloads volume (host path == container path), matching how dmp/slskd mount it.
# Run as normal user (uses sudo internally) or via root cron.
set -u
SK_IMAGE="songkong/songkong:latest"
LIVE_CFG="/mnt/SSD/songkong"            # live GUI config: license (+ profiles, used only as fallback)
AUTO_CFG="/mnt/SSD/songkong-auto-dmp"   # dedicated config/DB for DMP automation (separate from lidarr)
DL_HOST="/mnt/SSD/Downloads"            # identity-mounted; matches dmp's real DOWNLOADS_PATH parent
WANT_PROFILE="BPM, AcousticID, Genres, images"
# Enrich-only profile bundled in the repo + deployed next to this script. Self-provisions a fresh NAS
# (no GUI setup needed); only the license still comes from the live config.
BUNDLED_PROFILE="$(dirname "$0")/songkong_fixsongs_dmp.properties"
LOCK="$DL_HOST/.dmp-songkong/scan.lock"
TARGET="${1:?usage: songkong-scan.sh /mnt/SSD/Downloads/dmp/Artist/Album}"

# safety: only ever enrich inside the downloads root, never the spool/state dir
case "$TARGET" in
  "$DL_HOST"/.dmp-songkong|"$DL_HOST"/.dmp-songkong/*) echo "REFUSING: state dir ($TARGET)"; exit 1 ;;
  "$DL_HOST"|"$DL_HOST"/*) : ;;
  *) echo "REFUSING: target must be under $DL_HOST (got: $TARGET)"; exit 1 ;;
esac

# single-run lock (dedicated DB must have one owner at a time)
exec 9>"$LOCK"
if ! flock -n 9; then echo "another dmp-songkong-scan is running; exit"; exit 0; fi

# seed the dedicated config: carry over license (per-user secret; can't be bundled)
sudo mkdir -p "$AUTO_CFG/Prefs"
sudo cp -f "$LIVE_CFG/Prefs/license.properties" "$AUTO_CFG/Prefs/" 2>/dev/null || true

# resolve the enrich-only profile. Prefer the repo-bundled file (self-provisions a fresh NAS);
# fall back to discovering it by profileName in the live GUI config; else SongKong default.
PROFILE_FILE=""
if [ -f "$BUNDLED_PROFILE" ]; then
  PROFILE_FILE="songkong_fixsongs_dmp.properties"
  sudo cp -f "$BUNDLED_PROFILE" "$AUTO_CFG/Prefs/$PROFILE_FILE"
  echo "$(date "+%F %T") profile: bundled $WANT_PROFILE ($PROFILE_FILE) | target: $TARGET"
else
  for f in "$LIVE_CFG"/Prefs/songkong_fixsongs*.properties; do
    [ -f "$f" ] || continue
    if grep -qiF "profileName=$WANT_PROFILE" "$f"; then PROFILE_FILE=$(basename "$f"); break; fi
  done
  if [ -n "$PROFILE_FILE" ]; then
    sudo cp -f "$LIVE_CFG/Prefs/$PROFILE_FILE" "$AUTO_CFG/Prefs/"
    echo "$(date "+%F %T") profile: live $WANT_PROFILE ($PROFILE_FILE) | target: $TARGET"
  fi
fi

if [ -n "$PROFILE_FILE" ]; then
  PROF="-p $PROFILE_FILE"
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
