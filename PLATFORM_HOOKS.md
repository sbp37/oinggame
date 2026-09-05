# OING_PLATFORM 훅 계약 (apiVersion: 4)

> **v4 (2026-09-05) — 운영 결정 「랭킹 합침·기록 보존, 앱 젤리샵 켬(인앱결제)」**
> · 앱도 웹과 **같은** 닉네임·서버 세션(`startSession`/`submitScore`)·Firebase 랭킹·`user_stats`·젤리샵을 쓴다.
> · `leaderboard.*`(Play 게임즈 리더보드)·`records.*`(앱 로컬 기록) 훅은 **계약에서 제거**됐다.
> · `ui.applyAppPolicy()` 는 젤리샵 DOM 을 더 이상 걷어내지 않는다.
> · `iap.*` 신설 — 커스텀샵 현금 상품을 Google Play 결제로 받는다(§11).
> · 웹 기존 기록은 전부 보존된다. 앱 유저는 웹과 같은 익명 uid + 닉네임으로 랭킹에 들어간다.

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
  if (IS_APP && (!PLATFORM || PLATFORM.apiVersion !== 4)) {
    throw new Error('OING_PLATFORM v4가 필요합니다.');
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
(v3 의 "앱 랭킹은 Play 게임즈 단독, Firebase 폴백 금지" 예외는 v4 에서 사라졌다 — 앱 랭킹이 곧 Firebase 랭킹이다.)

---

## 1. `PLATFORM.ads.recordClassicGameComplete()`

| 항목 | 내용 |
|---|---|
| 인자 | 없음 |
| 반환 | 없음 |
| 호출 시점 | `endGame()` 안, **`isFreeMode` 분기 뒤** — 자유모드는 카운트하지 않는다 |
| 호출 횟수 | **한 판당 정확히 1회** (`gameEnding` 플래그가 중복 실행을 막는다) |
| 목적 | 전면광고 주기 계산용 완료 판수 기록 및 다음 광고 예열 |
| 실패 처리 | `try`/`catch` 로 감싸 무시. 게임 결과 표시에 영향 없음 |

**주의**

- **자유모드(`isFreeMode`)는 카운트하지 않는다.** 훅이 자유모드 `return` 뒤에 놓여 있다.
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

**복원** — 오버레이를 닫으면 `restoreAppBanner()` 가 "지금 보이는 화면" 기준으로 되돌린다.

```js
function restoreAppBanner() {
  if (!IS_APP) return;
  const rank = document.getElementById('panelRank');
  appBanner(rank && rank.classList.contains('active') ? 'ranking' : null);
}
```

현재 `closeMyInfoOverlay()` 끝에 연결돼 있다. 다른 오버레이(도움말·일시정지 등)는
배너를 건드리지 않으므로 복원이 필요 없다.

---

## 4·5. ~~`PLATFORM.leaderboard.*`~~ — v4 에서 제거

Play 게임즈 리더보드 조회(`loadScores`)·제출(`submitClassicScore`)은 **더 이상 호출되지 않는다.**
앱의 `endGame()` 은 `ads.recordClassicGameComplete()` 만 부르고 웹과 같은 Firebase 저장 경로를
그대로 탄다(닉네임 등록 → `submitScore` 서버 세션 판정 → `rankings`/`weekly_rankings`).
랭킹 화면도 웹의 시상대·주간·전체·친구 탭을 그대로 그린다. `#rankModeFriends` 도 앱에서 쓴다.

앱 저장소의 브리지는 이 두 훅을 **지워도 되고 남겨도 된다** — index.html 이 부르지 않는다.
Play 게임즈 로그인·업적은 이 계약 밖이다(앱이 독자적으로 쓰는 건 무방).

**기록 보존** — 통합 전 앱의 Play 게임즈 점수는 Firebase 로 옮기지 않는다(운영 결정: 웹 기록 보존, 앱은 웹 체계로 새 출발).

---

## 6. `PLATFORM.ui.applyAppPolicy()`

| 항목 | 내용 |
|---|---|
| 인자 | 없음 |
| 반환 | 없음 |
| 호출 시점 | module script 실행 완료 후 다음 틱 (모든 DOM 리스너 연결 완료 시점), **1회** |
| 목적 | 앱에서 **후원(카카오페이)·후기·기존 문의 게시판** DOM 제거 — 젤리샵은 남긴다(v4) |
| 실패 처리 | `try`/`catch` 로 감싸 무시 |

**DOM 제거 대상 (app-bridge.js 가 담당) — v4**

`#donateLink` · `#snackBtn` · 후원 오버레이 · 카카오페이 외부 링크(`qr.kakaopay.com`) ·
`#contactOverlay` · `#feedbackBoardOverlay` · `#feedbackWriteOverlay` · `#myFeedbackOverlay` ·
`#replyNotifyBanner` · `.review-entry-chip` · `#reviewBoardOverlay` · `#reviewWriteOverlay` · `#reviewPromptCard`

**⛔ v4 에서 제거하면 안 되는 것(젤리샵 입구·잔액)** — `#supportTopBtn` · `#jellyShopBtn` · `#jellyBalanceBtn` ·
`#skinOpenBtn`(젤리샵으로 연결됨) · 젤리 상점 오버레이. 젤리는 출석·초대·환영으로만 얻는 무료 재화라
Play 결제 정책과 무관하고, 현금 상품은 §11 의 Play 결제로만 간다.
`#skinOverlay`(옛 유료 스킨 오버레이)는 index.html 의 `openSkinOverlay()` 가 앱에서 즉시 return 하므로 그대로 두면 된다.

`#contactBtnGame` 은 **제거하지 않는다.** 앱에서 이메일 문의 버튼으로 재사용한다.

**DOM 제거만으로는 부족하다.** index.html 이 아래 함수 진입부에 직접 앱 가드를 갖고 있다.

| 함수 | 앱 동작 |
|---|---|
| `openJellyShop()` | **v4: 웹과 동일하게 동작** (`shop-v2-preview.html?live=1` 로 이동) |
| `openDonateOverlay()` | 즉시 `return` |
| `openSkinOverlay()` | 즉시 `return` (옛 유료 스킨 오버레이 — 현금 상품은 §11 로) |
| 랭킹 `.rank-bubble-empty` 클릭 | **v4: 웹과 동일** (젤리샵 유도) |
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
  // 브리지가 실패해도 게임을 막지 않는다(fail-open).
  if (IS_APP) {
    try { PLATFORM.support.openEmail(); } catch (e) { console.warn('이메일 문의 열기 실패:', e); }
    return;
  }
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

## 9. `await PLATFORM.firebase.loadLocalSdk()`

| 항목 | 내용 |
|---|---|
| 인자 | 없음 |
| 반환 | Firebase 모듈 객체 (`firebase-app`/`firestore`/`auth`/`functions` export 를 모두 포함) |
| 호출 시점 | module script 최상단, Firebase 초기화 직전 |
| 목적 | 앱에서 번들된 오프라인 SDK(`./vendor/firebase-sdk.js`)를 쓴다 |
| 실패 처리 | **폴백 없음** — gstatic 으로 내려가면 오프라인 실행 보장이 깨진다 |

### 구현 (index.html)

정적 `import` 를 동적 `import()` 로 바꾸되 **구조 분해 이름을 그대로 유지**한다.
덕분에 코드 **259곳**의 호출부(`doc` 75회 · `getDoc` 53회 · `setDoc` 32회 …)는
하나도 바뀌지 않는다.

```js
let firebaseAppSdk, firestoreSdk, authSdk, functionsSdk;
if (IS_APP) {
  const sdk = await PLATFORM.firebase.loadLocalSdk();
  firebaseAppSdk = firestoreSdk = authSdk = functionsSdk = sdk;
} else {
  [firebaseAppSdk, firestoreSdk, authSdk, functionsSdk] = await Promise.all([
    import("https://www.gstatic.com/firebasejs/12.15.0/firebase-app.js"),
    import("https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js"),
    import("https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js"),
    import("https://www.gstatic.com/firebasejs/12.15.0/firebase-functions.js"),
  ]);
}
const { initializeApp } = firebaseAppSdk;
const { getFirestore, collection, getDocs, doc, setDoc, getDoc, updateDoc, orderBy,
        query, limit, deleteDoc, addDoc, increment, where, runTransaction } = firestoreSdk;
const { getAuth, signInAnonymously, onAuthStateChanged, signInWithCustomToken } = authSdk;
const { getFunctions, httpsCallable } = functionsSdk;
```

### app-bridge.js 쪽 요구사항

`loadLocalSdk()` 는 `./vendor/firebase-sdk.js` 를 import 해 **모듈 객체 하나**를
반환한다. index.html 이 그 객체에서 위 24개 심볼을 구조 분해하므로,
번들은 firebase-app · firestore · auth · functions 의 export 를 **모두** 갖고 있어야 한다.
하나라도 빠지면 해당 심볼이 `undefined` 가 되어 런타임에 터진다.

### App Check

`initializeAppCheck` / `ReCaptchaV3Provider` 정적 import 는 **제거했다.**
사용처가 전부 주석 처리된 죽은 import 였고, 그대로 두면 앱에서도 gstatic 을
강제로 불러 오프라인 실행이 깨진다. 나중에 App Check 를 켤 때는 위
Firebase 로드 블록에 함께 넣는다.

### ⚠️ 검증 한계

이 작업 환경은 gstatic 접근이 차단돼 있어 **웹 경로의 Firebase 로딩을 실제로
실행 검증하지 못했다.** 문법 검사와 gstatic 스텁 주입 테스트까지만 마쳤으므로,
배포 후 `oinggame.com` 에서 랭킹·점수 등록이 정상인지 한 번 확인해야 한다.

---

## 9-B. ~~`PLATFORM.records.*`~~ — v4 에서 제거

앱의 `endGame()` 이 더 이상 `return` 으로 끊기지 않고 웹의 `updateUserStats()` 를 그대로 타므로,
'내 기록'·레벨·오늘 목표는 웹과 같은 `user_stats`/로컬 통계에서 나온다. `recordClassicResult` /
`getSnapshot` 은 호출되지 않는다. `openMyInfoOverlay()` 도 닉네임 수정·기록 삭제·PIN/연결을 앱에서 숨기지 않는다.

**⚠️ v3 앱에 남아 있던 로컬 기록은 옮기지 않는다** — 통합 후 첫 판부터 웹 체계로 쌓인다.

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

## 11. `PLATFORM.iap.*` — Google Play 결제 (v4 신설)

앱 안에서 카카오페이 링크를 여는 것은 Play 결제 정책 위반이다. 커스텀샵(`custom-shop-preview.html`)의
현금 상품 3종은 앱에서 **반드시** 이 훅으로만 결제한다. 젤리샵(무료 재화)은 이 훅과 무관하다.

**상점 페이지도 `app-bridge.js` 를 로드한다** — `shop-v2-preview.html` · `custom-shop-preview.html` 상단에
`<script src="./app-bridge.js"></script>` 가 있다. 앱은 `!!window.Capacitor` 로 판별하고, 브리지가
`apiVersion >= 4` 이며 `typeof iap.purchase === 'function'` 일 때만 결제를 연다. 옛(v3) 브리지로 빌드된 앱은
젤리샵에서 커스텀샵 링크가 숨겨지고, 커스텀샵을 직접 열어도 "앱 업데이트 후 결제" 로 막힌다.

### `await PLATFORM.iap.purchase({ sku, orderId })`

| 항목 | 내용 |
|---|---|
| 인자 | `sku`: Play Console 상품 ID(아래 표) · `orderId`: `submitCustomOrder` 가 돌려준 주문 번호 |
| 반환 | `{ purchaseToken, productId, orderId }` — 결제 성공 시. 취소·실패는 **reject** |
| 요구사항 | `orderId` 를 `obfuscatedProfileId`(BillingFlowParams.setObfuscatedProfileId) 로 심어 보낸다. 서버가 영수증의 이 값과 주문 번호를 대조한다 |
| 소비/확인 | **acknowledge 는 서버가 한다**(Developer API). 클라이언트에서 consume 하지 않는다 — 꾸미기는 비소모성이다 |

| 주문 종류(`orderType`) | SKU | 가격 |
|---|---|---|
| `cat` 고양이 스킨 | `oing_cat_990` | 990원 |
| `custom` 닉네임 효과 + 테두리 | `oing_custom_set_1990` | 1,990원 |
| `bundle` 모두 담기 | `oing_bundle_2980` | 2,980원 |

SKU 는 서버 `playBilling.js PLAY_SKUS` · 커스텀샵 `PLAY_SKU` 와 **세 곳이 같아야** 한다.

### 서버 검증 — `shopAction { action: 'redeemPlayPurchase', orderId, purchaseToken, productId }`

서버가 Google Play Developer API(`purchases.products.get`)로 영수증을 직접 조회해
`purchaseState === 0`, SKU ↔ 주문 종류 일치, 영수증의 `obfuscatedExternalProfileId === orderId`,
주문 uid === 호출자 uid, purchaseToken 미사용을 확인한 뒤 `buildFulfillmentPatch` 로 **즉시 발송**한다.
운영자 입금 확인 단계가 없다. 같은 토큰 재호출은 `duplicate: true` 로 무해하다.

### 운영자 설정 절차 (한 번만)

1. Play Console → 설정 → API 액세스 → 서비스 계정 연결, 권한 「주문 및 구독 보기·관리」.
2. 그 서비스 계정 JSON 키를 Firebase 시크릿으로: `firebase functions:secrets:set PLAY_BILLING_SA_KEY`
3. `functions/index.js` 의 `shopAction` onCall 옵션에 `secrets: ['PLAY_BILLING_SA_KEY']` 추가,
   패키지명은 `PLAY_PACKAGE_NAME` 환경변수(`.env`)로. **둘이 없으면 redeem 은 "아직 준비되지 않았어요" 로 거부**되고 웹엔 영향이 없다.
4. Play Console 에 위 SKU 3개를 비소모성 인앱 상품으로 등록(가격 동일).
5. 앱 브리지에 `iap.purchase` 구현(Play Billing Library 6+ 또는 Capacitor 결제 플러그인), 실기기에서 테스트 트랙으로 검증.

---

## 계약 변경 절차

훅 이름·인자·반환 형식은 **이 문서를 함께 고치지 않고 바꾸지 않는다.**

1. 변경이 필요하면 먼저 이 문서에서 해당 항목을 고치고 `apiVersion` 을 올린다.
2. `app-bridge.js` 의 `apiVersion` 을 같은 값으로 올린다.
3. index.html 의 버전 검사(`PLATFORM.apiVersion !== 4`)를 새 값으로 고친다.
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
