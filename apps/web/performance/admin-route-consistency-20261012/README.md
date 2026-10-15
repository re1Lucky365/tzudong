# 개인정보 사고 관리자 화면: 현재 소스 결합 증빙

## 현재 결론

현재 검토 대상은 HEAD `a45a6bb4989e588ddb02ac6c23ada44eb11cfdb0`에서 수정된 `/admin/privacy-incidents`와 그 읽기 상태 모델이다. 로컬 production bundle의 BUILD_ID는 `VsVqwHP7JPw_Dah--3Lp1`이며 `v2/runs/reviewed-20261013/` 아래 증빙에 결합된다.

- 빌드: Node 24.21.0, Next 16.3.8, 종료 코드 0, 소스 manifest 423개 전후 일치, 현재 소스 재읽기 423/423 일치
- 단위 검증: 4개 파일, 47 통과, 0 실패, 419 assertions
- TypeScript parity: 논리 입력 3,150개, diagnostics 0
- 현재 UI: native Chrome CUA에서 390×844, 1024×844, 1440×900 반응형 상태를 관찰했고, 초기 실패·빈 성공·성공 후 갱신 실패·지연 후 성공을 합성 데이터로 확인했다.
- stale 상태: 첫 성공의 `3건 · 기한 위험 2건`을 보존한 채 갱신 실패 안내가 표시됐다.
- 지연 대기 상태: AX 관찰은 영수증에 있으나 별도 스크린샷은 없다.
- 복원: 반응형 폭 400, 기기 도구 모음 해제, DevTools 종료가 영수증에 기록됐다.

현재 렌더 영수증은 `v2/runs/reviewed-20261013/privacy-current-render-receipt.json`, 단위·parity 영수증은 `privacy-reviewed-unit-parity-receipt.json`, 빌드 영수증은 `privacy-build-receipt.json`이다. 저장된 JPEG의 픽셀 크기는 CUA 앱 창 캡처 크기이며 반응형 viewport 자체의 정확한 geometry 증명이 아니다. viewport 값과 관찰 문자열은 렌더 영수증에 기록돼 있다.

## 합성 시나리오와 실행 경계

v2 loopback gateway는 GET 진입으로 독립 시나리오 쿠키를 초기화한다.

- `/__fixture/scenario/default`: 기존 합성 사고 3건, 기한 위험 2건
- `/__fixture/scenario/initial-failure`: 초기 조회 503
- `/__fixture/scenario/successful-empty`: 빈 목록 200
- `/__fixture/scenario/delayed-success`: 800ms 뒤 성공
- `/__fixture/scenario/success-then-refresh-failure`: 첫 조회 성공, 다음 조회 503

시나리오 제어 쿠키는 합성 전용 HttpOnly 쿠키이며 앱 서버로 전달하지 않는다. API 변경 메서드는 403이다. 공급자, 운영 DB, 실제 OAuth, 실제 개인정보, 앱 변경 요청에는 접근하지 않았다.

동일한 frozen bundle을 사용한 두 런타임 시도는 시작·종료 영수증이 모두 있으며 종료 코드 0과 의존성 정리 성공을 기록한다.

- `runtime-attempts/resume-20261013/`
- `runtime-attempts/scenario-sweep-20261013/`

최초 `privacy-runtime-start.json`은 중단된 초기 시도의 시작 기록만 있고 종료 영수증이 없어 성공적인 lifecycle 판정에서는 제외한다. `privacy-runtime.log` 파일은 인벤토리에 넣지 않는다.

## 현재 증빙의 한계

이 묶음은 로컬 합성 UI 증빙이다. 다음은 입증하지 않는다.

- 정확한 요소 geometry 또는 픽셀 단위 레이아웃 적합성
- 브라우저 console 무오류
- 성능 개선이나 전후 지연 비교
- 운영 OAuth, 운영 DB, 공급자 호출, 배포 또는 실제 기기 동작
- 법률 판단, 외부 신고·제출 또는 관리자 승인 결과

