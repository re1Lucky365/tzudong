# 관리자 미디어 정리와 잠금 회귀 검증

관리자 OCR이 교체한 공개 영수증은 작성자의 MY 방문에 의존하지 않고 관리자 요청에서 정리한다. 제거 응답이 불확실해도 기존 큐를 보존하고, 공개 객체의 확정적인 없음과 두 버킷의 DB 부재를 확인하기 전 성공을 반환하지 않는다. 다음 관리자 요청은 새 다운로드·OCR 호출 전에 미완료 큐를 재조정한다. 20개 제한을 넘는 큐에서는 실제 공개 부재를 확인한 키만 완료 처리한다.

새 forward unit은 기존 applied SQL을 수정하지 않는다. 관리자 삭제, 작성자 수정, 직접 리뷰 UPDATE의 잠금 순서는 reviews relation → global media → object로 맞춘다. G014 assertion·manifest·membership 및 기존 함수의 OID/owner/ACL/config/default 의미를 보존한다. 새 서비스 RPC에는 service_role EXECUTE만 허용하고, private schema/table 접근을 새로 열지 않았다. canonical ledger는 133개이며 구 132개 receipt를 완료로 인정하지 않는다.

| 흐름 | 환경·표본 수 | 지표 | Before | After | 절대 변화 | 상대 변화 | 노이즈·신뢰구간 | 판정 | 증거 경로 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 작성자 수정 + 관리자 삭제 | 격리 PG17.6, 전후 각 통제 실행 1회; 변경 연결 2개 + fixture 동기화 연결 1개 | deadlock SQLSTATE40P01 | 1회 재현 | 0회 관찰; 작성자 commit + 관리자 RECORD_ACTION_STALE | 1회 감소 | 표본 1의 일반 개선율로 보고하지 않음 | 결정적 실패 경로 검사; field 발생률/CI 추정 안 함 | 해당 순서의 교착 수정 입증 | admin-forward-exact-pg17-v5.json |
| 영수증 정리 | PG17.6 합성 권한·잔존·재첨부·21키 경계 10종 | 올바른 거부·완료·잔여 큐 | 작성자 방문 의존/완료 키 결속 없음 | 10종 통과; 미확인 21번째 키는 pending | 성능 차이 미측정 | 미산정 | HTTP Storage/공개 캐시 실제 이전 증거 아님 | DB 실패 경로 통과 | admin_verification_probe_v1.sql, admin-forward-exact-pg17-v5.json |
| 공개 상세·로그인·Stamp·관리자 접근 차단 | Chrome154, 390/820/1440px, syntheticREST735/Auth401 | 기능 검사 | 앞선 소스 13종 통과 | 14종 통과; pageerror0/fixtureUnsupported0 | 기능 범위 1종 추가 | 속도 개선율 미산정 | console13(CSP7/other6) 남음 | 제한된 production rendering 통과 | browser-readiness-admin-media-v35.json |

수학적 모델에서 새 서버 정리는 호출당 K≤20 키, 버킷 제거 호출 2개, 공개 확인 K개, DB RPC 2개다. 네트워크 호출과 메모리 비용은 O(K)이며 HTTP 중에 SQL transaction/global lock을 유지하지 않는다. DB reference lookup의 비용은 실제 reviews·food array·queue 크기에 의존한다. 이 복잡도 설명을 지연 감소나 throughput 실측으로 보고하지 않는다. 필요한 feedback·불확실성·기능을 숨기지 않는다.

전체 Bun unit 3406 pass/11 skip/0 fail, 관련 Python104, 마지막 catalog source16, focused unit60, parity3141/진단0, 변경 lint 및 Next16.3.8/Node24.21.0 production build/CSS 통과. build source는7cb7f73b이며 후속 변경은 테스트 모듈 분리와 증거다. Ubuntu npm CI에서 SDK 전체 mock 세 개가 실제 StorageApiError export를 제거하는 문제가 발견됐다. short-url-page와 account-deletion-contract를 각각 별도 process로 옮겼다. 모든 기존 테스트를 그대로 실행하며, 최종 Linux/Windows CI 판정은 새 HEAD의 원격 결과가 필요하다.

이전 SQL fixture·SDK mock·잘못된 개발 origin 검사 실패를 failed-attempts-admin-forward-v2.json에 연결했다. v3 PG17 결과는 이전 readback guard이고, v5 결과가 현재 source 해시에 결속된다. rollback은 membership/manifest/functions/relations/policies/defaultACL/constraints/data fingerprint가 일치했다. Storage metadata 부재는 로컬 합성 fixture에서 실제 Storage service flag를 모사했으며 HTTP 삭제·실제 이미지 이전과 구분한다.

운영 SQL·사진 이전·배포·물리 기기 사용은0이다. native Astra 호출0. 실제 SDK console 사건, 유효한 cache memory 재측정, Galaxy 두 브라우저, prospective field cohort는 완료되지 않았다. 기존 cache 후보의 admission0과 실패 guard를 유지한다. source promotion 및 배포는 최신 CI·운영 catalog·rollback·다른 담당자의 변경을 대조한 뒤 develop→data→main 순서로 직렬 진행해야 한다.

재현: pinned Python3.12+로 verify_admin_media_forward_v1.py --run-id <새 v1..v6>를 실행한다. 실제 db 이름이 이미 있으면 거절한다. 기본 PG17 template은 앞선 canonical9 schema-only proof가 필요하고 container는 networknone/portsnone이어야 한다. 공개 render 검사는 build_admin_forward_v1.mjs와 browser-readiness-admin-media-v35.mjs이며, env 파일을 바꾸거나 키를 출력하지 않는다. 기존 출력이 있으면 덮어쓰지 않는다.
