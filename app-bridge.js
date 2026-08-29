// ══════════════════════════════════════════════════════════════════════
//  app-bridge.js — 오잉게임 플랫폼 브리지 (OING_PLATFORM v1)
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
//  ⚠️ stub 이지만 no-op 구현을 갖추고 있다. 앱이 실수로 실제 브리지 없이
//     빌드되더라도 게임이 예외로 죽지 않고 "광고·리더보드만 없는 상태"로
//     동작하게 하기 위한 안전장치다. 실제 앱은 이걸 전부 덮어써야 한다.
// ══════════════════════════════════════════════════════════════════════
window.OING_PLATFORM = window.OING_PLATFORM || {
  apiVersion: 1,

  ads: {
    // 앱 광고 초기화 — 실패해도 게임 실행을 막지 않는다.
    initialize: async () => {},
    // 클래식 한 판 완료 기록 (한 판당 정확히 1회). 전면광고 주기 계산용.
    recordClassicGameComplete: () => {},
    // '한 판 더' 직후, startGame() 직전. 3판마다 전면광고를 띄우고 닫힌 뒤 resolve.
    beforeReplay: async () => {},
    // 'ranking' | 'records' | null — 랭킹·내 기록 화면에서만 배너 표시.
    setBannerPlacement: () => {},
  },

  leaderboard: {
    // 앱 전용 — Play 게임즈에 점수 제출. 실패해도 결과 화면은 정상 동작해야 한다.
    submitClassicScore: async () => {},
    // 앱 전용 — Play 게임즈에서 랭킹 조회. null 반환 시 index.html 이 렌더를 건너뛴다.
    loadScores: async () => null,
  },

  ui: {
    // 앱 정책 적용 — 상점·후원·후기·문의 게시판 DOM 제거.
    applyAppPolicy: () => {},
  },

  support: {
    // 앱 전용 — 이메일 문의 화면 열기.
    openEmail: () => {},
  },

  firebase: {
    // 앱 전용 — 번들된 오프라인 Firebase SDK 로드.
    // ⚠️ v1 시점에는 index.html 이 이 훅을 호출하지 않는다. 사유는 PLATFORM_HOOKS.md 9번 참고.
    loadLocalSdk: async () => null,
  },
};
