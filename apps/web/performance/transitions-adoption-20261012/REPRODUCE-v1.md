# 재현

`installation-v1.json`과 `installation-remote-readback-v1.json`으로 원본 ref와 설치 바이트를 확인한다. `sourceBefore`와 `sourceAfter`는 REPORT/source-manifest에 결속돼 있다. npm11.6.2 release install, Node24.21.0, Bun1.4.0, Playwright1.63.0/Chrome154를 사용한다. 저장된 원자료와 실패를 덮어쓰지 않는다.

작업 checkout의 apps/web에서 `bun test tests-unit/toast-retirement.test.ts`로 timer bound를 확인한다. Before commit은 현재 테스트를 별도 복제본에 복사해서 실행하면192 타이머 결함을 재현한다. Before commit 자체의 테스트 목록으로 이 새 결함 테스트가 있었다고 주장하지 않는다.

전체 `node scripts/run-unit-tests.mjs`, targeted eslint, `node scripts/run-typecheck.mjs --compiler parity`로 source를 검증한다. build_configured_motion_v3.mjs는 현재 checkout/원래 공개 환경 파일의 위치가 명시되어 있고 공개 build 설정만 RAM으로 읽는다. 다른 머신에서는 복사한 driver의 root/output/env-file 경로를 자신의 checkout으로 바꾸고 새 dist/output 이름을 쓴다. 인증 key를 증거에 저장하거나 프린트하지 않는다. 실제 Naver localhost SDK 권한과 public 설정은 별도 필요 조건이다.

기존 named dist를 유지한 채 `node performance/transitions-adoption-20261012/browser-motion-v4.mjs before <fresh-run-id> <before-dist>`와 `after <fresh-run-id> <after-dist>`를 각각 새 프로세스에서 실행한다. 현재 파일이 존재하는 run-id는 재사용하지 않는다. script는 본인이 연 localhost:3000만 사용/종료하고 occupied port는 fail closed다. 모바일 selector 오류로 실패한 v1/v2 대신 v4를 사용한다. `browser-motion-v5.mjs`는 마우스 swipe cancel/end까지 추가 검사한다. 둘 다 REST735/Auth401 fixture이며 service worker block/CPU4/cache off다. 원격 SDK/타일은 바꾸지 않는다. 휴대폰이나 기존 로그인 세션은 사용하지 않는다.

`aggregate-v1.py`는 고정한 before2..4/after0..2와 timer-before5, swipe-after3 입력으로 summary/source bindings를 생성한다. 동일 파일이 있으면 덮어쓰지 않으며 재실행은 별도 복제 패키지에서 한다. raw 파일 이름을 편의상 고쳐 쓰지 않는다. 두 fixture/runtime 모듈의 해시는 새 source manifest와 각 브라우저 run에 확인한다.

canonical-zero-v3/basis.json에 canonical scorer와 독립 validator의 정확한 인자·pin이 있다. scorer는 이미 존재하는 출력을 덮지 않는다. 바이트를 재검증할 때는 validator 명령을 재사용하고, scorer 재계산은 별도 빈 복제 패키지에 수행한다. v1/v2 실패 보존본을 수정해서 통과시키지 않는다.

패키지 전체 artifact-map은 docs/evidence의 별도 SHA pin과 backend/bin/verify_transitions_adoption_20261012.py로 검증한다. 외부 SDK·기기·field가 없는 환경에서 UI fixture 검사가 되더라도 그 범위 밖 성과로 보고하지 않는다.
