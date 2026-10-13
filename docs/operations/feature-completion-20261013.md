# OCR·Gemini 스토리보드·롱폼 준비의 전달 상태

이 문서는 격리 후보의 구현·로컬 검증 장부다. 운영 DB 적용·배포·실제 사용자 처리 완료를 뜻하지 않는다. 원문 전체 요구는 `project-request-todos-20261009.md`에 유지한다.

| 대상 | 구현과 선택 근거 | 확인한 증거 | 남은 단계 |
| --- | --- | --- | --- |
| 영수증 OCR | fingerprint별 내구성 claim, dispatch 전후 구분, 불확실한 응답 재조회, 서버 결과 revision을 UI·save RPC·readback에 결합 | v5 source 18개 SHA 일치; 72/72 tests·819 assertions 및 같은 범위 독립 재실행; PG17.6 두 탭 stale revision 거부·경합·역할 거부 | 실제 catalog의 Storage immutable 경계·G014 계약, 운영 bucket/metadata 및 live 저장 |
| 영수증 업로드 | OCR과 upload에 같은 준비 완료 File 사용, 5MiB 초과·압축 실패는 ReviewModal의 quota/provider 진입 전에 거부 | 5–8MiB 실패 fixture의 quota/provider 각각 0; source-defined bucket 5MiB | 직접 OCR API는 기존 8MiB 한도를 유지; 실제 Storage overwrite 권한과 직접 S3 authority는 별도 검증 |
| 스토리보드 | 새 workflow는 Gemini-only, metadata readiness 전에는 claim하지 않음, 같은 worker의 정확한 text/image 모델 쌍 요구 | 131 tests; exact PG17.6 두 predecessor 체인 각각 30 assertions; 6테이블 archive guard·구 RPC late resume 차단 | 최종 독립 cutover 검토, actual catalog G014 및 hosted migration/deploy/live Gemini |
| 과거 스토리보드 | 문서·자산·편집·역사 읽기·export 유지, 이전 비Gemini 실행과 수동 import는 중지 | archive history digest 보존, active legacy job terminal 전환 | 실제 데이터와 운영 큐의 cutover readback |
| 롱폼 준비 | 완료 videos/streams에서 Shorts·live/upcoming/post_live 제외, 변경 가능한 입력을 1회 캡처하고 resume에 immutable snapshot 사용 | eligible 1,071·Shorts 81·caption 9·missing 1,062; 작성자25/25 및 마지막 독립3/3; 2-target mutable read13회→resume0회 | 전체 claude-video 시각·음성 분석 0/1,071; 공유 OSK materialization·운영 graph 갱신 |
| 운영 hold readback | requireAdmin 선행, 현재 immutable deployment ID·commit·hold를 runtime에서 확인하고 collector와 교차검증 | 78 관련 tests·206 assertions; 원격/운영 호출0 | in-flight 부재와 다른 writer fence 미입증; 전체5개 fence 계속 held |

데이터 보호 불변식은 `저장 revision = 현재 결과 revision`, `generation admission ∈ {0,1}`, `준비 완료 verification bytes ≤ 5×1024²`, `legacy workflow의 컷오버 이후 INSERT/UPDATE = 거부`로 표현한다. 읽기 작업량은 caption source 수에 대해 `O(N+C+K)`이며 고정 fixture의 13→0 읽기 횟수는 결정적 동작 검증이다. 처리 시간·RSS·금액 절감의 측정으로 해석하지 않는다.

실제 catalog 복제 통합 검증은 최종 frozen 두 migration을 적용했으나 실패했다. 새 service-role RPC와 trigger EXECUTE 8건이 G014 허용 목록과 불일치했고, predecessor의 authenticated UPDATE 정책이 immutable Storage 전제와 충돌했다. baseline `g014_pg17_workflow_owner_membership_denied`도 fixture actor/역할과 구분해 조사해야 한다. 실패 증빙 `pg17-existing-catalog-replay-final-frozen.json` SHA는 `4851f0dab3cb200b1b613b46b6da5eba58852b07733c5e4750784d0503b14fbf`이며 원본 clone hash 전후는 같고 소유 container cleanup은 확인됐다. 후속 additive SQL로 수정 중이며 기존 applied/frozen SQL과 이 실패 영수증을 덮어쓰지 않는다.

모델 ID는 text `gemini-3.8-flash`, image `gemini-3.1-flash-image`와 `gemini-3-pro-image`다. 공식 이름 지원과 기존 역사 canary는 현재 후보의 프로젝트 접근·청구·live 실행 성공을 대신하지 않는다. 이 후보 검증의 provider·hosted DB·Storage 요청과 배포는 0회다. 서로 겹치는 테스트·여러 predecessor 체인의 assertions를 하나의 독립 표본 수로 합산하지 않는다.
