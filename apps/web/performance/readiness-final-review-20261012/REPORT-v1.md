# 최종 리뷰 수정

source6f9822f0053ab020c8f71234db4677d2c5dee3fa는 PR3147의 추가 발견3건을 수정한다. 새 계정의 사진 정리 요청을 버리지 않고, 일시적인 private image 읽기 실패를 명확한 부재와 구분하며, nightly runbook 수치를 canonical140 units/15 functions/22 policies로 맞췄다. 운영 writes·후보 배포0, physical/field/performance admission0이다.

| 흐름 | 환경·표본 수 | 지표 | Before | After | 절대 변화 | 상대 변화 | 노이즈·신뢰구간 | 판정 | 증거 경로 |
|---|---|---|---|---|---|---|---|---|---|
| A 정리 중 B 로그인 | 동일 Bun process의 통제한 지연 Promise, 실제 역사 callback/current utility 각1회 | B scan 및 pending feedback | A만 검사, B pending=false | A 종료 후 B 검사, B pending=true | 누락1→0 | 기능 교정, 속도 비율 미산정 | 결정적 direct boundary; React/실제 로그인 전체 흐름 증거 아님 | 통과 | boundary-comparison-v1.json, latest-owner-cleanup.test.ts |
| private image provider/read 오류 | 동일 direct handler, 합성6종 입력 | 잘못된404 | 5종 | 0종 | 5종 감소 | 해당 입력집합100% | 종속 단일 process; 실제 장애 발생률/CI 추정 없음 | 503 재시도 가능 상태와 명확한404 구분 | boundary-comparison-v1.json, focused-v2.log |
| public map/filter/share/모션 감소 | Chrome154, CPU4, cacheoff, synthetic REST735/Auth401, 실제 remote Naver SDK/tiles,3 viewport | 필수 기능·pageerror·전체 document scan | 기존 동결 scroll proof 참조 | 3 cases 통과, pageerror0, drags12회씩 전체 scan0 | 재회귀 없음 관찰 | 새로운 지연/heap 개선 주장 없음 | browser process1/3 종속 context; consoleCSP6/other4 남음 | 제한된 rendered regression 통과 | after-0.json, browser-scroll-v1.log |

Before는1893c854의 실제 private handler와 MY callback이다. 원본 바이트 hash를 보관하고 synthetic dependencies만 주입해 실행했다. 404→503의 HTTP 숫자 차이를 성능 개선으로 해석하지 않는다. 불리한 console/미검증 경계는 그대로 유지한다.

최신 owner runner는 활성 요청1개와 대기 요청 최대1개를 유지한다. A의 작업 중 B/C 전환은 최신 owner로 coalesce하고, 계정이 바뀌면 이전 계정의 explicit cancellation을 넘기지 않는다. 동일 owner 자동 중복은 합치되 명시적 retry는 보존한다. await된 RPC의 기존 owner 검사·RLS·durable queue·미확인 commit 미디어 보존을 그대로 사용한다. 메모리 제어 구조는 O(1), 실제 queued 작업의 시간은 기존 bounded cleanup 호출 비용에 의존한다. heap/처리량 실측 이득을 주장하지 않는다.

private handler는 database resolved error, credential/tenant/bucket/outage/timeout과 빈 성공 transport를503으로 반환한다. 알려진 StorageApiError의 명확한 NoSuchKey/404만404이며, 기존 invalid authoritative ID/path/blob 경계는 유지한다. 관리자 인증은 IO 전에 수행하고, fixed code/no-store/nosniff/no-referrer를 유지한다. 실제 credential이나 provider diagnostics를 응답·증거에 넣지 않는다.

full latest3450 pass/11 skip/0 fail, focused22 pass, native7.0.2/compat6.0.2 parity3147 inputs/diagnostics0, lint0, Next16.3.8 production build7TDnILuoFP30i7NpH0zxa와 actual route CSS0. 새 class 초기화를 render에서 수행한 최초 lint-v1의2 errors와 해당 build-v1을 보존했다. callback/effect 호출 시점으로 초기화를 옮긴 뒤 lint/focused/parity/full/build-v2를 재검증했다. 변경 중 진행한 검사를 현재 소스의 통과로 사용하지 않는다.

이전 motion-delivery-review packet의71개 원자료·해시는 변경하지 않았다. 시트 경합3/9→0/9 관찰과 timers/document-scan 결과는 별도의 역사 증거이며, 새 상태 분기 효과와 개선율을 합산하지 않는다. 해당 성능 범위의 canonical scorer/validator와 admission0도 유지한다.

operating-preflight-v1은 실제 project/team/alias의 rollback 후보1884f87e53c4567ead7c9a0fb394b09b91a70396/READY dpl_EUxJnWmDDozCSMWb2sqNSPgKJLM5를 기록한다. Supabase actual17.6/postgres nonsuper, manifest1963/hosted ledger86, 신규 owner/admin cleanup RPC와 private verification bucket 없음이다. 이는 조회 당시 상태이며 적용 전 다시 확인한다. 다른 담당자는 현재 운영 변경을 보류했다고 보고했다. 새 source/SQL/8-photo transfer/실제 사용자/서버 로그인·메모리 guard 성과는 아직 별도 완료 조건이다.

재현: apps/web에서 Bun1.4.0으로 `bun test tests-unit/latest-owner-cleanup.test.ts tests-unit/private-review-verification.test.ts tests-unit/mypage-crud-contract.test.ts`, Node24.21.0으로 `scripts/run-unit-tests.mjs`, npm11.6.2의 typecheck:parity와 관련 ESLint를 수행한다. repo root에서 Bun으로 compare-boundaries-v1.mjs를 실행한다. consumed output/run-ID는 새 복사본에 바꾸고 원자료를 덮지 않는다. build_configured_review_v2.mjs의 public env/root/dist/output은 자신의 설정·새 이름을 사용한다. browser-scroll-map-v1.mjs는 별도 owned localhost3000/Chrome과 공개 SDK localhost 허용을 필요로 한다. 다른 서버·폰·인증 상태를 변경하지 않는다. 원본 실패, detached map, source history와 결과 범위를 함께 검증한다.
