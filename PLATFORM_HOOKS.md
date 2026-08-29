# OING_PLATFORM 훅 계약 (apiVersion: 1)

오잉게임은 **웹(oinggame.com)** 과 **안드로이드 앱(오잉게임 클래식)** 이 같은
`index.html` 을 공유한다. 플랫폼별로 달라야 하는 동작은 전부 이 문서의 훅을 통해서만
분기한다.

> **이 문서는 index.html 과 app-bridge.js 사이의 계약이다.**
> 훅 이름·인자·반환 형식을 이 문서 수정 없이 임의로 바꾸면 앱이 조용히 망가진다.
> 변경 절차는 맨 아래 「계약 변경 절차」를 따른다.

---

## 0. 기본 규칙

### 플랫폼 판별

```js
const IS_APP = !!window.Capacitor;
```

**이 한 줄만 쓴다.** User-Agent 판별 금지.

### 로드 순서

`app-bridge.js` 는 반드시 module script 보다 **먼저** 로드된다.

```html
<script src="./app-bridge.js"></script>
<script type="module">
  const IS_APP = !!window.Capacitor;
  const PLATFORM = window.OING_PLATFORM;
  if (IS_APP && (!PLATFORM || PLATFORM.apiVersion !== 1)) {
    throw new Error('OING_PLATFORM v1이 필요합니다.');
  }
  …
</script>
```

### 웹에서의 동작

웹에서는 `IS_APP === false` 이므로 **아래 훅이 단 한 번도 호출되지 않는다.**
웹의 게임·상점·후원·후기·문의 기능은 훅 도입 전과 완전히 동일하게 동작한다.

`app-bridge.js` 는 웹에서 아무 일도 하지 않는 no-op stub 이다.
(앱이 실수로 실제 브리지 없이 빌드돼도 게임이 예외로 죽지 않도록 no-op 구현을 갖고 있다.
 실제 앱 빌드는 이 파일을 전부 덮어써야 한다.)

### 공통 실패 원칙

**모든 훅은 실패해도 게임 진행을 막지 않는다(fail-open).**
훅 호출부는 전부 `try`/`catch` 또는 `.catch()` 로 감싸여 있고, 실패 시 `console.warn` 만 남긴다.
단 하나의 예외는 **랭킹**으로, 앱에서 Play 게임즈 조회·제출이 실패해도
**Firebase 랭킹으로 폴백하지 않는다**(아래 3·4번 참고).

---

## 1. `PLATFORM.ads.recordClassicGameComplete()`

| 항목 | 내용 |
|---|---|
| 인자 | 없음 |
| 반환 | 없음 |
| 호출 시점 | `endGame()` 안, 최종 점수가 확정되고 결과 패널을 채우기 직전 |
| 호출 횟수 | **한 판당 정확히 1회** (`gameEnding` 플래그가 중복 실행을 막는다) |
| 목적 | 전면광고 주기 계산용 완료 판수 기록 및 다음 광고 예열 |
| 실패 처리 | `try`/`catch` 로 감싸 무시. 게임 결과 표시에 영향 없음 |

**주의**

- 중도 포기·튜토리얼은 `endGame()` 을 타지 않으므로 카운트되지 않는다.
- 게임 로직·점수 계산에 어떤 영향도 주면 안 된다.

---

## 2. `await PLATFORM.ads.beforeReplay()`

| 항목 | 내용 |
|---|---|
| 인자 | 없음 |
| 반환 | `Promise<void>` — 광고가 닫힌 뒤 resolve |
| 호출 시점 | 결과 화면 `#resultRestartBtn`('한 판 더') 클릭 직후, `startGame()` **직전** |
| 목적 | 완료 3판마다 전면광고 표시 |
| 실패 처리 | `catch` 후 그대로 다음 판 시작 (게임을 막지 않는다) |

**호출 순서 (index.html 구현 그대로)**

```js
#resultRestartBtn 클릭
  → await PLATFORM.ads.beforeReplay()
  → switchTab('game')
  → startGame()
```

**금지**

- **첫 판 종료 후 광고 금지** — 신규 유저 첫인상이 광고면 그대로 이탈한다.
- 결과 화면이 나타나는 순간의 자동 광고 금지.
- 게임 진행 중 광고 금지.

---

## 3. `PLATFORM.ads.setBannerPlacement(placement)`

