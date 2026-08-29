// ══════════════════════════════════════════════════════════════════════
//  app-bridge.js — 오잉게임 플랫폼 브리지 (OING_PLATFORM v3)
//
//  이 파일은 "웹에서는 아무 일도 하지 않는 stub"이다.
//  index.html 은 IS_APP(=!!window.Capacitor)일 때만 아래 훅을 호출하므로,
//  웹(oinggame.com)에서는 여기 있는 어떤 코드도 실행되지 않는다.
//
//  실제 구현(AdMob·Play 게임즈·이메일 문의·오프라인 SDK)은 앱 빌드에서
//  코덱스가 이 파일을 대체해 채운다. 계약은 PLATFORM_HOOKS.md 참고.
//
//  ⚠️ 이 파일은 반드시 index.html 의 module script 보다 먼저 로드돼야 한다.
//     (index.html 상단에 <script src="./app-bridge.js"></script> 로 연결됨)
//
//  ⚠️ 광고·리더보드·문의 훅은 no-op 이라도 안전하다(없으면 그 기능만 빠진다).
//     그러나 firebase.loadLocalSdk() 만은 예외다 — 앱에서 이게 SDK 를 돌려주지
//     않으면 게임이 아예 뜨지 않는다. 앱 빌드는 반드시 실제 구현으로 덮어써야 한다.
// ══════════════════════════════════════════════════════════════════════
window.OING_PLATFORM = window.OING_PLATFORM || {
  apiVersion: 3,

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

  leaderboard: {
    // 앱 전용 — Play 게임즈에 점수 제출. 실패해도 결과 화면은 정상 동작해야 한다.
    submitClassicScore: async () => {},
    // 앱 전용 — Play 게임즈에서 랭킹 조회. null 반환 시 빈 상태를 보여준다.
    loadScores: async () => null,
  },

  records: {
    // 앱 전용 로컬 기록 저장 — 앱은 웹 updateUserStats() 경로를 타지 않으므로
    // 이걸 저장하지 않으면 앱 '내 기록'이 영원히 빈 화면이 된다.
    // Firebase(rankings·weekly_rankings·user_stats)에는 절대 쓰지 않는다.
    //  result = { score, maxCombo, clearCount, sessionCats, playTimeSeconds, completedAt }
    recordClassicResult: () => {},
    // 앱 '내 기록' 화면이 읽는 스냅샷 (동기 반환).
    //  { displayName, iconUrl, stats: { playCount, totalPlayTime, firstPlayed, lastPlayed,
    //    lastScore, bestScore, bestCombo, totalCats, recentScores, daysPlayed, streak, lastPlayDate } }
    getSnapshot: () => null,
  },

  ui: {
    // 앱 정책 적용 — 상점·후원·후기·문의 게시판 DOM 제거.
    // ⚠️ #rankModeFriends 는 DOM 에서 삭제하지 말고 CSS 로만 숨긴다
    //    (setActiveRankModeBtn() 이 계속 참조한다).
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
