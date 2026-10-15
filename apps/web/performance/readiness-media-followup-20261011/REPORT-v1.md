# 리뷰 안전성·복구 후속 검증 — 2026-10-11

운영에서 실제로 실패한 관리자 리뷰 수정의 원인을 안전장치가 거부한 조건 없는 revision 갱신으로 확인했다. WHERE singleton을 명시한 forward 수정은 관리자 수정과 소유자 리뷰 삭제를 로컬 PostgreSQL 17.6에서 복구했다. 응답을 잃은 만료 작업은 서버의 직렬화된 GET이 미적용을 확인할 때만 해제한다. 이미 적용한 영수증은 만료 후에도 복구하며 Apply를 자동 재전송하지 않는다.

아래는 소스 후보와 로컬 검증 결과다. 이 패킷의 운영 DDL·배포·사진 이전은 0회다. 운영 콘텐츠 Preview는 1회, Apply **시도**는 1회였다. 09:58:19 UTC 관측에서 원래 작업은 expired preview, audit 0, active record calls 0이었다. 수정 완료나 운영 반영으로 보고하지 않는다. 기존 작업 UUID와 브라우저 pending 상태를 보존했고 남은 22개 초안도 보류했다.

| 흐름 | 환경·표본 수 | 지표 | Before | After | 절대 변화 | 상대 변화 | 노이즈·신뢰구간 | 판정 | 증거 경로 |
|---|---|---|---|---|---|---|---|---|---|
| 로그인한 MY 리뷰 진입·재방문 | Chrome154, production, 390/820/1440; 각 버전 브라우저 프로세스 1개·fresh context 3개 | React418 event 수 | 9 | 0 | 9 감소 | 해당 관측 event 수 100% 감소 | 표본 부족, CI·p95 없음 | 지정 fixture에서 오류 해소 관측; 사용자 발생률 아님 | browser-upload-recovery-v6.json → v12.json, v13.json |
| 관리자 영상 리뷰 수정 | PG17.6, safeupdate 활성, fresh before/after clone 각 1개 | transaction 결과·audit 수 | SQL21000 / audit0 | applied / audit1 | 기능 복구 관측 | 비율 계산 안 함 | 반복 모집단 없음 | 로컬 guard 유지·수정 성공 | restaurant-edit-safeupdate-before-v6.json, after-v5.json, safeupdate-boundaries-v7.json |
| 소유자 리뷰 삭제 | PG17.6, safeupdate 활성, fresh clone 각 1개 | 리뷰·receipt·cleanup 수 | SQL21000 / 1·0·0 | committed / 0·1·2 | 삭제 1·receipt1·cleanup2 | 비율 계산 안 함 | 독립 실행 각 1회 | 로컬 삭제·내구성 cleanup 연결 성공 | owner-delete-safeupdate-v9.py/json |
| 만료된 미적용 관리자 작업 조회 | PG17.6, clone 각 1개 | 서버 GET 결과·audit | preview / audit0 | PREVIEW_EXPIRED / audit0 | terminal readback 추가 | 비율 계산 안 함 | 정확성 검사 | DB 잠금 후 미적용 만료만 확정 | expired-readback-pg17-v1.json |
| Apply·GET 경합 | PG17.6, 실제 연결 2개·동기화 transaction, 2시나리오 | lock timeout·commit 후 audit | 검증 없음 | timeout은 미확정; commit 후 applied/audit1 | 비교 불가 | 계산 안 함 | 기능적 경합 검사 | 만료된 applied 영수증 보존·중복 audit 없음 | verify_expired_readback_v1.py, expired-readback-pg17-v1.json |
| 만료 복구 모달 | Chrome154, production v4, 3 viewport·fresh context 3개 | 9 functional checks, GET/POST | 운영 모달은 미확정에 갇힘 | 각 context GET2/POST0; matching intent 제거·닫기 | 정량 전후 비교 아님 | 계산 안 함 | synthetic endpoint 응답 | 기능 통과; browser health는 미통과 | browser-admin-expiry-v3.json, admin-expiry-*-v3.png |

## 원인과 변경 경계