| 항목 | 내용 |
|---|---|
| 인자 | `'ranking'` \| `'records'` \| `null` |
| 반환 | 없음 |
| 호출 시점 | 화면 전환마다 |
| 목적 | 랭킹·내 기록 화면에서만 네이티브 배너 표시 |
| 실패 처리 | `appBanner()` 헬퍼가 `try`/`catch` 로 감싼다 |

index.html 은 직접 호출하지 않고 헬퍼를 쓴다.

```js
function appBanner(placement) {
  if (!IS_APP) return;
  try { PLATFORM.ads.setBannerPlacement(placement); } catch (e) { … }
}
```

**현재 연결된 호출 지점**

| 위치 | 값 |
|---|---|
| `switchTab('game')` | `null` |
| `switchTab(랭킹)` | `'ranking'` |
| `openMyInfoOverlay()` | `'records'` |

**⛔ 절대 배너를 띄우면 안 되는 곳**

플레이 화면, 보드 주변, 힌트·섞기 버튼 주변.
이 게임은 보드를 **손가락으로 드래그**해서 조작하므로 하단 배너를 깔면
오클릭이 대량 발생하고 무효 트래픽으로 AdMob 계정이 정지될 수 있다.

**미완 항목** — 오버레이(내 기록·도움말·일시정지 등)를 **닫을 때** 이전 화면 값으로
되돌리는 호출은 아직 없다. `applyAppPolicy()` 단계에서 오버레이 닫기 핸들러에
`setBannerPlacement` 복원을 붙이거나, v2에서 index.html 에 추가한다.

---

## 4. `await PLATFORM.leaderboard.loadScores(options)`

| 항목 | 내용 |
|---|---|
| 인자 | `{ period: 'weekly' \| 'all', collection: 'public' }` |
| 반환 | 아래 형식 또는 `null` |
| 호출 시점 | 앱에서 랭킹 화면을 렌더할 때 (`renderRankingInner` 최상단) |
| 목적 | 앱 랭킹을 Google Play 게임즈에서 가져온다 |
| 실패 처리 | `catch` 후 `null` — **Firebase 랭킹으로 폴백하지 않고** 빈 상태를 보여준다 |

**반환 형식**

```js
{
  playerName: string,
  playerId: string,
  scores: [
    {
      rank: number,
      score: number,
      displayName: string,
      playerId: string,
      iconUrl: string,
      isCurrentPlayer: boolean,
      timestamp: number
    }
  ],
  currentScore: { …위와 동일…, isCurrentPlayer: true } | null
}
```

**앱에서 사용하지 않는 것**

Firebase `rankings` · `weekly_rankings` · 웹 닉네임 랭킹 · 친구 랭킹 · Firebase 폴백.

**미완 항목** — index.html 의 `renderAppLeaderboard(data)` 는 현재 `#rankList` 에
**기본 목록 렌더까지만** 구현돼 있다. 웹의 시상대(1~3위) 연출 통합은 앱 실기기에서
실제 Play 게임즈 데이터를 보며 마감한다. 데이터 계약(위 형식)은 확정이다.

---

## 5. `await PLATFORM.leaderboard.submitClassicScore(score)`

| 항목 | 내용 |
|---|---|
| 인자 | `score` — 0 이상의 정수형 최종 점수 |
| 반환 | `Promise<void>` |
| 호출 시점 | `endGame()` 안, 최종 점수 확정 직후 (1번 훅 바로 다음) |
| 목적 | 앱 점수를 Play 게임즈 리더보드에 제출 |
| 실패 처리 | `.catch()` 로 경고만 — 결과 화면·재시작은 정상 동작 |

**중요**

- 앱 랭킹은 기존 웹 기록 없이 **새로 시작**한다.
- 앱 점수를 Firebase `rankings` / `weekly_rankings` 에 저장하지 않는다.
- Play 게임즈 제출 실패 시 **Firebase 랭킹으로 폴백 금지**.

> 참고: 웹의 점수 등록은 닉네임 입력(`#submitScore` 버튼) 흐름을 그대로 쓴다.
> 앱은 Play 게임즈가 신원을 제공하므로 그 흐름을 타지 않고 `endGame()` 에서 바로 제출한다.

---

## 6. `PLATFORM.ui.applyAppPolicy()`

