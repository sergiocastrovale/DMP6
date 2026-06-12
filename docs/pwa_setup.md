# PWA setup — run & use on Android

## 0. Prereqs (build machine)
```bash
node -v        # 20+
java -version  # 17+ (for APK build)
```

## 0b. Install Android SDK — one-time, Linux/WSL (no Android Studio)
```bash
# command-line tools
SDK="$HOME/Android/Sdk"; mkdir -p "$SDK/cmdline-tools"; cd /tmp
curl -fsSL -o cmdtools.zip https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip
python3 -c "import zipfile; zipfile.ZipFile('cmdtools.zip').extractall('/tmp/ct')"
mv /tmp/ct/cmdline-tools "$SDK/cmdline-tools/latest"
chmod -R +x "$SDK/cmdline-tools/latest/bin"
```
```bash
# env — append to ~/.bashrc then: source ~/.bashrc
export ANDROID_HOME="$HOME/Android/Sdk"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export PATH="$PATH:$ANDROID_HOME/platform-tools:$ANDROID_HOME/cmdline-tools/latest/bin"
```
```bash
# licenses + packages
yes | sdkmanager --licenses
sdkmanager "platform-tools" "platforms;android-35" "build-tools;35.0.0"
adb --version   # verify
```

## 1. Expose backend over HTTPS (pick one)
```bash
# Tailscale (private)
tailscale serve --bg http://localhost:3000
tailscale serve status        # note https://<host>.<tailnet>.ts.net

# Cloudflare Tunnel (public) — already in docker-compose.yml
docker compose up -d cloudflared
```
Origin MUST be https. Raw http://100.x:3000 will not work.

## 2. Build & run the web app
```bash
cd web
pnpm install
pnpm db:push
pnpm build
NODE_ENV=production node .output/server/index.mjs   # serves :3000
```

## 3. Install as PWA (no APK needed)
```text
Android Chrome → open https://<your-origin>
⋮ menu → "Add to Home screen" / "Install app"
```

## 4. Build the Android APK
MUST set MOBILE_SERVER_URL — without it the app loads the offline placeholder, not your library.
```bash
# Local (needs Android SDK):
cd mobile
pnpm install
rm -rf android        # only if rebuilding with a new origin
MOBILE_SERVER_URL=https://<your-origin> npx cap add android
node scripts/apply-android-overrides.mjs
cd android && ./gradlew assembleDebug
```
APK output:
```text
mobile/android/app/build/outputs/apk/debug/app-debug.apk
```
```bash
# Or via CI (no local SDK): GitHub → Actions → android-build → Run workflow
#   server_url = https://<your-origin> ,  variant_name = public|tailnet
# download the dmp-<variant>-apk artifact
```

## 5. Install APK on phone
```bash
# USB (adb), debugging on:
adb install -r mobile/android/app/build/outputs/apk/debug/app-debug.apk
```
```bash
# Or copy the .apk to the phone, tap it, allow "install unknown apps":
#   Tailscale file send / cloud drive / USB transfer
```

## 6. Use
```text
Open DMP app → log in once (cookie persists ~7 days)
Play a track → lock screen / swipe away → audio keeps playing
Lock-screen + notification: play / pause / next / prev / seek
```

## Rebuild after changing the origin
```bash
# server.url is baked in — rebuild the APK with the new MOBILE_SERVER_URL (repeat step 4)
```

## Tests
```bash
cd web && pnpm test          # unit
cd web && pnpm test:e2e      # playwright (needs built app + DB)
```
