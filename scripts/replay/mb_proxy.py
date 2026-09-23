#!/usr/bin/env python3
"""Record-through cache for MusicBrainz / Cover Art Archive requests.

Replays point MB_BASE_URL at http://127.0.0.1:<port>/ws/2 and COVER_ART_ARCHIVE_URL at
http://127.0.0.1:<port>/caa. A cached response is served as-is; a miss is fetched from the public
server (paced to one request per 1.1 s, identified by MB_USER_AGENT) and cached unless it is a 5xx.
With REPLAY_OFFLINE=1 a miss answers 404 instead of going to the network.

Usage: mb_proxy.py <port> <cache_dir>
"""

import base64
import hashlib
import json
import os
import sys
import threading
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

UPSTREAMS = {
    "/ws/2": "https://musicbrainz.org/ws/2",
    "/caa": "https://coverartarchive.org",
}
MIN_INTERVAL_S = 1.1
USER_AGENT = os.environ.get("MB_USER_AGENT") or "DMP-replay/1.0 ( https://github.com/dmp )"
OFFLINE = os.environ.get("REPLAY_OFFLINE") == "1"

pace_lock = threading.Lock()
last_request = [0.0]


def upstream_url(path):
    for prefix, base in UPSTREAMS.items():
        if path == prefix or path.startswith(prefix + "/") or path.startswith(prefix + "?"):
            return base + path[len(prefix):]
    return None


def fetch(url):
    with pace_lock:
        wait = MIN_INTERVAL_S - (time.monotonic() - last_request[0])
        if wait > 0:
            time.sleep(wait)
        last_request[0] = time.monotonic()
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(request, timeout=90) as response:
            return response.status, response.headers.get("Content-Type", ""), response.read()
    except urllib.error.HTTPError as error:
        return error.code, error.headers.get("Content-Type", ""), error.read()


class Handler(BaseHTTPRequestHandler):
    cache_dir = "."

    def do_GET(self):
        url = upstream_url(self.path)
        if url is None:
            self.respond(404, "text/plain", b"unknown upstream")
            return
        key = hashlib.sha256(self.path.encode()).hexdigest()
        path = os.path.join(self.cache_dir, key[:2], key + ".json")
        if os.path.exists(path):
            with open(path) as f:
                entry = json.load(f)
            self.respond(entry["status"], entry["type"], base64.b64decode(entry["body"]))
            return
        if OFFLINE:
            self.respond(404, "text/plain", b"replay cache miss")
            return
        status, content_type, body = fetch(url)
        if status < 500:
            os.makedirs(os.path.dirname(path), exist_ok=True)
            tmp = path + ".tmp"
            with open(tmp, "w") as f:
                json.dump(
                    {"url": self.path, "status": status, "type": content_type,
                     "body": base64.b64encode(body).decode()},
                    f,
                )
            os.replace(tmp, path)
        self.respond(status, content_type, body)

    def respond(self, status, content_type, body):
        self.send_response(status)
        if content_type:
            self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *_):
        pass


def main():
    port, cache_dir = int(sys.argv[1]), sys.argv[2]
    os.makedirs(cache_dir, exist_ok=True)
    Handler.cache_dir = cache_dir
    ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()


if __name__ == "__main__":
    main()