| 항목 | 내용 |
|---|---|
| 인자 | 없음 |
| 반환 | 없음 |
| 호출 시점 | module script 실행 완료 후 다음 틱 (모든 DOM 리스너 연결 완료 시점), **1회** |
| 목적 | 앱에서 상점·후원·후기·기존 문의 게시판 DOM 제거 |
| 실패 처리 | `try`/`catch` 로 감싸 무시 |

**DOM 제거 대상 (app-bridge.js 가 담당)**

`#jellyShopBtn` · `#jellyBalanceBtn` · `#skinOpenBtn` · `#supportTopBtn` ·
`#donateLink` · `#snackBtn` · 젤리 상점 오버레이 · 후원 오버레이 · 스킨 구매 오버레이 ·
카카오페이 외부 링크 · `#contactOverlay` · `#feedbackBoardOverlay` ·
`#feedbackWriteOverlay` · `#myFeedbackOverlay` · `#replyNotifyBanner` ·
`.review-entry-chip` · `#reviewBoardOverlay` · `#reviewWriteOverlay` · `#reviewPromptCard`

`#contactBtnGame` 은 **제거하지 않는다.** 앱에서 이메일 문의 버튼으로 재사용한다.

**DOM 제거만으로는 부족하다.** index.html 이 아래 함수 진입부에 직접 앱 가드를 갖고 있다.

| 함수 | 앱 동작 |
|---|---|
| `openJellyShop()` | 즉시 `return` |
| `openDonateOverlay()` | 즉시 `return` |
| `openSkinOverlay()` | 즉시 `return` |
| 랭킹 `.rank-bubble-empty` 클릭 | 즉시 `return` (상점 유도 차단) |
| `renderFeedbackBoard()` | 즉시 `return` |
| `openMyFeedbackDetail()` | 즉시 `return` |
| `checkUnreadReply()` | 즉시 `return` |
| `refreshReviewEntryChip()` | 즉시 `return` |
| `openReviewBoard()` | 즉시 `return` |
| `openReviewWrite()` | 즉시 `return` |
| `maybeShowReviewPrompt()` | 즉시 `return` |
| `showReviewPromptCard()` | 즉시 `return` |

> **웹에서는 위 기능이 전부 그대로 동작한다.** 상점·후원은 웹에서 합법이며
> (사업자등록 보유, Google Play 결제 정책은 앱에만 적용) 계속 사용한다.

---

## 7. `PLATFORM.support.openEmail()`

| 항목 | 내용 |
|---|---|
| 인자 | 없음 |
| 반환 | 없음 |
| 호출 시점 | 앱에서 `openContactOverlay()` 호출 시 (웹 오버레이 대신) |
| 목적 | 공개 게시판·오픈채팅 대신 이메일 작성 화면 열기 |

**이메일 정보 (app-bridge.js 가 사용)**

- 받는 주소: `takea@naver.com`
- 제목: `오잉게임 클래식 문의`
- 본문 기본값:
  ```
  문의 내용을 적어주세요.

  앱: 오잉게임 클래식
  ```

index.html 구현:

```js
function openContactOverlay() {
  if (IS_APP) { PLATFORM.support.openEmail(); return; }
  // 웹: 기존 문의 오버레이
}
```

---

## 8. `await PLATFORM.ads.initialize()`

| 항목 | 내용 |
|---|---|
| 인자 | 없음 |
| 반환 | `Promise<void>` |
| 호출 시점 | `PLATFORM.ui.applyAppPolicy()` **직후**, 같은 틱 |
| 목적 | AdMob 초기화 |
| 실패 처리 | `.catch()` 로 경고만 — **광고 초기화 실패가 게임 실행을 막아서는 안 된다** |

---

## 9. `await PLATFORM.firebase.loadLocalSdk()` — ⚠️ v1 미사용

**계약은 예약돼 있으나 index.html 은 이 훅을 아직 호출하지 않는다.**

### 보류 사유

현재 index.html 은 Firebase 심볼 **24개**를 gstatic 에서 정적 `import` 하고,
그 심볼들을 코드 **259곳**에서 직접 호출한다(`doc` 75회, `getDoc` 53회, `setDoc` 32회 …).
원래 제안대로 `firestoreSdk.doc(...)` 형태의 네임스페이스 객체로 바꾸면
**라이브 서비스 중인 코드 259곳을 수정**해야 한다. 위험 대비 이득이 맞지 않는다.

