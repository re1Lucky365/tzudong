# 관리자 검수·OCR 복구 후속 검증

후속 수정의 기준은 PR #3215의 `b1c505cd4f065fac8a4ebefe235a85a5513acbd7`이다. 소스 검증과 운영 검증을 분리한다. 현재 증빙과 해시는 [인덱스](../../apps/web/performance/cross-audit-20261019/review-fixes-evidence-index.json), 전체 요청의 미완료 항목은 [목표 장부](goal-resume-20261018.md)에 기록한다.

## 동작과 정량 모델

| 경계 | 이전 실패 | 수정 후 확인한 결과 | 측정 한계 |
| --- | --- | --- | --- |
| 관리자 OCR 선택 | 가장 오래된 확정 사진 결함을 매번 다시 선택 | 전체 snapshot CAS와 terminal readback을 모두 확인해야 다음 행으로 이동. 권한·전송·provider·저장 불확실성은 중지 유지 | 합성 행 선택·상태 전이 검증. 운영 처리량 미측정 |
| 확정 credential 거절 | generation 불가능이 확인돼도 durable claim이 indeterminate에 남음 | 신뢰한 오류 분류와 정확한 claim token으로만 삭제 또는 기존 유효 결과 복구. stale ACK는 새 claim에 영향 없음 | 실제 유료 API 호출·복구 뒤 청구 결과 미검증 |
| 배너 업로드 | 긴 제목의 서버 거절 뒤 업로드가 누적되거나 `500 + invalid`를 확정 거절로 오인 | 100자 초과는 업로드 전 차단. 정확한400/403/404/409 status/code 조합에서만 현재 제출 파일 정리. 실제 component의 합성400에서 정리1회,500에서0회 | HTTPS 합성 Storage 경계이며 운영 Storage 검증은 별도 |
| 스토리보드 결속 | 실행 의존성 변경이 compatibility digest 밖에 존재 | 최초30개→35개 경계(+5개,+16.7%). 개별 의존성 변형 시 source·policy digest 변경, build route에도 새 digest 포함 | 선언한 first-party 경계 범위이며 운영 alias/private policy readback 미완료 |

정렬된 검수 행에서 확정 결함이 앞에 k개 있다고 하자. 이전 실패 경로는 첫 행을 terminal 처리하지 않아 한 번 실행할 때 완료 행 수 변화가 ΔP=0이고 다음 행까지의 선택 횟수에 유한 상한이 없었다. 수정 후 CAS와 독립 readback이 성공하고 새 행 삽입·동시 편집·외부 장애가 없다는 조건에서는 확정 결함마다 ΔP=1이므로 첫 정상 행에 도달하는 선택은 최대 k+1회다. 이는 조건부 진행성 모델이며 권한·저장 불확실성을 건너뛰는 근거가 아니다.

배너에서 한 제출에 파일 m개, 동일한 잘못된 입력의 재시도가 a회라면 이전 확정 거절 경로는 최대 a×m개의 미참조 업로드를 남길 수 있었다. 긴 제목은 새 경로에서 업로드0회이며, 서버의 확정 사전 거절은 현재 제출의 m개에 대해서만 정리를 시도한다. 정리 실패와 mutation 결과 불확실성은 별도 상태로 보존하므로 운영 미참조 파일이0개라고 주장하지 않는다.

OCR의 새 capability 검사는 실행 경로에 RPC1회를 추가한다. 미설치·malformed·held이면 claim·quota·provider 호출은0회다. 준비된 경로의 추가 비용은 RPC와 catalog 검증 비용이며, 기존 일일 quota 상한과 예약 과금 정책은 바꾸지 않았다. 재시도 때 기존 정책의 새 예약이 생길 수 있다. 지연·토큰·금액 절감은 측정하지 않았다.

## 검증 범위

- 배너18 pass/151 assertions, 관리자 OCR held 분기 포함26 pass/155 assertions, durable OCR32 pass/195 assertions, 스토리보드 관련38 pass/264 assertions, post105 compiler7 pass/59 assertions. 하위·재실행 그룹이 겹치므로 총합을 만들지 않는다.
- 통합 ESLint 통과, 고정 native TypeScript parity3,351 logical inputs/진단0, production build54/54페이지와 CSS 경계 통과. 후속 SQL-only 변경 뒤 compile 관련20/20개 파일의 해시가 같음을 확인했다.
- 실제 component의1280×900px synthetic browser에서101자+새 미디어 저장의 upload/PATCH/cleanup 요청은0/0/0이었다. 최초 HTTP loopback fixture의 URL 차단은 실패 증거로 보존했다. 유효한 HTTPS/no-port synthetic origin을 task-owned context가 전부 로컬 fulfill한 후속 검증에서100자+정확한400/invalid는1/1/1,100자+불확실500/invalid는1/1/0이었고 세 경우 모두 안내·제목·선택 파일·저장 가능한 draft를 보존했다. 외부 HTTP·hosted·provider 호출은0건이었다. 합성 WebSocket2건은 연결 전에 닫았고 context·서버·임시 harness를 정리하고 tsconfig를 복원했다.
- 함수4개의 전체 정규화 ACL·owner와 private table2개의 전체 ACL·owner를 seal에 결속했다. PG17.11 minimal harness에서 추가 table SELECT·추가 wrapper EXECUTE·두 table owner 변경의4개 반례가 모두 held이고 rollback 뒤 ready로 복구됐다. 이는 PG17.6 전체 predecessor 재현이나 hosted 적용의 대체 증거가 아니다.
- PG17.6의 최초 catalog fixture 실패 `RECEIPT_OCR_WRAPPER_ACL_DRIFT_NOT_HELD`는 NOSUPERUSER·owner SET=false 조건의 GRANT가 경고/no-op인 시험 결함이었다. 실제 owner GRANT는 기존 seal이 held로 감지했다. Migration·manifest·compiler를 바꾸지 않고 transaction-local owner lease·실제 mutation readback·membership 복원을 보완했다. 다음 합성 Auth 사용자 정리 실패도 보존하고, 운영 개인정보 ACL 변경 없이 disposable target 전체 폐기로 정리하도록 고쳤다. 표식 자체는 권한·소유권 증거가 아니다.
- 최종 event009에서 fresh PG17.6 constituent·aggregate 두 경로의105→106 적용·seal·44-statement vector·forced rollback·idempotency가 통과했다. 각 catalog의 경고0·mutation 표식10/10·membership 복원, durable assertion·dblink race·disconnect·residual handoff, exact target 제거·잔존0 및 source/retained105 dump 보존을 확인했다. 다만 해당 durable 전체 실행은 임시 `postgres SUPERUSER` lease를 사용했으므로 dblink race는 privileged local concurrency 증거로만 분류한다.
- 별도 fresh target의 event011은 canonical fixture1–444행,15,387bytes·SHA `7c2c382282682bee0437b9f6352e6e26f0d60525fc406837c920b22479a6965b`만 실행했다. 시작부터 끝까지 `postgres.rolsuper=false`이고 membership·dump·synthetic residual이 같았으며 exact teardown도 통과했다. 이에 비-dblink core의 일반 postgres 권한 증거는 성립한다. NOSUPERUSER dblink race와 hosted readiness는 미확인이다. 빈445행을 포함한 event010과 이전 실패 기록은 삭제하지 않았다.

