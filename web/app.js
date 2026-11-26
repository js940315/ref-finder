/* 레퍼런스 발굴기 — 회원 화면 로직.
 * 회원의 API 키는 이 브라우저(localStorage)에만 저장되고, 유튜브(googleapis.com) 말고 어디에도 보내지 않는다.
 */
(function () {
  "use strict";

  // 시험용: ?api=http://localhost:8765/youtube/v3/ 로 가짜 응답 서버를 쓸 수 있다.
  const API = new URLSearchParams(location.search).get("api") || "https://www.googleapis.com/youtube/v3/";
  const COST = { search: 100, videos: 1, channels: 1, playlistItems: 1 };
  const DAILY = 10000;
  const LS = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* 저장 못 해도 동작 */ } },
  };

  // ---------- 숫자·글자 ----------
  const nf = new Intl.NumberFormat("ko-KR");
  function fmtNum(n) {
    if (n === null || n === undefined) return "—";
    if (n >= 1e8) return (n / 1e8).toFixed(1).replace(/\.0$/, "") + "억";
    if (n >= 1e4) return (n / 1e4).toFixed(1).replace(/\.0$/, "") + "만";
    return nf.format(n);
  }
  function fmtX(x) { return x === null || x === undefined ? "—" : (x >= 100 ? Math.round(x) : x.toFixed(1)) + "배"; }
  function fmtDur(s) {
    if (!s) return "—";
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(sec).padStart(2, "0");
  }
  function ago(iso) {
    const d = (Date.now() - new Date(iso).getTime()) / 36e5;
    if (d < 24) return Math.max(1, Math.round(d)) + "시간 전";
    return Math.round(d / 24) + "일 전";
  }
  function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
  function decode(s) { const t = document.createElement("textarea"); t.innerHTML = s; return t.value; }
  function isoSeconds(d) {
    const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(d || "");
    if (!m) return 0;
    return (+m[1] || 0) * 86400 + (+m[2] || 0) * 3600 + (+m[3] || 0) * 60 + (+m[4] || 0);
  }
  function median(a) {
    if (!a.length) return null;
    const s = [...a].sort((x, y) => x - y), i = s.length >> 1;
    return s.length % 2 ? s[i] : (s[i - 1] + s[i]) / 2;
  }

  // ---------- 오늘 쓴 점수(이 브라우저 기준 추정) ----------
  // 유튜브 한도는 태평양 시간 자정에 초기화된다.
  function ptDay() { return new Date(Date.now() - 8 * 36e5).toISOString().slice(0, 10); }
  function usedToday() { const u = LS.get("quota", {}); return u.day === ptDay() ? u.used : 0; }
  function addUsed(n) { LS.set("quota", { day: ptDay(), used: usedToday() + n }); renderQuota(); }
  function renderQuota() {
    const u = usedToday(), el = document.getElementById("quota");
    if (!el) return;
    el.textContent = `오늘 이 브라우저에서 쓴 점수 약 ${nf.format(u)} / ${nf.format(DAILY)} (검색 약 ${Math.max(0, Math.floor((DAILY - u) / 100))}번 남음)`;
  }

  // ---------- 유튜브 API ----------
  class ApiError extends Error { constructor(msg, reason) { super(msg); this.reason = reason; } }
  async function yt(key, endpoint, params) {
    const q = new URLSearchParams({ ...params, key });
    let res;
    try { res = await fetch(API + endpoint + "?" + q.toString()); }
    catch (e) { throw new ApiError("인터넷 연결을 확인해 주세요.", "network"); }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const reason = data?.error?.errors?.[0]?.reason || data?.error?.status || "";
      const map = {
        quotaExceeded: "오늘 무료 한도(10,000점)를 다 썼습니다. 한국시간 오후 4~5시쯤 다시 채워집니다.",
        dailyLimitExceeded: "오늘 무료 한도를 다 썼습니다. 한국시간 오후 4~5시쯤 다시 채워집니다.",
        keyInvalid: "열쇠(API 키)가 맞지 않습니다. 다시 복사해 넣어 주세요.",
        API_KEY_INVALID: "열쇠(API 키)가 맞지 않습니다. 다시 복사해 넣어 주세요.",
        accessNotConfigured: "구글 클라우드에서 「YouTube Data API v3」 사용 설정을 켜 주세요.",
        forbidden: "이 열쇠로는 접근이 막혀 있습니다. 열쇠 제한 설정(웹사이트 주소)을 확인해 주세요.",
        ipRefererBlocked: "열쇠의 웹사이트 제한에 이 주소가 빠져 있습니다. 사용법 탭을 보세요.",
      };
      throw new ApiError(map[reason] || `유튜브 응답 오류 (${res.status} ${reason})`, reason);
    }
    addUsed(COST[endpoint] || 1);
    return data;
  }
  function chunk(a, n) { const out = []; for (let i = 0; i < a.length; i += n) out.push(a.slice(i, i + n)); return out; }
  async function fetchVideos(key, ids) {
    const out = {};
    for (const part of chunk(ids, 50)) {
      const d = await yt(key, "videos", { part: "snippet,statistics,contentDetails", id: part.join(","), maxResults: 50 });
      (d.items || []).forEach(it => out[it.id] = it);
    }
    return out;
  }
  async function fetchChannels(key, ids) {
    const out = {};
    for (const part of chunk(ids, 50)) {
      const d = await yt(key, "channels", { part: "snippet,statistics", id: part.join(","), maxResults: 50 });
      (d.items || []).forEach(it => out[it.id] = it);
    }
    return out;
  }
  async function channelMedians(key, channelIds, onProgress) {
    const recent = {};
    let i = 0;
    for (const ch of channelIds) {
      onProgress && onProgress(++i, channelIds.length);
      try {
        const d = await yt(key, "playlistItems", { part: "contentDetails", playlistId: "UU" + ch.slice(2), maxResults: 20 });
        recent[ch] = (d.items || []).map(it => it.contentDetails.videoId);
      } catch (e) { if (e.reason === "quotaExceeded" || e.reason === "dailyLimitExceeded") throw e; }
    }
    const all = Object.values(recent).flat();
    const stats = all.length ? await fetchVideos(key, all) : {};
    const med = {};
    for (const [ch, vids] of Object.entries(recent)) {
      const v = vids.filter(id => stats[id]).map(id => +stats[id].statistics.viewCount || 0);
      if (v.length >= 3) med[ch] = median(v);
    }
    return med;
  }
  function toRow(v, ch, med, keyword) {
    const st = v.statistics || {}, cst = (ch && ch.statistics) || {};
    const views = +st.viewCount || 0;
    const subs = cst.hiddenSubscriberCount || cst.subscriberCount === undefined ? null : +cst.subscriberCount;
    const m = med[v.snippet.channelId] || null;
    const th = v.snippet.thumbnails || {};
    return {
      videoId: v.id, title: v.snippet.title, channelId: v.snippet.channelId, channelTitle: v.snippet.channelTitle,
      publishedAt: v.snippet.publishedAt, thumb: (th.medium || th.high || th.default || {}).url || "",
      seconds: isoSeconds((v.contentDetails || {}).duration), views,
      likes: st.likeCount !== undefined ? +st.likeCount : null, comments: st.commentCount !== undefined ? +st.commentCount : null,
      subs, channelVideos: cst.videoCount !== undefined ? +cst.videoCount : null,
      ratio: subs ? Math.round(views / subs * 100) / 100 : null,
      channelMedian: m, outlier: m ? Math.round(views / m * 100) / 100 : null, keyword,
    };
  }
  async function keywordSearch(key, opt, onStatus) {
    const since = new Date(Date.now() - opt.days * 864e5).toISOString().replace(/\.\d+Z$/, "Z");
    const params = { part: "snippet", q: opt.q, type: "video", order: opt.order, publishedAfter: since,
      regionCode: "KR", relevanceLanguage: "ko", maxResults: 50 };
    if (opt.length === "short") params.videoDuration = "short"; // 4분 미만, 화면에서 3분 이하로 다시 거른다
    const ids = [];
    let token = null;
    for (let p = 0; p < opt.pages; p++) {
      onStatus(`검색 중… (${p + 1}/${opt.pages}쪽)`);
      const d = await yt(key, "search", token ? { ...params, pageToken: token } : params);
      (d.items || []).forEach(it => it.id && it.id.videoId && ids.push(it.id.videoId));
      token = d.nextPageToken;
      if (!token) break;
    }
    onStatus("조회수·구독자 확인 중…");
    const videos = await fetchVideos(key, [...new Set(ids)]);
    const channels = await fetchChannels(key, [...new Set(Object.values(videos).map(v => v.snippet.channelId))]);
    let med = {};
    if (opt.outlier) {
      // 평소 대비는 기본 필터를 통과할 채널만 잰다(점수 아끼기).
      const pass = Object.values(videos).filter(v => {
        const r = toRow(v, channels[v.snippet.channelId], {}, opt.q);
        return passBasic(r, readFilters());
      });
      const chs = [...new Set(pass.map(v => v.snippet.channelId))];
      med = await channelMedians(key, chs, (i, n) => onStatus(`채널 평소 성적 재는 중… (${i}/${n})`));
    }
    return Object.values(videos).map(v => toRow(v, channels[v.snippet.channelId], med, opt.q));
  }

  // ---------- 필터 ----------
  function readFilters() {
    const val = id => document.getElementById(id).value;
    return {
      maxSubs: +val("f-maxSubs") || Infinity,
      minViews: +val("f-minViews") || 0,
      minRatio: +val("f-minRatio") || 0,
      minOutlier: +val("f-minOutlier") || 0,
      length: val("f-length"),
      hidden: document.getElementById("f-hidden").checked,
      sort: val("f-sort"),
    };
  }
  function passBasic(r, f) {
    if (r.views < f.minViews) return false;
    if (r.subs === null) { if (!f.hidden) return false; }
    else {
      if (r.subs > f.maxSubs) return false;
      if (r.ratio < f.minRatio) return false;
    }
    if (f.length === "short" && !(r.seconds > 0 && r.seconds <= 180)) return false;
    if (f.length === "long" && !(r.seconds > 180)) return false;
    return true;
  }
  function applyFilters(rows, f) {
    const out = rows.filter(r => passBasic(r, f) && (!f.minOutlier || (r.outlier !== null && r.outlier >= f.minOutlier)));
    const keyFn = { ratio: r => r.ratio ?? -1, outlier: r => r.outlier ?? -1, views: r => r.views, recent: r => +new Date(r.publishedAt) }[f.sort];
    return out.sort((a, b) => keyFn(b) - keyFn(a));
  }

  // ---------- 쇼츠 기획 메모 ----------
  function planMemo(r) {
    const title = decode(r.title);
    return [
      `[레퍼런스] ${title}`,
      `링크: https://www.youtube.com/watch?v=${r.videoId}`,
      `채널: ${decode(r.channelTitle)} (구독 ${fmtNum(r.subs)}명)`,
      `성적: 조회 ${fmtNum(r.views)} · 구독 대비 ${fmtX(r.ratio)} · 채널 평소 대비 ${fmtX(r.outlier)} · 길이 ${fmtDur(r.seconds)} · ${ago(r.publishedAt)} 공개`,
      ``,
      `■ 직접 보고 적기 (제목만 보고 추측하지 않기)`,
      `- 첫 2초에 무엇이 나오나: `,
      `- 중간에 바뀌는 지점(반전·킥): `,
      `- 마지막 장면(제목이 약속한 결말): `,
      `- 댓글에서 가장 많이 반응한 부분: `,
      ``,
      `■ 내 쇼츠로 바꾸기`,
      `- 같은 효과를 낼 내 원본(직접 찍었거나 사용 허락된 것): `,
      `- 내 첫 2초: `,
      `- 내 결말: `,
      `- 제목 후보 3개: `,
      ``,
      `※ 레퍼런스 영상은 구성 분석용입니다. 영상을 내려받아 다시 올리지 마세요.`,
    ].join("\n");
  }

  // ---------- 그리기 ----------
  let currentRows = [];
  function render(rows) {
    currentRows = rows;
    const f = readFilters();
    const list = applyFilters(rows, f);
    const box = document.getElementById("results");
    document.getElementById("count").textContent = rows.length
      ? `전체 ${nf.format(rows.length)}개 중 조건에 맞는 ${nf.format(list.length)}개` : "";
    if (!rows.length) { box.innerHTML = ""; return; }
    if (!list.length) { box.innerHTML = `<p class="empty">조건에 맞는 영상이 없습니다. 위 조건을 조금 풀어 보세요.</p>`; return; }
    box.innerHTML = list.map((r, i) => `
      <article class="card">
        <a class="thumb" href="https://www.youtube.com/watch?v=${esc(r.videoId)}" target="_blank" rel="noopener">
          ${r.thumb ? `<img src="${esc(r.thumb)}" alt="" loading="lazy">` : ""}
          <span class="dur">${fmtDur(r.seconds)}</span>
        </a>
        <div class="body">
          <a class="title" href="https://www.youtube.com/watch?v=${esc(r.videoId)}" target="_blank" rel="noopener">${esc(r.title)}</a>
          <a class="ch" href="https://www.youtube.com/channel/${esc(r.channelId)}" target="_blank" rel="noopener">${esc(r.channelTitle)} · 구독 ${fmtNum(r.subs)}${r.subs === null ? "(숨김)" : ""}</a>
          <div class="stats">
            <span class="pill strong" title="조회수 ÷ 구독자 수">구독 대비 ${fmtX(r.ratio)}</span>
            <span class="pill" title="이 영상 조회수 ÷ 이 채널 최근 20편 조회수 중앙값">평소 대비 ${fmtX(r.outlier)}</span>
            <span class="pill">조회 ${fmtNum(r.views)}</span>
            <span class="pill muted">${ago(r.publishedAt)}</span>
          </div>
          <button class="memo" data-i="${i}">쇼츠 기획 메모 복사</button>
        </div>
      </article>`).join("");
    box.querySelectorAll(".memo").forEach(b => b.addEventListener("click", async () => {
      const text = planMemo(list[+b.dataset.i]);
      try { await navigator.clipboard.writeText(text); b.textContent = "복사했습니다"; }
      catch (e) { prompt("아래 내용을 복사하세요", text); }
      setTimeout(() => b.textContent = "쇼츠 기획 메모 복사", 1500);
    }));
  }
  function setStatus(msg, isErr) {
    const el = document.getElementById("status");
    el.textContent = msg || "";
    el.className = isErr ? "status err" : "status";
  }

  // ---------- 탭: 주제별 ----------
  let topicData = null, topicSel = "all";
  async function loadTopics() {
    setStatus("오늘의 주제별 목록을 불러오는 중…");
    try {
      const res = await fetch("data/topics.json", { cache: "no-cache" });
      if (!res.ok) throw new Error(res.status);
      topicData = await res.json();
    } catch (e) {
      setStatus("주제별 목록을 아직 만들지 않았거나 불러오지 못했습니다. 키워드 탭은 쓸 수 있습니다.", true);
      return;
    }
    const chips = document.getElementById("topic-chips");
    const all = [{ id: "all", name: "전체" }, ...topicData.topics];
    chips.innerHTML = all.map(t => `<button class="chip${t.id === topicSel ? " on" : ""}" data-id="${esc(t.id)}">${esc(t.name)}</button>`).join("");
    chips.querySelectorAll(".chip").forEach(b => b.addEventListener("click", () => {
      topicSel = b.dataset.id;
      chips.querySelectorAll(".chip").forEach(x => x.classList.toggle("on", x === b));
      showTopic();
    }));
    const when = new Date(topicData.generatedAt).toLocaleString("ko-KR", { month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" });
    document.getElementById("topic-meta").textContent = `${when} 기준 · 최근 ${topicData.days}일 공개 영상${topicData.sample ? " · ⚠ 예시 데이터(실제 아님)" : ""}`;
    setStatus("");
    showTopic();
  }
  function showTopic() {
    if (!topicData) return;
    render(topicSel === "all" ? topicData.videos : topicData.videos.filter(v => v.topic === topicSel));
  }

  // ---------- 탭 전환 ----------
  let tab = "topic", keywordRows = [];
  function switchTab(t) {
    tab = t;
    document.querySelectorAll(".tab").forEach(b => b.classList.toggle("on", b.dataset.tab === t));
    document.querySelectorAll(".panel").forEach(p => p.hidden = p.dataset.panel !== t);
    document.getElementById("filters").hidden = t === "guide";
    document.getElementById("results-wrap").hidden = t === "guide";
    setStatus("");
    if (t === "topic") { topicData ? showTopic() : loadTopics(); }
    if (t === "keyword") render(keywordRows);
    LS.set("tab", t);
  }

  // ---------- 시작 ----------
  function init() {
    document.querySelectorAll(".tab").forEach(b => b.addEventListener("click", () => switchTab(b.dataset.tab)));
    // 필터 기억
    const saved = LS.get("filters", null);
    const ids = ["f-maxSubs", "f-minViews", "f-minRatio", "f-minOutlier", "f-length", "f-sort"];
    if (saved) ids.forEach(id => { if (saved[id] !== undefined) document.getElementById(id).value = saved[id]; });
    if (saved && saved["f-hidden"] !== undefined) document.getElementById("f-hidden").checked = saved["f-hidden"];
    const onFilter = () => {
      const s = {}; ids.forEach(id => s[id] = document.getElementById(id).value);
      s["f-hidden"] = document.getElementById("f-hidden").checked;
      LS.set("filters", s);
      render(currentRows);
    };
    ids.concat("f-hidden").forEach(id => document.getElementById(id).addEventListener("change", onFilter));
    document.getElementById("f-reset").addEventListener("click", () => {
      const def = { "f-maxSubs": "50000", "f-minViews": "50000", "f-minRatio": "5", "f-minOutlier": "0", "f-length": "all", "f-sort": "ratio" };
      Object.entries(def).forEach(([k, v]) => document.getElementById(k).value = v);
      document.getElementById("f-hidden").checked = false;
      onFilter();
    });

    // 열쇠
    const keyEl = document.getElementById("k-key");
    keyEl.value = LS.get("apiKey", "");
    document.getElementById("k-save").addEventListener("click", () => {
      LS.set("apiKey", keyEl.value.trim());
      setStatus(keyEl.value.trim() ? "열쇠를 이 브라우저에 저장했습니다." : "저장된 열쇠를 지웠습니다.");
    });
    document.getElementById("k-show").addEventListener("change", e => keyEl.type = e.target.checked ? "text" : "password");

    // 키워드 검색
    const costEl = document.getElementById("k-cost");
    const updateCost = () => {
      const pages = +document.getElementById("k-pages").value;
      const out = document.getElementById("k-outlier").checked;
      const base = pages * 102;
      costEl.textContent = out
        ? `이번 검색 예상 점수: 약 ${base + 40}~${base + 130}점 (평소 대비 계산 포함, 맞는 채널 수에 따라 달라짐)`
        : `이번 검색 예상 점수: 약 ${base}점`;
    };
    ["k-pages", "k-outlier"].forEach(id => document.getElementById(id).addEventListener("change", updateCost));
    updateCost();
    document.getElementById("k-form").addEventListener("submit", async e => {
      e.preventDefault();
      const key = keyEl.value.trim();
      const q = document.getElementById("k-q").value.trim();
      if (!key) { setStatus("먼저 무료 열쇠(API 키)를 넣어 주세요. 「사용법」 탭에 받는 방법이 있습니다.", true); return; }
      if (!q) { setStatus("검색어를 넣어 주세요.", true); return; }
      LS.set("apiKey", key);
      const btn = document.getElementById("k-go");
      btn.disabled = true;
      try {
        keywordRows = await keywordSearch(key, {
          q, days: +document.getElementById("k-days").value, order: document.getElementById("k-order").value,
          pages: +document.getElementById("k-pages").value, outlier: document.getElementById("k-outlier").checked,
          length: readFilters().length,
        }, m => setStatus(m));
        setStatus(keywordRows.length ? "" : "검색 결과가 없습니다.");
        render(keywordRows);
      } catch (err) {
        setStatus(err.message || String(err), true);
      } finally { btn.disabled = false; }
    });

    renderQuota();
    switchTab(LS.get("tab", "topic"));
  }

  // 시험에서 쓸 수 있게 일부를 내보낸다.
  window.RefFinder = { applyFilters, passBasic, planMemo, isoSeconds, median };
  document.addEventListener("DOMContentLoaded", init);
})();
