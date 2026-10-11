# 재현

Node24.21.0/npm11.6.2/Bun1.4.0/Python3.12.14, Chrome154/Playwright1.63.0, Mac26.6.2 arm64에서 검사했다. Git history의592b1415/3fdc25d1/1c672aca/e3c710dc/cc14014d 객체와 각 pinned packet을 보존해야 한다. shallow checkout은 해당 history를 먼저 가져온다.

repo root에서 `python3 -m unittest backend.bin.tests.test_motion_evidence_verifiers`는 원본을 변경하지 않는 shared sparse 임시 checkout에서 normal/-O와 변조를 검사한다. PATH의 Node는24.x여야 하며, 없는 환경은 명시적 skip이다. `verify_readiness_followup_20261011.py`, `verify_readiness_ocr_20261011_v3.py`, `verify_transitions_adoption_20261012.py`, `verify_scroll_transitions_20261012.py`를 normal/-O로 실행할 수 있다. frozen Mac command를 그대로 실행할 필요는 없다.

apps/web에서 `bun test tests-unit/auth-user-continuation.test.ts`, `node scripts/run-unit-tests.mjs`, `npm run typecheck:parity`, 관련 ESLint를 실행한다. SQL/parser/publication source checks는 source-tests-v3의 다섯 unittest module을 사용한다. 운영 env/keys 또는 hosted target은 불필요하다.

build_configured_review_v2.mjs는 허용한 public build 설정만 사용한다. 다른 host는 driver의 root/env-file/output/dist 위치를 자신의 공개 설정·새 출력 이름으로 바꾼다. 원래 source/config/key를 수정하지 않는다. consumed dist나 출력은 덮어쓰지 않는다. build source hash와 실제 CSS gate를 보관한다.

브라우저: `node apps/web/performance/motion-delivery-review-20261012/browser-stamp-continuation-v9.mjs before <fresh-before-dist>` / `after <fresh-after-dist>`. 각 variant의 이름·output이 소비됐다면 복사한 새 run-ID driver를 사용한다. localhost3000이 점유됐으면 실패하며 남의 서버를 종료하지 않는다. 본인이 시작한 process만 종료한다. 9 fresh context(각 width3회)는 한 Chrome process 안의 종속 시도다. Auth는 client fixture이고 SSR은 credential 없는 local guest GET; 실제 로그인/운영 인증 증거가 아니다. Auth·REST provider writes는 fixture 밖으로 보내지 않는다. 화면·로그에 쿠키·token·headers·실제 사용자 응답을 저장하지 않는다.

PG17 driver는 기존 named isolated synthetic template의 존재/engine/빈 사용자·review/ports·network를 확인한다. 원본 database를 수정·reset/drop하지 않는다. fresh database 이름과 output/run-ID를 먼저 정한다. 실행된 v1/v2 이름은 소비됐으므로 새 driver 복사본에서 이를 바꾼다. 필요하면 동일 pinned Supabase17.6 fixture를 별도로 구성한다. 실제 운영 dump, 사진, key, 사용자를 복사하지 않는다. 원시 실패는 삭제하지 않는다.

artifact-map은 이 packet을 완전히 열거하고 docs/evidence의 detached SHA와 독립 verifier가 확인한다. source/result/history와 각 확인 범위를 따로 읽는다. 높은 시험 통과 수나 hash 검사 성공을 운영·메모리·field 성과로 해석하지 않는다.
