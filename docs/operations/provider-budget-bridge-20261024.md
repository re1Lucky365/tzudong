# 동선 예산 RPC 복구 후보 — 운영 미적용

운영 동선 추천은 `naver-directions-budget-unavailable`로 도로 경로 대신 로컬 후보를 표시했다. 읽기 전용 catalog에서 공개 RPC의 실행 소유자는 `privacy_workflow_owner`지만 `provider_budget_private`의 USAGE와 테이블 권한이 없고, Directions 정책도 없음을 확인했다. 현재 공개 RPC와 비공개 counter의 본문 SHA-256은 각각 `bc52ec03840caefdd3f90deb8c00ebf608fc9e1adde0b1b0be5aedf24203386e`, `941ddc06b34547bdfa703094d9175f800cf9921bc869e739e48198c8e0cc9763`으로 원본 G013과 같다. 실제 격리 DB에서 첫 공개 호출의 `42501`과 counter 첫 호출의 `42883`을 재현했다. 후자는 `pg_catalog.greatest`가 함수가 아니라 SQL 조건식 구문인 데서 발생한다.

후보는 [SQL](../../backend/supabase/candidates/20261024_provider_budget_private_bridge.sql)과 [실행 검사](../../backend/supabase/tests/test_provider_budget_bridge_pg17.py)다. applied migration과 고정 release manifest는 수정하지 않는다. `20260713000400`은 현행 hosted closure의 excluded/forbidden 목록에 있으므로 그 과거 extension을 직접 재실행하지 않는다.

## 선택한 권한 경계

워크플로 소유자에게 세 비공개 테이블의 읽기·쓰기와 RLS 정책을 넓게 추가하는 대신, 기존 비공개 소유자 `postgres`의 함수 안에 예산 상태를 유지한다. 공개 RPC의 이름·인자·TABLE 반환·definer·소유자·EXECUTE ACL은 보존하고 비공개 core를 호출한다. 워크플로 소유자는 해당 core의 EXECUTE와 schema USAGE만 받는다. browser와 service_role에는 비공개 테이블·core의 직접 접근을 추가하지 않는다.

기존 세 정책과 한도, operation/actor/provider 결속, 만료 처리 및 counter의 원자적 UPSERT는 유지한다. Directions 한 행만 기존 소스에 명시된 20/actor-minute, 200/global-minute, 10,000/global-day로 추가하고 다른 LLM 정책은 추가하지 않는다. 이는 공급자의 실제 잔여량이나 새로운 유료 한도를 뜻하지 않는다. NULL JWT role은 명시적으로 거부하고 counter의 잘못된 함수 구문을 수정한다.

## 상태 전이와 검증 범위

```mermaid
stateDiagram-v2
    [*] --> Validate
    Validate --> Rejected: service role / active admin / provider 불일치
    Validate --> OperationLock: 입력 유효
    OperationLock --> Returned: 같은 operation·actor·provider의 저장 결정
    OperationLock --> Rejected: 기존 operation의 결속 불일치
    OperationLock --> ActorCounter: 새 operation / bounded cleanup
    ActorCounter --> StoredDenied: 상한 초과
    ActorCounter --> GlobalMinute: 허용
    GlobalMinute --> StoredDenied: 상한 초과
    GlobalMinute --> GlobalDay: 허용
    GlobalDay --> StoredAllowed: 허용
    GlobalDay --> StoredDenied: 상한 초과
    StoredAllowed --> Returned: DB transaction commit
    StoredDenied --> Returned: DB transaction commit
    Returned --> [*]
```

이 그림은 SQL의 검토 표면이며 형식 증명이 아니다. operation advisory lock과 counter UPSERT는 서로 다른 실제 경계이고, RPC transaction 실패는 전체 변경을 rollback한다. 공급자 호출은 이 transaction 밖에 있으므로 공급자 청구의 exactly-once나 eventual completion을 증명하지 않는다. 저장 결정의 기존 보존 기간을 벗어난 재실행도 무조건적 중복 방지 주장에 포함하지 않는다.

정책 수 P, counter 행 C, 결정 행 D, 정리 상한 B=100일 때 기존 B-tree와 정상 계획을 가정한 한 요청의 탐색/정리 비용은 `O(log P + log C + log D + B(log C + log D))`로 모델링한다. 새 함수 경계는 상수 개수이며 점근적 개선을 주장하지 않는다. lock 대기 시간·실제 provider 지연은 이 모델 밖이다.

