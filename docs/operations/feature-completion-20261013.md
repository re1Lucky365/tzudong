# OCR·Gemini 스토리보드·롱폼 준비의 전달 상태

이 문서는 격리 후보의 구현·로컬 검증 장부다. 운영 DB 적용·배포·실제 사용자 처리 완료를 뜻하지 않는다. 원문 전체 요구는 `project-request-todos-20261009.md`에 유지한다.

| 대상 | 구현과 선택 근거 | 확인한 증거 | 남은 단계 |
| --- | --- | --- | --- |
| 영수증 OCR | fingerprint별 내구성 claim, dispatch 전후 구분, 불확실한 응답 재조회, 서버 결과 revision을 UI·save RPC·readback에 결합 | v5 source 18개 SHA 일치; 72/72 tests·819 assertions 및 같은 범위 독립 재실행; 실제 catalog 복제 PG17.6에서 stale revision·G014·immutable metadata·create/delete 경합 통과 | 운영 bucket/metadata 및 live Gemini·저장·청구 readback |
| 영수증 업로드 | OCR과 upload에 같은 준비 완료 File 사용, 5MiB 초과·압축 실패는 ReviewModal의 quota/provider 진입 전에 거부 | 5–8MiB 실패 fixture의 quota/provider 각각 0; source-defined bucket 5MiB | 직접 OCR API는 기존 8MiB 한도를 유지; 실제 Storage overwrite 권한과 직접 S3 authority는 별도 검증 |
| 스토리보드 | 새 workflow는 Gemini-only, metadata readiness 전에는 claim하지 않음, 같은 worker의 정확한 text/image 모델 쌍 요구 | 131 tests; exact PG17.6 두 predecessor 체인 각각 30 assertions; 실제 catalog G014·6테이블 archive guard·구 RPC late resume 차단 | hosted migration/deploy/live Gemini·기존 큐 cutover readback |
| 과거 스토리보드 | 문서·자산·편집·역사 읽기·export 유지, 이전 비Gemini 실행과 수동 import는 중지 | archive history digest 보존, active legacy job terminal 전환 | 실제 데이터와 운영 큐의 cutover readback |
| 롱폼 준비 | 완료 videos/streams에서 Shorts·live/upcoming/post_live 제외, 변경 가능한 입력을 1회 캡처하고 resume에 immutable snapshot 사용 | eligible 1,071·Shorts 81·caption 9·missing 1,062; 작성자25/25 및 마지막 독립3/3; 2-target mutable read13회→resume0회 | 전체 claude-video 시각·음성 분석 0/1,071; 공유 OSK materialization·운영 graph 갱신 |
| 운영 hold readback | requireAdmin 선행, 현재 immutable deployment ID·commit·hold를 runtime에서 확인하고 collector와 교차검증 | 78 관련 tests·206 assertions; Next route export 계약 수정 후 관련9 tests·1,193 assertions·production build 통과; 원격/운영 호출0 | 원래15분 창에서 in-flight 부재와7개 writer fence·Gemini 정책을 보존하는 rollback 확인; launch held |

데이터 보호 불변식은 `저장 revision = 현재 결과 revision`, `generation admission ∈ {0,1}`, `준비 완료 verification bytes ≤ 5×1024²`, `legacy workflow의 컷오버 이후 INSERT/UPDATE = 거부`로 표현한다. 읽기 작업량은 caption source 수에 대해 `O(N+C+K)`이며 고정 fixture의 13→0 읽기 횟수는 결정적 동작 검증이다. 처리 시간·RSS·금액 절감의 측정으로 해석하지 않는다.

실제 catalog 복제 통합 검증은 최종 frozen 두 migration을 적용했으나 실패했다. 새 service-role RPC와 trigger EXECUTE 8건이 G014 허용 목록과 불일치했고, predecessor의 authenticated UPDATE 정책이 immutable Storage 전제와 충돌했다. baseline `g014_pg17_workflow_owner_membership_denied`도 fixture actor/역할과 구분해 조사해야 한다. 실패 증빙 `pg17-existing-catalog-replay-final-frozen.json` SHA는 `4851f0dab3cb200b1b613b46b6da5eba58852b07733c5e4750784d0503b14fbf`이며 원본 clone hash 전후는 같고 소유 container cleanup은 확인됐다. 후속 additive SQL로 수정 중이며 기존 applied/frozen SQL과 이 실패 영수증을 덮어쓰지 않는다.