또한 이 작업 환경에서는 gstatic 접근이 차단돼 있어 **Firebase 로딩 경로 변경을
실행 검증할 수 없다.** 검증 불가능한 변경을 라이브 게임에 넣지 않는다.

### 권장 구현 방안 (v2에서 적용)

호출부 259곳을 **하나도 건드리지 않는** 방법이 있다 — 동적 `import()` 로 URL만 바꾸고
구조 분해 이름은 그대로 유지한다(모듈 최상위 `await` 사용 가능).

```js
const FB_BASE = IS_APP
  ? await PLATFORM.firebase.localSdkBase()   // 앱: './vendor/'
  : 'https://www.gstatic.com/firebasejs/12.15.0/';

const { initializeApp } = await import(FB_BASE + 'firebase-app.js');
const { getFirestore, collection, getDocs, doc, setDoc, getDoc, updateDoc,
        orderBy, query, limit, deleteDoc, addDoc, increment, where, runTransaction }
  = await import(FB_BASE + 'firebase-firestore.js');
const { getAuth, signInAnonymously, onAuthStateChanged, signInWithCustomToken }
  = await import(FB_BASE + 'firebase-auth.js');
const { getFunctions, httpsCallable }
  = await import(FB_BASE + 'firebase-functions.js');
```

이 방식은 import 문 **5줄만** 바뀌고 호출부 259곳은 그대로다.
대신 훅 이름이 `loadLocalSdk()` → `localSdkBase()`(경로 문자열 반환)로 바뀌므로
**계약 변경 절차를 거쳐 확정한 뒤** 적용한다.

앱에서 로컬 SDK 로드가 실패해도 **gstatic CDN 으로 폴백하지 않는다**(오프라인 실행 보장).

---

## 10. 도메인 리다이렉트 안전장치

`sbp37.github.io/oing/` → `oinggame.com` 이사 리다이렉트는 **앱에서 절대 실행되면 안 된다.**
앱은 에셋 번들이라 이사 대상이 아니고, 여기서 리다이렉트가 돌면 앱이 브라우저로 튕겨나간다.

`<head>` 최상단 이사 스크립트 첫 줄에 가드가 있다.

```js
(function () {
  var NEW_ORIGIN = 'https://oinggame.com';
  var OLD_HOST = 'sbp37.github.io';
  if (window.Capacitor) return;   // ← 앱: 아무것도 하지 않음
  …
})();
```

**index.html 의 외부 이동 코드 전수 점검 결과 (v1 기준)**

| 위치 | 상태 |
|---|---|
| 이사 스크립트 `location.replace` ×2 | ✅ `window.Capacitor` 가드 안 |
| `#tipBtn` → `location.href = 'tip-1.html'` | ✅ 상대경로 (앱 번들 내부 파일) |

동기화 스크립트는 매번 이 점검을 자동으로 수행해, 가드 없는
`location.replace` / `location.href =` / `window.location` 이 추가되면 실패해야 한다.

---

## 계약 변경 절차

훅 이름·인자·반환 형식은 **이 문서를 함께 고치지 않고 바꾸지 않는다.**

1. 변경이 필요하면 먼저 이 문서에서 해당 항목을 고치고 `apiVersion` 을 올린다.
2. `app-bridge.js` 의 `apiVersion` 을 같은 값으로 올린다.
3. index.html 의 버전 검사(`PLATFORM.apiVersion !== 1`)를 새 값으로 고친다.
4. 앱 저장소를 동기화하고 실기기에서 확인한다.

`apiVersion` 이 맞지 않으면 앱은 시작 시점에 즉시 예외를 던진다.
**조용히 망가지는 것보다 시끄럽게 죽는 편이 낫다**는 의도적 설계다.

---

## 저장소 경계

| 저장소 | 역할 |
|---|---|
| `sbp37/oinggame` | **게임 단일 원본** — 웹 서비스 + 앱의 원본. 클로드·코덱스 모두 수정 가능 |
| `sbp37/oing-classic-app` | 앱 껍데기. `www/` 는 **직접 수정 금지**, 동기화로만 갱신 |
| `sbp37/oing` | 옛 저장소. **둘 다 수정 금지** — 도메인 이사 브리지가 동작 중 |

작업 전 최신 `main` 을 받고, 별도 브랜치에서 작업한 뒤 반영한다.
같은 화면·기능을 동시에 수정하게 되면 먼저 알린다.
