// ══════════════════════════════════════════════════════════════
//  앱인토스(Apps in Toss) 미니앱 설정 — `npx ait build` 가 이 파일을 읽는다.
//
//  · appName 은 케밥케이스여야 하고, 토스 콘솔에 등록한 앱 이름과 같아야 한다.
//    콘솔 이름이 다르면 AIT_APP_NAME=콘솔이름 npm run toss:build 로 덮어쓸 수 있다.
//  · webBundleDir 에 든 파일이 그대로 아티팩트에 담긴다. tools/build-toss-bundle.mjs 가
//    게임 실행에 필요한 파일만 toss-dist/ 로 모은다(어드민·테스트·SEO 부속 파일 제외).
//  · 산출물은 프로젝트 루트의 <appName>.ait — 토스 콘솔 '앱 출시'에 업로드한다.
//
//  만드는 법:  npm run toss:build
// ══════════════════════════════════════════════════════════════
import { defineConfig } from '@apps-in-toss/web-framework/config';

export default defineConfig({
  appName: process.env.AIT_APP_NAME || 'oinggame-classic',   // 토스 콘솔에 등록된 이름
  brand: {
    // 게임 메인 버튼과 같은 파랑 — 토스 안에서 앱 기본색으로 쓰인다.
    primaryColor: '#2F7EC9',
  },
  // 카메라·위치 같은 네이티브 권한은 하나도 안 쓴다. 필요해지면 여기에 추가한다.
  permissions: [],
  // 토스 상단 바 — 지금 화면(⋯ · ✕ 만 떠 있는 모습)과 같게 맞춘다.
  //  · 게임에 자체 탭바(메인·게임·랭킹·꾸미기)가 있어 토스 제목·뒤로가기는 겹치기만 한다.
  //  · 배경이 투명이라 콘텐츠가 상단 바 아래까지 올라온다. 그만큼은 index.html 의
  //    html.is-toss 규칙이 --toss-top(기본 56px) 으로 직접 비워 둔다.
  //  ⚠️ transparentBackground 를 false 로 바꾸면 토스가 알아서 자리를 잡아주므로,
  //    그때는 주소에 ?topinset=0 을 붙여 우리 여백을 꺼야 두 번 밀리지 않는다.
  navigationBar: {
    withBackButton: false,
    withHomeButton: false,
    withTitle: false,
    transparentBackground: true,
  },
  webBundleDir: 'toss-dist',
});