모델 ID는 text `gemini-3.8-flash`, image `gemini-3.1-flash-image`와 `gemini-3-pro-image`다. 공식 이름 지원과 기존 역사 canary는 현재 후보의 프로젝트 접근·청구·live 실행 성공을 대신하지 않는다. 이 후보 검증의 provider·hosted DB·Storage 요청과 배포는 0회다. 서로 겹치는 테스트·여러 predecessor 체인의 assertions를 하나의 독립 표본 수로 합산하지 않는다.

## 2026-10-13 카탈로그 결함 수정과 결합 검증

기존 실패 영수증을 보존한 채 후속 SQL `20261013190100`·`20261013190200`을 추가했다. G014의 effective RPC matrix 불일치는 8→0건이다. 7 public wrapper와 7 private helper를 owner·SECURITY DEFINER·반환형·search_path·EXECUTE·allowlist까지 행별 대조했다. 새 immutable verification 정책은 authenticated upsert를 차단하고 privileged metadata UPDATE/DELETE도 trigger로 거부한다. 이전 DELETE OR 우회 가설은 반증됐다: 실제 permissive owner와 restrictive safe-delete의 조합은 owner AND safe-delete였으며 참조 중 authenticated DELETE는 이미 0행이었다. 새 DELETE trigger는 RLS 우회자와 create/delete 경합의 보호를 추가한다.

최종 `pg17-existing-catalog-replay-delete-races-success-20261013.json` SHA `4de818ec45f4a69c1fe714fc07dbea6180af5930edd42eacf124d6b05093f356`은 status passed·findings 0이다. PostgreSQL 17.6 고정 이미지, 23개 source·590,651bytes의 단일 snapshot, migration ledger 101건, 4 feature SQL exact rollback, 원본 catalog 2,633,559bytes/hash 전후 동일·role catalog 동일·소유 container 제거를 확인했다. create-wins는 DELETE 거부·리뷰/객체 보존, delete-wins는 tombstone 생성·후속 리뷰 연결 거부이며 실제 lock wait도 관측했다. 이는 합성 DB 검증이고 직접 S3 bytes 권한·hosted bucket metadata·계정 삭제와 guarded-admin 전체 흐름의 직접 실행은 포함하지 않는다.

구 실행 UI `LegacyStoryboardReference.tsx`는 10,167줄/399,551bytes에서 10줄/434bytes의 Gemini 진입점 alias로 바뀌었다. 제거량은 10,157줄(99.90%)·399,117bytes(99.89%)이며 전수 source 크기 비교라 표본 CI는 적용하지 않는다. 외부 active runtime caller는 0건이고 역사 문서·자산·export·provenance decode를 보존했다. runtime 속도·번들 크기 개선의 측정은 아니다.

TypeScript parity는 repo 밖의 임의 입력을 허용하는 대신 `backend/utils/provider-budget.mjs` 한 경로만 canonical 논리 이름으로 결속한다. source identity·내용 SHA 전후 비교와 양쪽 compiler 실제 사용을 요구하고 symlink/인접 checkout/.env·임의 backend 입력을 거부한다. 31 regressions·699 assertions, native 7.0.2/compat 6.0.2 진단 0, 논리 입력 3,147개를 확인했다. 논리 이름 SHA `7dd12e20d90bd545032160d953537aa34645a8973ed3aff05bf889fec3ccc2c6`, 내용 SHA `9e023d84ba89e597648c46190f9f4e674c8c20038c68c08392ad41b21a3375eb`이다.

첫 결합 전체 runner는 22개 실패를 확인했고 현재 Gemini/revision 계약과 종료 race를 보존하여 fixtures를 수정했다. 후속 general group은 3,418 pass·3 skip·1 fail이었다. 마지막 실패는 제거된 legacy horizontal owner 3개가 allowlist에 남아 있었으며 exact source/allowlist equality를 유지한 채 stale 항목만 제거했고 관련 10/10이 통과했다. 최종 전체 runner는 3,637 pass·11 skip·0 fail, 90,914 assertions·450파일·20그룹으로 종료했다. 이 전체 실행은 후속 route helper 추출과 운영 workflow 추가 전의 증거이며, 후속 변경은 별도 affected 검증과 구분한다. 겹치는 targeted 재검증을 독립 테스트 수로 더하지 않는다.

