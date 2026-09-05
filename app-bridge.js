// ══════════════════════════════════════════════════════════════════════
//  app-bridge.js — 오잉게임 플랫폼 브리지 (OING_PLATFORM v4)
//
//  이 파일은 "웹에서는 아무 일도 하지 않는 stub"이다.
//  index.html·상점 페이지는 IS_APP(=!!window.Capacitor)일 때만 아래 훅을 호출하므로,
//  웹(oinggame.com)에서는 여기 있는 어떤 코드도 실행되지 않는다.
//
//  실제 구현(AdMob·Play 결제·이메일 문의·오프라인 SDK)은 앱 빌드에서
//  코덱스가 이 파일을 대체해 채운다. 계약은 PLATFORM_HOOKS.md 참고.
//
//  v4 (2026-09-05) — 운영 결정 "랭킹 합침·기록 보존, 앱 젤리샵 켬(인앱결제)":
//   · leaderboard.*(Play 게임즈 리더보드)·records.*(앱 로컬 기록) 훅 제거.
//     앱도 웹과 같은 닉네임·서버 세션·Firebase 랭킹·user_stats 를 쓴다.
//   · ui.applyAppPolicy 는 더 이상 젤리샵 DOM 을 걷어내지 않는다(후원·후기·문의 게시판만).
//   · iap.* 신설 — 커스텀샵 현금 상품을 Google Play 결제로 받는다.
//
//  ⚠️ 이 파일은 반드시 index.html 의 module script 보다 먼저 로드돼야 한다.
//     상점 페이지(shop-v2-preview.html, custom-shop-preview.html)도 같은 파일을 로드한다.
//
//  ⚠️ 광고·문의·결제 훅은 no-op 이라도 안전하다(없으면 그 기능만 빠진다).
//     그러나 firebase.loadLocalSdk() 만은 예외다 — 앱에서 이게 SDK 를 돌려주지
//     않으면 게임이 아예 뜨지 않는다. 앱 빌드는 반드시 실제 구현으로 덮어써야 한다.
// ══════════════════════════════════════════════════════════════════════
window.OING_PLATFORM = window.OING_PLATFORM || {
  apiVersion: 4,

  ads: {
    // 앱 광고 초기화 — 실패해도 게임 실행을 막지 않는다.
    initialize: async () => {},
    // 클래식 한 판 완료 기록 (한 판당 정확히 1회). 자유모드는 포함되지 않는다.
    recordClassicGameComplete: () => {},
    // '한 판 더' 직후, startGame() 직전. 3판마다 전면광고를 띄우고 닫힌 뒤 resolve.
    beforeReplay: async () => {},
    // 'ranking' | 'records' | null — 랭킹·내 기록 화면에서만 배너 표시.
    setBannerPlacement: () => {},
  },

  iap: {
    // 앱 전용 — Google Play 결제. sku 는 playBilling.js PLAY_SKUS 와 같은 상품 ID,
    // orderId 는 submitCustomOrder 가 돌려준 주문 번호(obfuscatedProfileId 로 심어 보낸다).
    // 성공 시 { purchaseToken, productId, orderId } 를 resolve, 취소·실패는 reject.
    // 웹 stub 에는 purchase 가 없다 — 상점 페이지는 typeof purchase === 'function' 으로 판별한다.
    isAvailable: async () => false,
  },

  ui: {
    // 앱 정책 적용 — 후원(카카오페이)·후기·문의 게시판 DOM 제거. 젤리샵은 남긴다(v4).
    // ⚠️ #rankModeFriends 는 DOM 에서 삭제하지 말고 CSS 로만 숨긴다
    //    (setActiveRankModeBtn() 이 계속 참조한다). v4 에서는 친구 랭킹도 앱에서 쓴다.
    applyAppPolicy: () => {},
  },

  support: {
    // 앱 전용 — 이메일 문의 화면 열기.
    openEmail: () => {},
  },

  firebase: {
    // 앱 전용 — 번들된 오프라인 Firebase SDK(./vendor/firebase-sdk.js)를 import 해
    // 모듈 객체를 반환한다. index.html 이 그 객체에서 심볼을 구조 분해하므로
    // firebase-app / firestore / auth / functions 의 export 를 모두 갖고 있어야 한다.
    // 실패 시 gstatic 폴백 금지 — 오프라인 실행 보장이 깨진다.
    // ⚠️ stub 은 null 을 반환한다. 앱은 반드시 실제 구현으로 덮어써야 한다.
    loadLocalSdk: async () => null,
  },
};
