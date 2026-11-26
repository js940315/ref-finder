"""가짜 YouTube Data API 서버 (시험 전용, 실제 데이터 아님).

  python3 mock_youtube.py 8765
  → http://localhost:8765/youtube/v3/{search,videos,channels,playlistItems}

같은 입력에는 항상 같은 가짜 값을 돌려준다. 키가 "bad" 면 keyInvalid, "empty" 면 quotaExceeded 를 흉내 낸다.
"""
import hashlib
import json
import sys
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse


def h(s, mod):
    return int(hashlib.md5(s.encode()).hexdigest(), 16) % mod


def channel_of(vid):
    return "UC" + "mockchannel" + str(h(vid, 40)).zfill(11)


def video(vid):
    ch = channel_of(vid)
    views = [3_000, 20_000, 80_000, 150_000, 600_000, 2_400_000][h(vid + "v", 6)] + h(vid, 9_999)
    secs = [18, 35, 58, 140, 420, 900][h(vid + "d", 6)]
    pub = datetime.now(timezone.utc) - timedelta(hours=2 + h(vid + "p", 160))
    return {
        "id": vid,
        "snippet": {
            "title": f"[예시] 가짜 영상 {vid[-4:]} — 반전 있는 장면 <b>&</b> 테스트",
            "channelId": ch,
            "channelTitle": f"예시채널{h(ch, 999)}",
            "publishedAt": pub.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "thumbnails": {"medium": {"url": "https://via.placeholder.invalid/320x180"}},
        },
        "statistics": {"viewCount": str(views), "likeCount": str(views // 40), "commentCount": str(views // 900)},
        "contentDetails": {"duration": f"PT{secs // 60}M{secs % 60}S" if secs >= 60 else f"PT{secs}S"},
    }


def channel(ch):
    subs = [800, 4_000, 9_000, 30_000, 120_000, 900_000][h(ch + "s", 6)]
    st = {"subscriberCount": str(subs), "videoCount": str(30 + h(ch, 300)), "hiddenSubscriberCount": h(ch, 10) == 0}
    if st["hiddenSubscriberCount"]:
        del st["subscriberCount"]
    return {"id": ch, "snippet": {"title": f"예시채널{h(ch, 999)}"}, "statistics": st}


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def send(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        u = urlparse(self.path)
        q = {k: v[0] for k, v in parse_qs(u.query).items()}
        ep = u.path.rsplit("/", 1)[-1]
        key = q.get("key", "")
        if key == "bad":
            return self.send(400, {"error": {"code": 400, "errors": [{"reason": "keyInvalid"}]}})
        if key == "empty":
            return self.send(403, {"error": {"code": 403, "errors": [{"reason": "quotaExceeded"}]}})
        if ep == "search":
            seed = q.get("q", "") + q.get("pageToken", "")
            n = int(q.get("maxResults", 5))
            items = [{"id": {"kind": "youtube#video", "videoId": "mock" + str(h(seed + str(i), 10**7)).zfill(7)}} for i in range(n)]
            page = int(q.get("pageToken", "0") or 0)
            return self.send(200, {"items": items, "nextPageToken": str(page + 1) if page < 2 else None})
        if ep == "videos":
            return self.send(200, {"items": [video(v) for v in q.get("id", "").split(",") if v]})
        if ep == "channels":
            return self.send(200, {"items": [channel(c) for c in q.get("id", "").split(",") if c]})
        if ep == "playlistItems":
            pl = q.get("playlistId", "")
            n = int(q.get("maxResults", 20))
            return self.send(200, {"items": [{"contentDetails": {"videoId": "mock" + str(h(pl + str(i), 10**7)).zfill(7)}} for i in range(n)]})
        return self.send(404, {"error": {"code": 404}})


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    ThreadingHTTPServer(("127.0.0.1", port), H).serve_forever()
