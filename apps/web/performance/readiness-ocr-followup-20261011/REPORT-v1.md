# OCR·미디어 후속 검증

일반 사용자 Storage 업로드의 SQLSTATE42501 경로와 OCR의 공개 영수증 잔존·유실 응답·공유 키 완료 판정을 수정했다. 이 문서는 **로컬 소스와 격리 PostgreSQL 검증**이다. 운영 SQL·배포·사진 이전은 아직 실행하지 않았으며, 이전 실제 리뷰 Preview1/Apply시도1/내용 commit 확인0은 별도 동결 패킷에 남는다.

| 흐름 | 환경·표본 | Before | After | 판정 | 증거 |
|---|---|---|---|---|---|
| 본인 영수증 업로드 | PG17.6, 합성 메타데이터, 각1회 | 42501 | 성공 | 해당 권한 경로 수정 | storage-fence-pg17-v7.json |
| 공유 영수증의 첫 교체 | PG17.6, 합성 공유키, 각1회 | 안전하게 남긴 행을 remaining1로 오판 | referenced 행 remaining0, 이미지 보존 | 해당 완료 판정 수정 | admin-staging-pg17-v3.json |
| 응답 유실 전 업로드 경로 보존 | Bun 전송 모사 + PG17.6 | 무작위 키를 DB에 남기기 전 Storage 호출 | STAGED를 확인한 후 전송, 유실 키 재발견 | 경로 수명주기 수정 | focused-ocr-v2.json, admin-staging-pg17-v3.json |
| Storage와 retirement 경쟁 | PG17.6, 실제 연결2개씩, 순서2개 | 늦은 privileged INSERT 허용을 관찰 | 업로드 선행은 객체 유지·pending, retirement 선행은23514/객체0 | 두 고정 순서 통과 | storage-fence-pg17-v7.json |
| 정책·트리거 변조 | PG17.6, 시나리오5개 | 변조된 합성 입력 | 모두 고정 오류·정확 rollback | fail closed | storage-adversarial-pg17-v2.json |

시간 성능·운영 발생률·메모리 개선은 측정하지 않았다. 위 결과는 기능·권한 판정이다. 표의 각1회를 독립적인 사용자 cohort로 부르거나 개선율·신뢰구간을 만들지 않는다.

변경 원리:

- 공개 bucket에서 내려받은 영수증은 JPEG가 같거나 커도 private bucket으로 이동하도록 한다. 압축 조건은 private 이미지의 불필요한 재업로드를 줄일 때만 사용한다. 기존 크기/MIME·정확 바이트 검사는 유지한다.
- service-only cleanup RPC에 stage를 추가한다. owner/review/purpose가 맞는 경로 하나만 기존 durable queue에 넣고, 확실한 STAGED receipt가 있어야 Storage를 호출한다. 실패·유실·잘못된 ACK는 성공으로 바꾸지 않는다.
- 공유된 원본은 전역 reference 검사로 보호한다. 마지막 reference가 끝날 때만 retire하며, 완료 수는 retired·incomplete·unreferenced 행이다. 제거 실패·공개 부재 불확실성은 pending으로 남긴다.
- Storage BEFORE STATEMENT에서 global lock을 먼저 얻는다. row guard는 INSERT와 bucket/name 변경 시 retired 키를 거부한다. 원래 review guard 본문은 그대로 보존한다. READ COMMITTED가 필요하며 다른 격리 수준은 기존 serializer가 재시도를 요구한다.
- 실제 운영에 남은 두 광고 정책의 arbitrary-ID 관리자 함수를 현재 사용자·active/disabled 상태의 직접 조건으로 바꾼다. 비공개 영수증 SELECT의 has_role 호출은 본인 경로 조건으로 바꾼다. 관리자는 기존 requireAdmin·server Storage 경로로 조회한다. raw 관리자 private-bucket 조회를 넓히거나 helper EXEC을 Data API에 주지 않는다.
- 세 forward SQL은 기존 applied SQL을 수정하지 않는다. owner/ACL/config/role membership/schema/default ACL/G014 manifest를 보존하며, Storage 트리거의 정확한 event/column/definition과 함수 해시를 readback한다. canonical ledger139와 media function15를 맞춘다. 늦게 추가됐던 readback도 원래 read-only transaction 안으로 옮겼다.

