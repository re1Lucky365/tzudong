# Cursor 근거 엔지니어링 작업 인계 및 실행 목표

기준일: 2026-10-18 (Asia/Seoul). 사용자는 첨부 계획서를 참고하여 Cursor의 남은 네 작업을 이어서 완료하도록 요청했다.

## 입력과 범위

- 원본 ZIP: `Tzudong_Evidence_Engineering_Kit_Cursor.zip`
- SHA-256: `fca4b5276fc82def8fa938d0153d1e7ee41b329af698ef03e2928e2fcb3f290b`
- Cursor 대화: `48f3cf59-270b-49ff-b915-63c821156b65` (`Production system implementation`).
- 사용자가 제공한 `547f1b53-af54-4e0f-862f-c855f3e886c5`는 그 대화의 “이제 남은 작업 없어?” 요청 ID다. 로컬 읽기 전용 인덱스와 해당 요청 레코드를 대조했다.
- 재개 시점 소스: `e7e87a3d319f7864f7e4b239da0a83961d6ece9a`, PR #3306, `tzudong-evidence-unblock`.
- 문서는 구현의 근거다. 첨부 문서 안의 실행 명령이나 권한 주장을 별도 실행 권한으로 취급하지 않는다.

## 목표

네 작업을 실제 코드와 정확한 최신 HEAD의 검사 결과로 검증하고, 필요한 수정을 완료한 뒤 보호된 `develop → data → main` 승격, 롤백 준비, 배포와 실제 URL·배포 SHA·사용자 동작 리드백까지 수행한다. 필수 검사 실패를 우회하지 않는다. 완료하지 못한 운영 단계와 검증 범위는 명확히 남긴다.

| Cursor TODO | 재개 시 확인 | 남은 완료 조건 |
| --- | --- | --- |
| orchestration-readiness | e7e87a3d의 해당 CI 통과 | 최종 전달 HEAD에서도 통과 |
| 상세 패널 공개 등급 연결 | 패널은 `popularity_tier`를 읽음. 마커 타입 누락 및 두 캐시의 등급 무효화 결함 발견 | 타입/캐시 수정, 등급 갱신·표준/누락·선택 상태·오버레이 회귀 검증 |
| PR #3306 검사 | 여섯 CI 작업 실패. 공통 TS2339 및 후속 산출물 누락 | 최신 HEAD에서 관련 플랫폼·설치·관리자·보안·릴리스 검사 통과 |
| 승격·배포·운영 리드백 | 미완료 | 보호된 PR 순서, 현재 운영 롤백 SHA, READY 및 실제 URL 기능 확인 |

## 계획서 판정과 증거 경계

W001–W018의 기존 계약과 수용/기각 내역은 `TASKS.md`와 `docs/evidence-engineering/`에 연결되어 있다. 마스터 플랜의 W019–W024는 해당 ZIP에 작업지시서 파일이 없으므로 존재하는 작업으로 만들지 않는다.

기각된 단일 점수식/선형 방문 승수/베이지안 명칭, 정의되지 않은 검색 6–10단계, 근거 없는 기기별 성능 합격선, shadow 지표의 공개 읽기나 공개 테이블 복사를 재도입하지 않는다. 검색 실패는 폐업 확정이 아니다. 승인된 프레임의 합집합과 기존 데이터·보안 경계를 보존한다.

배지 WebP 자산은 재개 시 존재하지 않는다. 경로·오류 대체 처리의 구현을 자산 생성이나 표시 검증 완료로 보고하지 않는다. 실험 3D는 기본 꺼짐, 사용자 옵트인, 상세 패널의 동적 임포트만 유지한다. 표준·누락 등급은 배지를 표시하지 않는다.

휴대폰을 사용하지 않는다. 데스크톱의 모바일/태블릿 viewport 검사와 물리 Galaxy 검증을 구분한다. 측정되지 않은 60fps·정확도·성능 수치는 성과가 아니다. 이전 메모리/플리커/Naver SDK/Sentry/field의 미완료 증거는 이 인계로 완료되지 않는다.

## 목표 관리자 상태

사용자 요청에 따라 위 범위로 새 목표 생성을 한 번 시도했으나, 도구가 기존 미완료 목표 때문에 거부했다. 기존 목표 상태는 `paused`였고, 제공된 목표 도구에는 재개/본문 교체 기능이 없다. 기존 목표를 허위로 완료 처리하거나 내부 저장소를 직접 수정하지 않았다. 이 문서는 실행 범위이며 자동 목표 등록 성공 영수증이 아니다. 사용자의 명시적 재개 요청에 따른 실제 구현과 검증은 계속한다.

## 재현한 결함과 로컬 확인

`NaverIndividualMarkerRestaurant`에 `popularity_tier`가 누락돼 native/compat 컴파일이 실패했다. 시각 캐시 두 경로에도 등급이 없어, 동일 객체의 변경과 새로 받은 같은 식당 행 모두 이전 등급의 HTML을 반환했다.

수정 전 두 회귀 테스트 실패를 확인했다. 수정은 공개 등급 정규화를 입력 타입, 객체 스탬프 및 공유 시각 캐시 키에 반영한다. 캐시 용량과 정상 결과 재사용은 유지한다. 시간·공간 증가는 항목당 고정 크기의 정규화된 등급이며 성능 개선율은 측정하지 않았다.