`privacy-cua-native-width24-failed-input.jpg`는 요청한 폭이 생성되지 않은 진단 캡처다. 바이트 보존을 위해 현재 맵에 포함하지만 viewport acceptance에서는 명시적으로 제외한다. 지연 대기 상태는 AX 관찰만 있고 스크린샷이 없다.

## Ubuntu 테스트 이식성 델타

PR #3195의 Ubuntu 실행에서 실제 HOME `/home/runner`가 일반 `/home/*` 규칙보다 먼저 명시 경로 규칙에 의해 `<LOCAL_PATH>`로 치환됐다. 두 값은 모두 안전한 redaction 결과이므로 production helper는 변경하지 않았다. 테스트는 실제 HOME을 변경하지 않고 합성 Linux HOME을 민감 경로 입력으로 전달한 뒤 `<LOCAL_PATH>`와 `<USER_HOME>`을 `<REDACTED_PATH>`로 정규화해 정확한 전체 메시지와 원본 경로·사용자명 부재를 함께 검증한다.

`privacy-fixture-portability-delta-20261013.json`은 이전 맵 SHA-256, 변경 전후 테스트 SHA-256, helper 불변 SHA-256과 좁은 재검증 결과를 보존한다. fixture 테스트 18개와 149 assertions가 통과했고 대상 ESLint 경고·오류는 0건이다. 현재 423개 앱 빌드 입력과 기존 빌드·런타임·렌더 영수증은 변경되지 않아 전체 빌드와 UI 재캡처를 반복하지 않았다.

## 역사 자료

루트와 `v2/` 바로 아래의 기존 PNG·JSON·README는 과거 소스와 frozen bundle에 대한 역사 자료다. 과거 페이지 SHA-256은 `572ac666db2f7f66a852557bacab63b64851056838ef11efa7dbd60a2db057a2`, 현재 페이지 SHA-256은 `e22616985864f9d19f9d16bc91dab114fb22d76de0e8f6dbd6c814a3d73df79b`로 서로 다르다. 과거 build manifest의 421개 소스, 과거 BUILD_ID, PNG와 소스 해시는 현재 렌더 증명이 아니다.

불변 역사 인벤토리는 다음과 같다.

- `artifact-map-31-historical.json`: 원본이 남아 검증 가능한 31개 역사 자료
- `artifact-map-35-historical.json`: 원래 35개 인벤토리
- `excluded-historical-artifacts.json`: 원본이 없어 현재 증빙에서 제외한 과거 로그 4개
- `historical-reproduction-sources-a45a6bb4/`: 현재 도구로 교체되기 전 reproduction source 5개

역사 인벤토리와 제외 영수증은 수정하지 않았다. 현재 `artifact-map.json`은 현재 파일의 실제 바이트를 다시 해시하며, 자기 자신과 `artifact-map.sha256`은 순환 참조를 피하기 위해 artifacts 목록에 넣지 않는다.

## 인벤토리 규칙

`artifact-map.json`은 다음을 구분한다.

- 현재 소스·테스트 결합
- 현재 빌드·검증·렌더·런타임 lifecycle 증빙
- 현재 viewport acceptance에서 제외된 진단 입력
- 과거 영수증·렌더·인벤토리
- 보존된 과거 reproduction source

완료된 현재 빌드 출력 로그는 보조 진단 자료로 맵에 포함하지만 비교 성능 증빙으로 사용하지 않는다. 런타임 로그는 lifecycle JSON 대신 사용하지 않으며 현재 artifacts 합계에서 제외한다. 맵 검증은 모든 artifact와 source binding의 크기·SHA-256, 역사 sidecar, 현재 sidecar를 실제 파일에서 다시 읽어 비교한다.

현재 빌드 출력 로그는 보조 진단 자료로 로컬에만 보존하며 Git 인벤토리에서는 제외한다. 원문 바이트를 whitespace 검사를 위해 변경하지 않았고, 제외 파일의 원래 크기·SHA는 현재 map의 `localDiagnosticExcluded`에 기록했다. 빌드·소스·단위·렌더 영수증은 계속 필수 artifact다.
