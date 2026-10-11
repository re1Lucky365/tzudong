# PG15 Storage replay 경로

원격 Catalog run38135964611, source723754e3는 immutable migration `20261011105114_review_media_storage_retirement_fence.sql`에서 `STORAGE_FENCE_LEASE_BASELINE_DRIFT`로 실패했다. PG15의 INHERIT 역할은 임시 owner membership을 얻으면 owner의 EXEC 권한도 가진다. 그 상태를 직접 EXEC grant와 같은 것으로 검사한 지점이다. [PostgreSQL15 공식 역할 문서](https://www.postgresql.org/docs/15/role-membership.html).

격리 Supabase PG15.8/arm64, networknone/portsnone의 작은 ACL fixture에서 effectiveExec=true/directExecutorExec=false를 관찰했고, 원래 predicate가 P0001을 일으키는 것을 재현했다. **이 fixture는 실제 reference/Storage lifecycle 또는 canonical AMD64 전체 replay가 아니다.** PG17의 실제 미디어 race·permission·rollback은 이전 동결 packet으로 유지한다.

새 source-only wrapper는 한 SQL의 정확한 filename/SHA/11418bytes만 받는다. 원래 role lease 안의 predicate 하나를 `aclexplode` 기반 직접 ACL 검사로 바꾸며 함수 본문·API 역할 denial·실제 GRANT/REVOKE·최종 readback은 그대로 둔다. 시작/끝 effective EXEC와 전체 role membership hash를 비교한다. 기존의 간접 NOINHERIT membership도 보존한다. applied SQL·archive·G026 bundle·hosted 실행 경로는 바꾸지 않는다. generator는 wrapper와 transformed SQL을 chain에 해시로 기록한다.

최종 v3 fixture: 원래 P0001 재현, membership/function ACL 정확 복원, **동일 postgres actor**의 direct EXEC grant 거부, 간접 NOINHERIT membership 보존 통과. v1/v2의 direct-grant negative는 supabase_admin actor rejection과 섞였으므로 직접 grant 검사의 독립 증명으로 쓰지 않는다. v1/v2 결과를 덮어쓰지 않았고 v3에서 이 검사를 분리했다. 초기 v1의 추가 MEMBER 제한도 일반 계약으로 채택하지 않았다.

관련 source tests26 pass/0 fail. test module과 source-only branch는 Catalog workflow에 명시적으로 등록했다. 최종 source-tests-v2.log를 사용한다. 새로운 전체 canonical CI 합격은 아직 없으며 PostgreSQL17 합격으로 대체하지 않는다. 성능·실기기·field admission0, hosted DDL0, 새 모델 호출0이다.

재현: pinned Python3.12와 `transform_review_storage_pg15_replay.py --source ... --output <새파일>`을 사용한다. 변경된 source/다른 filename/중복 output은 거부된다. `verify_pg15_acl_v3.py`는 owned PG15 fixture container와 fresh `storage_acl_v3_20261012` DB를 전제로 한다. 같은 이름이 소비됐으면 새 owned target/run-ID를 쓰고 이전 DB/container를 reset/drop하지 않는다. 다른 host는 같은 pinned image의 격리 컨테이너·합성 role/trigger-function fixture를 먼저 구성한다. 실제 운영 dump·계정·키를 복사하지 않는다.
