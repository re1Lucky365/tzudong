# 재현과 한계

source-manifest/FINAL은 Before73edf072와 Aftere3c710dc 및 실제 build receipt에 결속된다. 이 branch의 역사 Git 객체와 기존 public build settings가 필요하다. Node24.21.0/npm11.6.2/Bun1.4.0, Chrome154/Playwright1.63.0을 사용한다. 기존 환경·계정·전화는 바꾸지 않는다.

apps/web에서 `SCROLL_REVEAL_BASELINE=73edf0720d9ec3a8dcdfc1a102767ad52481cce6 bun test tests-unit/scroll-effects-browser.test.ts`는 역사 hook/CSS를 fixture로 직접 번들해 새 기준에서0pass/6fail을 재현한다. 원본 worktree를 복원/수정하지 않는다. `bun test tests-unit/scroll-effects-browser.test.ts`는 현재 source를 검증한다. fixture는 실제 React production component와 browser API를 사용하지만 앱 서버/실제 사용자 자료를 사용하지 않는다.

build_configured_scroll_v1.mjs는 공개 build 설정만 RAM으로 읽고 고정된 owned checkout/dist를 쓴다. 다른 머신은 복사한 driver의 root/output/env-file 위치와 새 dist/output 이름을 맞춘다. 공개 SDK localhost 권한이 없으면 실제 SDK 검증은 미검증이며 mock으로 바꿔 통과시키지 않는다.

`node performance/scroll-transitions-20261012/browser-scroll-map-v1.mjs before <fresh-id> <before-dist>` / `after <fresh-id> <after-dist>`로 각각 새 프로세스에서 실제 지도 pointer drags12회와 필터/공유/모션 감소를 확인한다. run-id 파일이 이미 있으면 덮지 않는다. localhost:3000의 기존 서비스를 점유하지 않으며 본인이 시작한 서버만 종료한다. 스크립트가 추적하는 selector count는 관련 없는 SDK selector를 포함하지 않는다. REST/Auth는 synthetic fixture이며 실제 Naver SDK/tiles는 그대로다. mouse pointer emulation을 물리 터치로 보고하지 않는다.

관련 lint와 native/compat parity, `node scripts/run-unit-tests.mjs`를 수행한다. 원시 실패는 보존한다. source diff check에서는 원본 로그의 trailing whitespace를 정규화하지 않으며 소스 파일만 별도로 검사한다. 패키지 전체는 artifact-map과 docs/evidence 별도 pin/독립 verifier로 검사한다. 검증 스크립트는 frozen 원자료를 수정하지 않는다.