## 실제 격리 검증

```text
/Users/twoimo/Documents/projects/tzudong/.venv/bin/python3 -m unittest backend.supabase.tests.test_provider_budget_bridge_pg17
```

PostgreSQL 17.11에서 **16개 통과**. 실제 비슈퍼유저 postgres와 별도로 제공한 owner lease로 실행했다. 같은 operation의 동시 16건은 결정 1행·counter 각 1회, 고유 operation 40건은 허용 20건·차단 20건이었다. actor/global-minute/global-day 상한, 비관리자·비활성 관리자·NULL/다른 JWT role·browser 거부, 결속 불일치, 재적용·기존 정책/ACL/RLS 변경 거부와 rehearsal/후반 오류 rollback을 확인했다. NULL role guard 제거와 잘못된 GREATEST 구문 복원은 각각 잘못된 허용과 `42883`을 실제 DB에서 검출했다. 이 두 negative control은 시험 DB만 변경한다.

[실행 영수증](../evidence/provider-budget-bridge-20261024/summary.json)은 소스별 SHA, 실제 전후 영수증과 종료 확인에 결속된다. 세 기존 정책과 공개 함수 metadata/ACL, private table ACL/RLS/policy, 역할·membership·default ACL의 불변을 확인했다. 결정적 한정 사례이므로 95% 모집단 구간이나 운영 성공률·속도·비용 절감으로 환산하지 않는다. 운영 DB 쓰기·실제 provider 호출은 0회다.

## 운영 전달 전에 남은 조건

현재 후보는 실행 명세·ledger·writer fence를 가진 migration이 아니다. 현재 권한이 거절된 MCP 연결자에서 SET ROLE이나 GRANT로 우회 실행하지 않는다. 별도로 검증한 postgres migration executor와 임시 owner lease, 현재 ledger prefix, 전체 G014 전후 계약, 실제 운영 버전 PG17.6 및 새 admission의 atomic apply/readback이 필요하다. 로컬 fixture의 modeled lease는 이 권한의 운영 영수증이 아니다.

후속 통합에서 선택적 `psycopg2`가 없는 환경의 test discovery 실패를 재현하고, driver 부재는 명시적 prerequisite skip으로 처리했다. 해당 controlled probe는 모듈 로드 성공·DB 실행 0·class skip 1이며 DB 통과가 아니다. driver가 설치된 실제 PG17.11의 16개 검사는 다시 통과했고 source stable과 cluster 종료를 확인했다. 원래 영수증을 덮지 않은 [후속 영수증](../evidence/thumbnail-integration-20261024/provider-budget-pg17-portable.json)과 [부재 probe](../evidence/thumbnail-integration-20261024/provider-budget-missing-driver.json)를 보존한다.

정확한 소스의 Pro thesis → Gemini 최대 사고 반대 검토 → Pro 역검증도 미완료다. 기존 원본 예약과 bundle은 보존한다. 현재 production은 별도 작업으로 `1b5230ac93021c72499f4950bff6cda24e2515e5` / `dpl_FiHvmpQdmnDLNYXL9dquSFTFMpoB`로 이동한 것을 읽기 확인했으며 이 후보의 배포는 아니다. 실제 적용 직전에 rollback SHA와 writer fence를 다시 확인하고, 정상 `develop → data → main` 이후 인증된 UI에서 도로 경로·제어된 실패·기존 캐시/반환 계약을 확인해야 한다. 이미 생성된 결정이나 counter를 삭제하는 자동 rollback은 만들지 않는다.

## 후속: 썸네일 설치 이후 실제 PG17.6 검증

위의 PG17.6·전체 G014 미검증 상태는 다음 [새 영수증](../evidence/provider-budget-bridge-20261024/full-pg176-after-thumbnail.json)으로 보완했다. 시험한 base는 `6539427742b2542dcfe471a0c399c2ba7c4177cd`, 예산 후보 SHA는 `7f6847fa83f7e1f87ce8ff289623796182a323a245a3308007fd689aa6ff3c24` 그대로다. 운영 적용은 여전히 0회다.