- MY hydration: AuthProvider가 스트리밍된 MY subtree의 hydration 전에 완료되면 SSR에 없던 로그아웃 버튼을 클라이언트가 첫 snapshot에서 기대했다. Instrumented production v10으로 위치를 확인했다. useHydration의 server snapshot을 적용해 subtree가 hydration commit하기 전까지 로딩 shell을 유지한다. 임의 지연이나 suppressHydrationWarning을 추가하지 않았다. v8은 development 진단, v10은 instrumented 진단이며 최종 v12/v13은 instrumentation 없는 production이다.
- Revision: `pipeline_control.bump_admin_evaluation_revision()`의 singleton UPDATE가 `safeupdate`의 WHERE 요구를 위반했다. 기존 안전장치를 끄지 않고 unique singleton predicate를 추가했다. 원 함수 body SHA에 묶인 forward SQL이며 applied SQL은 수정하지 않는다. owner·ACL·manifest·membership·schema와 transaction rollback을 검사했다.
- Expiry: client 시각이나 receipt만으로 미적용을 단정하지 않는다. public.admin_record_action의 기존 operator·operation advisory lock·row lock 뒤에서 expired preview만 고정 오류로 반환한다. 적용된 state는 기존 audit receipt를 반환한다. Client는 operation ID/action/hash/target 집합이 모두 일치하는 sessionStorage 항목만 동기적으로 제거하고, 제거 실패나 actor/epoch 변경은 미확정 상태를 보존한다. 일반적인 localStorage 분산 CAS를 입증한 것은 아니다.
- 공유 legacy 사진: 마지막으로 참조를 제거하는 같은 소유자의 리뷰에만 내구성 cleanup queue를 재결속한다. 완료/retired 항목을 되살리지 않고 global reference guard를 유지한다. shared-cleanup-exact-pg17-v2.json과 이전 실패 v1도 보존했다.

Singleton predicate·state guard는 상수 개수의 필드 판정이다. 기존 row/operation lock 비용이 있으며 새 timeout·debounce를 추가하지 않았다. pending target은 기존 상한25를 유지한다. 이는 정확성·복구 변경으로, 처리시간·메모리·처리량 개선을 측정했다고 주장하지 않는다. 전수 검사 처리기는 ID 인덱스와 한 번의 입력 순회를 사용하며 O(행 수 + 텍스트·인용 길이)로 읽는다. 실제 LLM 요청 비용이나 속도 절감은 이 분석에서 측정하지 않았다.

## 검증

- Web 전체: 3419 pass / 11 skip / 0 fail. unit-expiry-v1.json/log.
- 실제 loopback HTTP client: 31 pass / 294 assertions, expiry 새 테스트5개. 변경된 identity, 저장소 throw/noop, actor 변경, 적용된 receipt와 client-only 만료를 포함한다.
- 관련 Python5모듈: 108 pass, 0 fail. 이는 exact PG17 실행과 별도 source/receipt 검사다.
- 영향 파일 ESLint 통과. native7.0.2/compat6.0.2 parity: 3142 logical inputs / diagnostics0.
- Node24.21.0, Bun1.4.0, Python3.12.14, Next16.3.8. Production v4 BUILD_ID `NOufANwOx4K_V5UQ0oyW_`, build/CSS exit0. MY12 checks/page0/console0. 소스는 ed8ad8ab + 미커밋 expiry 변경으로 빌드했으므로 source-manifest-v1.json과 개별 source SHA로 연결한다.
- Admin 모달9검사/page0/unsupported fixture0. Console9 중 의도한 fixed409 3, CSP3, 미분류 resource 오류3. `functionalFlowsPassed=true`, **browserHealthClean=false**. 지도·SDK 전체 상태로 확대하지 않는다. v1/v2의 미지원 fixture 실패도 삭제하지 않았다.
- 이전 두 frozen evidence map은 ed8 원격 Git 객체와 63파일 byte equality를 확인했다. 새 패킷은 별도 artifact-map과 detached SHA 및 independent verifier를 사용한다. 전체 성능 scorer의 새 측정 admission은0이다.

## 전달과 미검증

PR #3147의 ed8 head에서는 Catalog와 CI·Release·Promotion·CodeQL가 통과했다. 새 expiry source와 evidence head의 required CI는 별도 확인해야 한다. main 승격·hosted forward SQL·private verification-photo 이전·READY SHA/alias readback·원래 uncertain 작업 GET 복구가 아직 남았다. 전수 검사 23개 최소 초안 중 운영 콘텐츠 변경이 확인된 것은0개다.

전체 npm audit의 미패치 braces7 경로는 별도 미해결 항목이다. production-only audit0은 전체 gate를 대체하지 않는다. 사용자 휴대폰 사용 보류를 유지했다. 장기 메모리/렌더링/실 SDK/물리 기기/field 목표는 paused이고 이 패킷은 그 목표의 재개·완료나 성능 개선 증거가 아니다.

요청한 Web GPT6 독립 소스 검토는 파일 검색 전에 자동 승인 검토가 보안 상태를 판정하지 못해 차단했다. source review 미완료로 남기고 거부된 호출을 재시도하거나 다른 provider로 대체하지 않았다. 이 후속 구현에서 native Astra 새 호출은0회다.
