# 운영 DB 반영 준비 감사

## 결론

보호 `main` `056a86600f412eb42df4304e3206841679012f3e`의 11개 미반영 migration을 순서·원문 SHA-256·Git blob·Supabase CLI v2.109.1 호환 statement vector에 결박한 **비실행 검토 carrier**를 만들었다. 대상은 137,238 bytes, 112 statements이며 각 migration은 `BEGIN`과 `COMMIT` 한 쌍을 가진다.

현재 저장소의 운영 적용기는 이 전이를 실행할 수 없다. `.github/admin-record-sql-successor.v1.json:17-24`는 80→85의 고정 5단계이고, 대상 11개 포함 수는 0개다. `.github/supabase-migration-release-manifest.v1.json`도 대상 포함 수가 0개다. `apps/web/scripts/supabase-migration-bundle.mjs:272-277`은 4개 또는 5개 묶음만 받는다. 5+5+1로 나누면 중간 상태가 커밋되며 현재 계약에는 전체 전이를 하나의 원자적 적용·readback으로 묶는 승인 경로가 없다.

따라서 이 디렉터리의 산출물은 DB에 보낼 SQL이나 실행 승인서가 아니다. 기존 단일 migration 적용기를 재사용하려면 shared release manifest에 11개 항목과 단계별 prior/terminal readback을 새 보호 PR로 추가해야 하며, 전체 원자성이 필요하면 11단계 bundle compiler/runner 계약도 함께 추가해야 한다.

## 재현 결과

정확한 `main` tree `4b47fe832c375a9a0f829332c354379c042ace06`을 `git archive`로 격리하고 PostgreSQL 17.6에서 관련 7개 모듈을 실행했다.

- 50 tests → 50 pass, 0 fail, 0 error, 0 skip
- 테스트 보고 시간 4.328초, 벽시계 4.567651초
- hosted read 0, hosted write 0, Storage write 0, provider call 0

이 결과는 source contract, review-media catalog integration, 대상 테스트가 다루는 rollback·권한, PG17.6 호환성을 입증한다. 11개 전체를 운영 전 상태에서 한 트랜잭션으로 적용한 증빙, hosted prior state, writer-fence freshness, hosted terminal readback, 배포 준비는 입증하지 않는다.

## 배포 전에 필요한 실제 조건

1. **지원 적용기 admission**: 현재 manifest 두 개 모두 대상 coverage가 0이다. `admin-record-sql-successor.mjs:240-279`는 정확히 기존 5개 ID·원문 vector만 받고, `:619-625`는 stage 수와 80→85를 고정한다. 이 조건을 우회하거나 carrier를 수동 SQL로 취급하면 안 된다.
2. **새 보호 release**: `docs/agents/release.md:5,9-13`에 따라 `develop → data → main`, 현재 운영 배포에서 읽은 named rollback SHA, 반영 후 Vercel SHA·live URL readback이 필요하다. 로컬 테스트는 이 증빙을 대체하지 않는다.
3. **fresh admission**: `.github/admin-record-sql-successor.v1.json:21-24`는 `protected-release-and-fresh-admission-required` 상태다. 실제 실행창에서 ledger·catalog·G014·ACL·정책 prior state를 다시 읽어야 한다. 이번 carrier의 86행/latest `20261009101645`는 같은 목표의 이전 읽기 전용 관측일 뿐 현재값으로 재주장하지 않는다.
4. **writer fence 7개**: `.github/admin-record-sql-successor.v1.json:185-192`의 `adminRecordMutationsHold=active`, `g037WriteFreeze=active`, `automaticReviewer=stopped`, `browserRpc=stopped`, `directSql=stopped`, `dashboard=stopped`, `providerIngress=stopped`가 모두 필요하다. `admin-record-sql-successor.mjs:523-537`은 각각 private canonical receipt와 digest를 요구하고 `:601-617`은 유효 시간·만료·상태를 검증한다.
5. **owner cleanup preimage**: `20261011175912_review_owner_cleanup_completion.sql:14-33`은 `current_user=session_user=postgres`, read-write, PG15/17, 제한된 `privacy_workflow_owner`와 PG17의 외부 admin-option grant를 요구한다. 같은 파일 `:20-22`는 `finish_review_media_cleanup()`의 정확한 preimage `f6c4e719…`를 요구하며 `:45-48`은 postimage `a6b4211b…`를 검증한다. 이 preimage가 다르면 실행을 중단해야 한다.
6. **DB가 앱보다 먼저**: `apps/web/lib/reviews/review-media-mutation.ts:248,262,278`은 새 `mutate_review_with_media`, `queue_review_upload_cleanup`, `read_review_media_commit` RPC를 직접 호출한다. 11개 migration과 terminal readback이 성공하기 전에 새 앱을 운영 배포하면 안 된다.
7. **최종 readback**: 조건부 ledger 86→97, 대상 11개 exact statement arrays, `review_media_private` 2개 테이블, 8개 RPC, 9개 Storage policy, 함수 body hashes, ACL, G014 manifest 불변, queue/worker 중지 상태를 같은 실행창에서 확인해야 한다. 중간 결과나 연결 유실은 재실행 근거가 아니며 우선 reconciliation이 필요하다.

## 산출물

- `review-carrier-v1.json`: 보호 main의 11개 source/vector identity, 예상 terminal invariant, 적용기 coverage, 승인 holds
- `build_carrier.py`: protected main이 움직이면 실패하는 결정적 builder
- `verify_carrier.py`: source SHA/blob/vector/order/비실행 경계를 재검증
- `run_local_replay.py`: exact main archive에서 7개 관련 모듈을 실행하는 로컬 재연기
- `local-replay-v1.json`: 50-test 결과와 증빙 한계

다음 안전한 작업은 이 carrier를 입력으로 하는 보호 PR에서 새 실행 manifest와 원자적 11단계 runner/readback을 구현하고, 그 PR이 main에 병합된 뒤에만 fresh writer-fence admission을 생성하는 것이다. 현재 작업의 금지 범위 때문에 DB·Storage·writer fence·배포 상태는 변경하지 않았다.