점근적 모델은 구현 선택을 설명할 뿐 실측 성능이 아니다. 동결 리뷰를 한 번 export한 뒤 전수 분류·hash 검증의 작업량은 레코드 수 N과 총 바이트 B에 대해 O(N+B)다. 업로드 stage는 경로 하나, drain은 최대20개로 제한한다. 큐 PK lookup은 인덱스 탐색이고, 전역 normalized reference 검사는 여전히 리뷰 수에 비례할 수 있다. 메모리·성능 목표가 paused인 상태에서 이 경로를 추측으로 인덱싱하거나 캐시하지 않았다. 이번 후속에서 새 Gemini/Astra/provider 호출0; 쿼타 절감량은 측정하지 않았다.

검증 범위:

- Web full unit3422 pass/11 skip/0 fail은 OCR route/helper 수정 뒤 기록된 실행이다. 최종 ledger139 후 affected54 pass/1313 assertions/0 fail을 별도 재검증했다.
- 관련 Python112 pass/0 fail, pinned Python3.12.14. 원 stdout은 tool transcript에 있고 이 패킷에는 사실/command/source binding만 기록한다. raw log라고 바꾸어 부르지 않는다.
- 최종 nativeTS7.0.2/compat6.0.2 parity3142 inputs/diagnostics0; OCR 관련 lint0. Node24.21.0/Next16.3.8 production v5 build+named CSS0, BUILD_ID `0R-5kSBdZ_C6nHqZFnDdK`. route/helper SHA가 현재 소스와 일치한다. 후속 SQL·ledger 수정은 해당 application bytes를 바꾸지 않았다.
- PG17.6.1.038, networknone/portsnone, 합성 fixture만 사용했다. 세 migration의 atomic rollback은 Storage triggers·정책·함수·ACL·manifest·schema·data count까지 동일했다. real lock wait는 pg_stat_activity에서 관찰하고 holder commit으로 해제했다.
- 이전 frozen592 패킷은 해당 Git blob으로 source binding을 검사한다. 현재139 소스와 예전136 source manifest가 같다고 주장하지 않는다. 실패·초기 fixture 오류·소비된 DB를 덮어쓰거나 지우지 않는다.

실패 보존: 첫 schema owner 가정, old source-contract/count failures, 비허용 계정 변경 fixture55000, private SELECT의 실제 has_role42501, 없는 fixture bucket23503, 이미 적용한 one-shot migration의 재실행, template 이름 변경, 잘못된 migration actor를 각각 남겼다. 최종 합격 표본에서 제외한 이유는 JSON에 고정되어 있다. 실행 순서·FP·fixture actor를 고쳐 검증했으며 운영 정책이나 보안 권한을 테스트 통과 목적으로 넓히지 않았다.

운영 잔여: PR3147 exact-head CI와 보호된 develop→data→main 승격, 최신 shared catalog/G014·rollback 확인, hosted forward 적용, 검토된8개 사진의 안전 이전·public denial·admin readback, READY 배포/별칭 SHA, 원래 불확실한 operation의 GET reconciliation과23개 draft의 새 preimage/Preview가 남았다. 기존 Gemini3.8Flash HIGH 전수1659개 결과·751개 승인 항목 중69개 근거확인 필요·47개 관리자 편집 보존 조건을 재사용한다. 전수 검사 완료와 운영 내용 정정 완료를 구별한다. 실제 OCR/Storage HTTP·물리 Galaxy·SDK pixels·field 검증은 이 패킷에 없다.