원문 ledger 89행에서 썸네일 전체 설치를 마친 90행의 격리 PG17.6 DB를 새 DB로 복제했다. 현재 운영의 사전 23항목과 기존 예산 정책 3행을 **별도 REPEATABLE READ READ ONLY** 관측에서 확인했으며 사용자·counter·decision 행은 복사하지 않았다. 논리 dump가 생략한 private schema의 명시적 소유자 기본 ACL은 이 별도 관측의 원래 raw ACL과 같게 일반 GRANT/REVOKE로 복원했다. 제품 guard·원본 assertion·registry는 완화하거나 투영하지 않았다. 이 보충 관측은 앞선 전체 schema snapshot과 같은 시점이라고 하지 않는다.

복제는 소유 fixture의 원본 DB 연결 0건을 확인한 뒤 [PostgreSQL 17의 CREATE DATABASE TEMPLATE](https://www.postgresql.org/docs/17/sql-createdatabase.html)를 사용했다. [Supabase의 17.11 변경 공지](https://supabase.com/changelog/postgres-15-19-17-11-breaking-changes)도 대조했으며, 이번 검증을 위해 운영이나 고정 17.6 이미지·확장 버전을 변경하지 않았다.

| 실제 경계 | 결과 |
| --- | --- |
| 전체 G014·썸네일 상태 | 원래 assertion 4개 전후 통과, 썸네일 종료 23항목 전후 일치, 원본 DB 보존 |
| 임시 owner lease | 없는 lease·남아 있는 lease 각각 거부, 정상 경로 membership 완전 복원 |
| 후반 오류·재적용 | 전체 post 검사 뒤 오류를 넣어 원상 복구 확인, 정상 commit 뒤 재적용 거부 |
| 기존 계약 | 공개 RPC metadata·ACL과 원장 90행·digest 불변, 기존 정책 3행 보존, Directions `[20,200,10000]` 한 행만 추가 |

이어 별도 복제 DB에 가상 계정 **3개**를 만들고 원래 auth 함수·trigger·RLS를 유지한 채 공개 RPC를 실행했다. 정상 호출과 실제 `auth.role()`의 JSON claims fallback은 성공했고 같은 operation 재요청은 counter/decision을 추가하지 않았다. **고유 operation 21건은 허용 20·차단 1**이며 actor/global-minute/global-day counter는 **21/20/20**이었다. NULL JWT role·browser·비관리자·비활성 관리자와 service_role의 private core 직접 호출은 모두 거부됐고 예산 행 변경이 없었다. 이는 설정한 로컬 한도 경계의 결정적 결과이며 운영 성공률 표본이 아니다.

실제 원본 공개 함수는 이 전체 환경에서 먼저 **auth schema 권한 `42501`**로 실패했다. 앞선 최소 fixture의 private-budget 권한 실패와 구별한다. 비공개 테이블 권한을 늘리지 않는 private core 경계가 정상 호출을 가능하게 했다. 원래 counter 본문을 시험 transaction에 복원하면 초과 경로에서 `42883`이 발생했고, NULL guard를 `<>`로 약화한 변형은 NULL role 요청을 잘못 허용했다. 세 negative control 뒤 실제 고정 소스와 상태가 rollback됐고 마지막 전체 G014도 통과했다.

초기 시험의 DDL 연결/출력 파싱 오류와 단독 활성 관리자를 비활성화하려다 기존 G014 보호 장치가 올바르게 거절한 이력은 실패 영수증으로 보존했다. 비활성 가상 계정을 별도로 준비해 기존 보호 장치를 우회하지 않았다. 소유 컨테이너는 정지했고 다른 소유자의 자원 변경은 0이다. 실제 provider 호출·운영 사용자 복사·운영 DB 쓰기는 0이며, 아직 **새 budget forward와 90→91 원장 계약·운영 admission·HTTP/UI 검증**의 증거는 아니다.

썸네일은 고정 **89→90**을 전제로 하고 기존 review-media predecessor는 **89→100**에 결속돼 있다. 예산 후보의 G014 assertion 직접 수정은 없으며 실제 위 순서에서 공존을 확인했다. 서로 다른 successor를 원장 수만 고쳐 이어 붙이지 않는다. 먼저 채택되는 forward 이후에는 새 prefix·terminal과 새 영수증을 결속해야 한다. 기존 frozen manifest와 applied migration은 보존한다.
