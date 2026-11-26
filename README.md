# 레퍼런스 발굴기

구독자는 적은데 조회수가 터진 유튜브 영상을 주제별·키워드별로 찾고, 쇼츠 기획 메모로 바꿔 주는 무료 도구.
만든 날: 2026-11-26.

## 구조 (운영비 0원)

| 부분 | 누가 점수를 쓰나 | 파일 |
|---|---|---|
| 오늘의 주제별 목록 | 운영자 열쇠 1개, 하루 1회 약 2,000~3,500점 | `builder/build_topics.py`, `builder/topics_config.json` |
| 키워드로 찾기 | 회원 각자의 무료 열쇠 (회원마다 하루 10,000점) | `web/app.js` |
| 화면 | 정적 웹페이지, 서버 없음 | `web/index.html`, `web/style.css`, `web/privacy.html` |
| 매일 자동 갱신·배포 | GitHub Actions + GitHub Pages (무료) | `.github/workflows/daily_topics.yml` |

회원 열쇠는 회원 브라우저(localStorage)에만 저장되고 googleapis.com 말고는 어디에도 가지 않는다.

## 고르는 기준

- 구독 대비 = 조회수 ÷ 구독자 수
- 평소 대비 = 조회수 ÷ 그 채널 최근 20편 조회수 중앙값
- 필터: 구독자 최대, 조회수 최소, 구독 대비 최소, 평소 대비 최소, 길이(쇼츠 3분 이하/롱폼), 기간, 정렬
- 구독자 숨김 채널은 기본 제외(켤 수 있음). 유튜브가 구독자를 반올림해 주므로 배수는 대략치.

## 운영자가 할 일

1. 이 도구 전용 구글 클라우드 프로젝트를 새로 만들고 YouTube Data API v3 를 켠 뒤 API 키를 만든다.
   (다른 채널 업로드에 쓰는 프로젝트와 섞지 않는다. 한도가 같이 깎인다.)
2. GitHub 에 새 공개 저장소를 만들고 이 폴더를 올린다.
3. 저장소 Settings → Secrets and variables → Actions → `REF_FINDER_API_KEY` 에 1번 키를 넣는다.
4. Settings → Pages → Source 를 「GitHub Actions」로 둔다.
5. Actions 탭에서 `daily-topics` 를 한 번 수동 실행 → 나온 주소를 회원에게 나눠 준다.
6. 주제·검색어를 바꾸려면 `builder/topics_config.json` 만 고친다. 검색어 1개 = 하루 100점.

## 내 컴퓨터에서 돌려 보기

```bash
cd builder && REF_FINDER_KEY_FILE=~/키파일경로 python3 build_topics.py --topics idol --max-keywords 1
```

```bash
python3 -m http.server 18766 --directory web
```

## 실제 열쇠 없이 시험

```bash
python3 test/mock_youtube.py 18765
```

```bash
cd builder && REF_FINDER_API_BASE=http://127.0.0.1:18765/youtube/v3/ REF_FINDER_API_KEY=testkey python3 build_topics.py
```

화면은 `http://localhost:18766/?api=http://127.0.0.1:18765/youtube/v3/` 로 열면 키워드 검색도 가짜 서버로 간다.
가짜 서버로 만든 목록에는 화면에 「예시 데이터(실제 아님)」가 뜬다.
**지금 `web/data/topics.json` 은 가짜 예시 데이터다. 배포 전에 실제 키로 다시 만든다.**

## 지킬 것 (YouTube API 약관)

- 화면 아래 YouTube 약관·Google 개인정보처리방침 링크와 `privacy.html` 을 지우지 않는다.
- 받은 숫자는 매일 덮어쓴다(30일 넘게 보관 금지).
- 열쇠를 여러 개 만들어 한도를 늘리는 방식은 약관 위반. 모자라면 구글에 한도 증량 심사를 신청한다.
- 영상 내려받기 기능은 넣지 않는다. 레퍼런스는 구성 분석용.

## 다음 단계 (아직 안 함)

- 쇼츠 만들기: 내 원본 + 받아쓰기(Whisper) + 자르기·자막(ffmpeg) + 무료 TTS. 대본 AI 는 쓴 만큼 소액.
- 회원 수가 많아지면 키워드 검색 결과를 공유 저장(캐시)하는 작은 서버, 한도 증량 심사.