## 2026-10-14 소스 재확인과 빌드 복구

전체 목표 원문은 `/Users/twoimo/.codex/attachments/0c6fdf5d-a1c1-45bd-937a-1b6ed6234eb1/goal-objective.md`이며 SHA `130081bfa88b4c721623b50a0ddddd878b3793a483f4e2073ab71bbc297ef4dc`다. 기존 요구를 축소하지 않았다.

Next의 route.ts가 HTTP handler 외 helper를 export해 production type 검사에 실패한 증거를 보존하고 helper를 server-only 별도 파일로 옮겼다. `requireAdmin` 선행과 고정 오류 코드·private/no-store를 유지한다. 관련9 tests·1,193 assertions·targeted ESLint 및 native7.0.2/compat6.0.2 parity(3,148논리 입력·진단0)를 통과했다.

Node24.21.0/npm11.6.2/Next16.3.8의 격리 production build는 exit0, static52페이지, CSS boundary 검증 통과다. `production-build-success-20261013.json` SHA `cbd91c8b6ce762a350d8c84ed7c2bf9d217a9af9cd0f6bc03b142fa59dcedf0b`, 입력 inventory SHA `7fbe352817f033ef119081996c5bfef0504f5ad4bea3abc2ce6968d7d9b76890`를 확인했고 이번 재개에서 1,033개 결속 소스의 내용/hash drift는0건이었다. 한 번의 로컬 `/privacy` 응답200은 인증된 관리자·Supabase·Gemini·배포 검증이 아니다. 최초 실패 영수증은 계속 보존한다.

11개 review-media migration의 운영 실행기와 owner-only manual workflow가 소스로 준비됐고 일반 actionlint1.7.12 검사를 ignore 없이 통과했다. 원래15분 evidence window, 네 개 human custody commitment와 세 개 machine fence, DB에서 네 relation의 quiescence를 별도로 확인한다. 새4개 feature SQL은97→101 별도 보호된 후속 적용 경로가 필요하다. 현재 운영 적용·dispatch·provider 호출·배포는 수행하지 않았으며 launch held를 임의 해제하지 않았다.

운영 실행기 독립 감사 뒤 rehearsal 이후 machine fence/quiescence를 다시 관측하고 apply 전용 exclusive receipt·map·관측 시각·배포/hash를 admission과 controller 양쪽에서 검증하도록 보완했다. 직접71 tests·428 assertions와 당시 workflow5 tests·65 assertions는 겹치는 로컬 검증으로 분리한다. 원래 owner commitment를 machine proof로 바꾸지 않으며11개 SQL bytes와 launch held를 유지한다.

별도4단계 manifest/controller는97→101 전이와 원래15분 창·committed parent custody·7 fences를 결속한다. 작성자 검증은 연결된 controller80 tests와4개 기능계약30 tests·690 assertions였으나 후속11개 admission schema 및 최신UI source와의 통합·workflow 연결은 별도 검증해야 한다. 실제 적용은0회다.

`/api/admin/operating-readback/storyboard-policy`는 requireAdmin 이후 정확한 production/main/deployment/commit에서 공용 선언·요청·worker admission 함수를 실행해 정책을 확인한다. provider와 text/image 허용 집합, legacy 실행 차단을 policy SHA `d4e644ac12e3489a5f8074cbab8ed154bafb846f47db147ca5a4163ec175a804`에 결속하며 실제 provider 접근과DB 컷오버는 미검증으로 표시한다. 관련11 tests·ESLint·native/compat parity3,150 입력·진단0이다. 기존52페이지 build는 이 새route를 포함하지 않는 앞선 build 증거다.

PG17 SQL acceptance의23개 input 중22개는 현재bytes/hash와 일치한다. 운영 evidence schema가 바뀐 manifest1개는 acceptance 당시61b4d002의 정확한Git blob을historical-61b4d002에 보존했다. frozen SQL4개와PG acceptance를 현재 운영controller 검증으로 승격하지 않는다.