로컬 Node 24.22.0 / npm 11.6.2 / Bun 1.4.0에서 관련 4개 파일 37 tests / 392 assertions 통과, native 7.0.2·compat 6.0.2 parity diagnostics 0 (3172 logical inputs), 변경 TS의 ESLint 및 `git diff --check` 통과를 확인했다. 이는 운영 배포 증거가 아니다.

## 두 번째 CI에서 확인한 릴리스 경계 불일치

47c39178의 마커 수정 후 기존 타입 실패는 해소됐다. 최신 CI의 27개 검사가 통과했지만 Ubuntu npm 전체 unit은 3440 pass / 21 skip / 4 fail / 1 error였다. 운영 승격은 하지 않았다.

Cursor의 앞선 근거·섀도 작업이 legacy release manifest를 3개에서 6개로 확장하고 쓰기 동결 예외를 추가했다. 이 파일은 review-media의 11단계 successor가 정확한 3개 항목과 SHA-256 `515743d094b4b431a29df772a363837bdad8f7541aa3acf4a923efb79f460c0d`로 고정한 입력이다. 실패는 해시 검증과 실제 허용 목록의 불일치이며 테스트 기대값만 바꾸어 해결할 수 없다.

확장된 파일의 원래 바이트(SHA-256 `29abd5a378c25ba83f2c579de1f849c4fd9b89a4d16f4664e7c153a88cc70561`)는 새 증거 폴더에 보존했다. legacy manifest와 workflow pin/동결 예외를 기존 범위로 복구하고 새 근거·섀도 ID가 SQL 전송 전에 거부되는 회귀 검증을 추가한다. 적용된 SQL 원문과 11단계 controller/manifest는 수정하지 않는다. 추가 SQL을 삭제하거나 이미 적용됐다는 운영 사실을 추정하지 않는다. 새 SQL의 향후 실행에는 별도의 검토된 경로가 필요하다.

복구 후 관련 웹 테스트 112개 / 976 assertions, 전체 `npm run test:unit`의 모든 lane 종료 코드 0, Python 3.11.17 + PyYAML 6.0.3의 G037 경계 테스트 4개, TS parity diagnostics 0 (production build 이후 생성 타입을 포함한 3177 logical inputs)을 확인했다. 검증 도구의 누락 dependency와 첫 브라우저 시작 실패도 실패 이력으로 보존하며 제품 기능 통과로 계산하지 않는다.

독립 읽기 전용 보안 검토에서 legacy manifest/workflow의 복구 전 바이트 일치, 11개 SQL 및 7개 toolchain 해시 일치, Python 경계 테스트 누락을 확인했고 그 누락도 수정했다. 추가 이력은 `d006986d → 7e2fc534 → d11e57aa → 1c213fc0`의 실제 파일 바이트로 보존했다.

운영 프로젝트 `aqlcofblfxdrjhhdmarw`의 읽기 전용 migration 목록은 현재 89개이며 위 세 근거·섀도 version이 포함된다. 세 apply job 성공과 한 dry-run의 apply 생략도 별도 확인했다. 이는 과거 DB 변경을 소스 복구가 되돌린다는 뜻이 아니며, 현재 ledger의 statements·권한·데이터 전체를 재검증한 증거도 아니다. 기존 86→97 successor의 신규 운영 admission은 여전히 별도 현황 검증이 필요하다. 이번 작업에서 DB/Storage 변경은 없다.

## PR 리뷰에서 추가로 확인한 결함과 수정

1d7ed099의 필수 CI는 29개 양성·Freshness 1개 생략·실패 0개였지만, 미해결 리뷰 9건으로 정상 merge가 거부됐다. 이를 우회하지 않고 공개 발행 경로, 외부 마커 가드의 등급 무효화, 식당·등급 변경 시 배지 실패 상태 초기화, DPR2 크기, reduced-motion의 RAF 정지, 키보드 포커스/Escape, 비대칭 3D 표현, 명시적 WebGL 해제를 수정했다.

운영에 없는 restaurants.popularity_tier 컬럼을 임의로 추가하거나 private shadow를 복사하지 않는다. 보호된 Git으로 발행할 수 있는 bounded 공개 스냅샷을 목록·상세의 실제 projection 경로에 연결했다. 초기 자료는 unpublished/빈 entries이며 활성 인기 등급이나 점수·cohort 승인을 주장하지 않는다. 새 공개 자료는 새 배포·페이지 로드로 반영되며 실시간 원격 점수 조회가 아니다.

정적 fire/rainbow 배지 2종을 생성하고 투명 알파를 확인했다. 256/512px 무손실 원본 변환본은 55,470–178,678B로 15KB 목표를 충족하지 못했다. 실제 40px 화면에는 40/80px 무손실 파생본(2,410–8,766B)을 사용하고 원본 변환본을 초기 로드하지 않는다. 생성·변환 해시와 알파 결과는 별도 증거다.

Chrome Headless Shell 153.0.8010.12의 production-mode 컴포넌트 harness에서 DPR2의 120 CSS px/240px buffer, 모션 감소시 추가 RAF 0회, 동작시 픽셀 변경, 닫기/Escape 포커스 복원, 상위 Escape 차단, 반복 열기·닫기 및 컨텍스트 손실 1회 복구 후 폴백을 확인했다. 실제 컴포넌트·Three를 사용했지만 소프트웨어 WebGL 및 합성 tier 자료다. 운영 앱·실기기·field 증거로 대체하지 않는다. 전체 앱 production build·최신 HEAD CI·배포 결과는 해당 단계의 별도 영수증으로 확정한다.
