"""주제별 발굴 목록 생성기 (운영자용, 하루 한 번 실행).

운영자의 무료 YouTube Data API 키 하나로 주제별 「터진 영상」 후보를 미리 모아
web/data/topics.json 에 저장한다. 회원은 이 파일을 읽기만 하므로 회원 수와 상관없이
점수를 쓰지 않는다.

키는 다음 순서로 찾는다(코드·저장소에 키를 적지 않는다).
  1) 환경변수 REF_FINDER_API_KEY
  2) 환경변수 REF_FINDER_KEY_FILE 이 가리키는 파일

사용 예:
  python3 build_topics.py                       # 전체 주제
  python3 build_topics.py --topics idol --max-keywords 1   # 시험용 소량
  python3 build_topics.py --record ../test/fixtures         # 응답 기록(화면 시험용)
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import statistics
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
OFFICIAL_API = "https://www.googleapis.com/youtube/v3/"
# 시험 때만 가짜 서버 주소를 넣는다. 이때 결과에 「예시 데이터」 표시가 붙는다.
API = os.environ.get("REF_FINDER_API_BASE", OFFICIAL_API)
COST = {"search": 100, "videos": 1, "channels": 1, "playlistItems": 1}

# 후보로 남길 느슨한 기준. 화면에서 회원이 더 좁힌다.
LOOSE_MAX_SUBS = 300_000
LOOSE_MIN_VIEWS = 10_000
RECENT_UPLOADS = 20  # 채널 평소 성적을 잴 최근 영상 수


class QuotaError(RuntimeError):
    pass


class Client:
    def __init__(self, key: str, record_dir: Path | None = None):
        self.key = key
        self.used = 0
        self.record_dir = record_dir
        self.records: dict[str, list] = {k: [] for k in COST}

    def get(self, endpoint: str, **params):
        q = {k: v for k, v in params.items() if v is not None}
        q["key"] = self.key
        url = API + endpoint + "?" + urllib.parse.urlencode(q)
        try:
            with urllib.request.urlopen(url, timeout=30) as r:
                data = json.load(r)
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", "replace")
            reason = ""
            try:
                reason = json.loads(body)["error"]["errors"][0]["reason"]
            except Exception:
                pass
            if reason in ("quotaExceeded", "dailyLimitExceeded"):
                raise QuotaError("오늘 무료 한도를 다 썼습니다.") from None
            raise RuntimeError(f"{endpoint} 호출 실패 {e.code} {reason}") from None
        self.used += COST[endpoint]
        if self.record_dir is not None:
            self.records[endpoint].append(data)
        return data

    def save_records(self):
        if self.record_dir is None:
            return
        self.record_dir.mkdir(parents=True, exist_ok=True)
        for ep, items in self.records.items():
            merged = {"items": [it for d in items for it in d.get("items", [])]}
            (self.record_dir / f"{ep}.json").write_text(
                json.dumps(merged, ensure_ascii=False), encoding="utf-8")


def load_key() -> str:
    key = os.environ.get("REF_FINDER_API_KEY", "").strip()
    if not key and os.environ.get("REF_FINDER_KEY_FILE"):
        key = Path(os.environ["REF_FINDER_KEY_FILE"]).expanduser().read_text(encoding="utf-8").strip()
    if not key:
        sys.exit("API 키가 없습니다. REF_FINDER_API_KEY 또는 REF_FINDER_KEY_FILE 을 설정하세요.")
    return key


def iso_seconds(d: str) -> int:
    m = re.fullmatch(r"P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?", d or "")
    if not m:
        return 0
    days, h, mi, s = (int(x or 0) for x in m.groups())
    return days * 86400 + h * 3600 + mi * 60 + s


def chunks(seq, n=50):
    seq = list(seq)
    for i in range(0, len(seq), n):
        yield seq[i:i + n]


def fetch_videos(c: Client, ids):
    out = {}
    for part in chunks(ids):
        d = c.get("videos", part="snippet,statistics,contentDetails", id=",".join(part), maxResults=50)
        for it in d.get("items", []):
            out[it["id"]] = it
    return out


def fetch_channels(c: Client, ids):
    out = {}
    for part in chunks(ids):
        d = c.get("channels", part="snippet,statistics", id=",".join(part), maxResults=50)
        for it in d.get("items", []):
            out[it["id"]] = it
    return out


def channel_medians(c: Client, channel_ids):
    """채널별 최근 영상 조회수 중앙값(이번 영상 포함). 실패한 채널은 빠진다."""
    recent: dict[str, list[str]] = {}
    for ch in channel_ids:
        pl = "UU" + ch[2:]
        try:
            d = c.get("playlistItems", part="contentDetails", playlistId=pl, maxResults=RECENT_UPLOADS)
        except QuotaError:
            raise
        except RuntimeError:
            continue
        recent[ch] = [it["contentDetails"]["videoId"] for it in d.get("items", [])]
    all_ids = [v for vs in recent.values() for v in vs]
    stats = fetch_videos(c, all_ids) if all_ids else {}
    med = {}
    for ch, vids in recent.items():
        views = [int(stats[v]["statistics"].get("viewCount", 0)) for v in vids if v in stats]
        if len(views) >= 3:
            med[ch] = statistics.median(views)
    return med


def to_row(v, ch, med, topic_id, keyword):
    st = v.get("statistics", {})
    cst = ch.get("statistics", {}) if ch else {}
    views = int(st.get("viewCount", 0))
    hidden = bool(cst.get("hiddenSubscriberCount"))
    subs = None if hidden or "subscriberCount" not in cst else int(cst["subscriberCount"])
    m = med.get(v["snippet"]["channelId"])
    thumbs = v["snippet"].get("thumbnails", {})
    thumb = (thumbs.get("medium") or thumbs.get("high") or thumbs.get("default") or {}).get("url", "")
    return {
        "videoId": v["id"],
        "title": v["snippet"]["title"],
        "channelId": v["snippet"]["channelId"],
        "channelTitle": v["snippet"]["channelTitle"],
        "publishedAt": v["snippet"]["publishedAt"],
        "thumb": thumb,
        "seconds": iso_seconds(v.get("contentDetails", {}).get("duration", "")),
        "views": views,
        "likes": int(st["likeCount"]) if "likeCount" in st else None,
        "comments": int(st["commentCount"]) if "commentCount" in st else None,
        "subs": subs,
        "channelVideos": int(cst.get("videoCount", 0)) if cst else None,
        "ratio": round(views / subs, 2) if subs else None,
        "channelMedian": m,
        "outlier": round(views / m, 2) if m else None,
        "topic": topic_id,
        "keyword": keyword,
    }


def build(cfg, only_topics, max_keywords, c: Client):
    since = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=cfg["days"])).strftime("%Y-%m-%dT%H:%M:%SZ")
    hits: dict[str, tuple[str, str]] = {}  # videoId -> (topic, keyword)
    topics_out = []
    for t in cfg["topics"]:
        if only_topics and t["id"] not in only_topics:
            continue
        topics_out.append({"id": t["id"], "name": t["name"]})
        for kw in t["keywords"][:max_keywords]:
            d = c.get("search", part="snippet", q=kw, type="video", order="viewCount",
                      publishedAfter=since, regionCode=cfg["region"],
                      relevanceLanguage=cfg["language"], maxResults=50)
            for it in d.get("items", []):
                hits.setdefault(it["id"]["videoId"], (t["id"], kw))
            print(f"  검색 「{kw}」 {len(d.get('items', []))}개 (누적 {c.used}점)")

    videos = fetch_videos(c, hits.keys())
    channels = fetch_channels(c, {v["snippet"]["channelId"] for v in videos.values()})

    def loose_ok(v):
        ch = channels.get(v["snippet"]["channelId"])
        views = int(v["statistics"].get("viewCount", 0))
        cst = ch.get("statistics", {}) if ch else {}
        subs = None if cst.get("hiddenSubscriberCount") else int(cst.get("subscriberCount", 0) or 0)
        return views >= LOOSE_MIN_VIEWS and (subs is None or subs <= LOOSE_MAX_SUBS)

    cands = [v for v in videos.values() if loose_ok(v)]
    med = channel_medians(c, {v["snippet"]["channelId"] for v in cands})
    rows = [to_row(v, channels.get(v["snippet"]["channelId"]), med, *hits[v["id"]]) for v in cands]
    rows.sort(key=lambda r: -(r["ratio"] or 0))
    return topics_out, rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", default=str(HERE / "topics_config.json"))
    ap.add_argument("--out", default=str(HERE.parent / "web" / "data" / "topics.json"))
    ap.add_argument("--topics", nargs="*", help="이 주제 id 만 (시험용)")
    ap.add_argument("--max-keywords", type=int, default=99)
    ap.add_argument("--record", help="API 응답을 이 폴더에 기록 (화면 시험용)")
    a = ap.parse_args()

    cfg = json.loads(Path(a.config).read_text(encoding="utf-8"))
    c = Client(load_key(), Path(a.record) if a.record else None)
    try:
        topics, rows = build(cfg, set(a.topics or []), a.max_keywords, c)
    except QuotaError as e:
        sys.exit(f"중단: {e} (사용 {c.used}점). 기존 topics.json 은 그대로 둡니다.")
    out = {
        "generatedAt": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "days": cfg["days"],
        "quotaUsed": c.used,
        "sample": API != OFFICIAL_API,
        "topics": topics,
        "videos": rows,
    }
    p = Path(a.out)
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(".tmp")
    tmp.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    tmp.replace(p)
    c.save_records()
    print(f"완료: 후보 {len(rows)}개, 사용 {c.used}점 → {p}")


if __name__ == "__main__":
    main()