위 수치는 결정적 fixture·소스 결속 범위다. 조건별 독립 운영 표본이 없어 성능 개선율이나 명목95% 신뢰구간을 계산하지 않는다. 단일 build 시간과 테스트 개수는 운영 성능 표본이 아니다.

ACL seal은 봉인 후 변경을 검사한다. 생성 시점의 creator default ACL에 이미 추가 grant가 있었다면 snapshot 일치만으로 이를 canonical 권한이라고 증명할 수 없다. 관측한 PG17.6에는 해당 `privacy_workflow_owner` default ACL이 없었으며 이번 fixture 실패 원인도 아니었다. 임의의 설치 환경까지 initial privilege allowlist를 보장한다는 더 넓은 주장은 이 증빙 범위에 포함하지 않는다.

## 전달 조건

기존 applied migration·89→100→105 manifest와 사용자 작업을 보존한다. 새 successor는 `held_unapplied`인 source-only 계약이며 기존 운영 실행기에 연결하지 않았다. 실제 Gemini 반대 감사와 최신 소스 역검증, 새 head CI, 현재 writer fence·admission에 따른 hosted SQL 적용/readback, 보호된 develop→data→main 승격, 운영 SHA·도메인 readback, 전체 메뉴의 관리자 실검증은 별도 단계다.

## CI 재생·후속 전달

`dfa77ca0b509c508ac29ec5f93fe7eb3f45cc16f`의 앱 복구를 PR #3215에 push하고 리뷰4건을 resolve했다. 해당 head의 Catalog/generate는 실행39150206730의 step12에서 `RECEIPT_OCR_CREDENTIAL_RELEASE_PREREQUISITE_DRIFT`로 실패했다. source-only generator가 Supabase migration ledger 없이 직접 SQL을 재생하기 때문이다.

후속 `14a8f5da4268df890c7adf10bf89e99ce071f6f5`는 정확한 raw migration hash에만 적용되는 PG15 disposable ledger fixture adapter다. 기존 ledger/schema가 있으면 거부하고 raw SQL 자체는 바꾸지 않는다. fixture가 있는 동안 unsealed held를 확인하고, 함수·table body/owner/ACL digest가 같아야 RESTRICT로 자기 자원만 정리한다. ledger 제거 후 getter ready를 주장하지 않는다. workflow의 표본·scorer·필수 검증은 줄이지 않았다.

독립 clean replay2회는 각각1,960행과 source-only candidate validation이 통과했고 산출물 hash58개가 일치했다. 두 candidate의 manifest SHA는 `ec7f3771722786fa0e8bb93e1cf7a00239dbf0477ee184d989eba53ffad3bc42`, SHA256SUMS는 `bb655d2bf637f95eed0f163bafc1a8611597e67203fdc0e33549f02367b48051`다. schema-only 및 synthetic1행 ledger2개 반례도 거절·보존됐다. 상세 범위는 [CI 재생 후속 증거](../../apps/web/performance/cross-audit-20261019/catalog-clean-replay-ci-recovery-followup.json)에 기록한다. Replay A는 exact ID 수집이 누락돼 이름·label 잔존0만 성립하고, Replay B만 exact-ID 폐기가 성립한다. 이 검증은 로컬 source-only 복원이며 운영 SQL·배포 증거가 아니다.

사용자 승인 범위의 GitGuardian 세 탐지 #38364337·#38364338·#38364339만 오탐 처리하고 UI에서 Ignored를 확인했다. [범위별 readback](../../apps/web/performance/cross-audit-20261019/gitguardian-owner-markers-false-positive-readback.json)을 보존했다. 다음 head의 CI는 별도 확인한다.

현재15메뉴×3화면 폭의 헤더45건이 source-bound로 통과했다. 미구현 loopback fixture 오류212건을 보존하며 전체 기능·인증 세션·운영 API 성공으로 해석하지 않는다. [헤더 후속 증거](../../apps/web/performance/cross-audit-20261019/admin-header-current-scope-readback.json)의 범위만 인정한다.
