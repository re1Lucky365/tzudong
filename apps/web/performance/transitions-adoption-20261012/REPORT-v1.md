# Transitions.dev 스킬 설치와 Tzudong 적용

무료 `transitions-dev` / `transitions-polish`를 설치하고, 카테고리 팝업·공통 토스트에 작은 모션을 적용했다. 감사 과정에서 토스트를 반복 닫을 때 오래 남는 삭제 타이머 누적도 재현·수정했다. **실제 브라우저의 여섯 번 공유·닫기 뒤 대기 타이머는 6→1개로 감소**했다. 이 수치는 타이머 수이며 전체 heap/RSS 개선이나 원래 메모리 guard 통과를 뜻하지 않는다.

설치 원본은 `Jakubantalik/transitions.dev@2773886681b6bb8effe0d7b5c66306430d18e000`이다. 설치 파일 42개가 해당 원격 Git blob과 일치한다. 글로벌 설정·모델·권한·기존 스킬 변경, Pro·relay·새 LLM 호출은 없다. 다음 턴부터 스킬이 자동 검색된다. 전체 소스 393개 중 모션 관련 56개 파일을 목록화했고, 실제 공개 표면과 기존 플리커 대응을 기준으로 적용/보존을 판단했다(AUDIT-v1.md).

모션 source Before는 `10d3ac0b3575d2dcc282381a99e57c3a10ac069c`, After는 `1c672acae8d2554c0eca1698d0f28e123099fe84`다. source-manifest-v1.json의 변경 7개 파일과 source.patch가 원인·수정 범위를 결속한다. Next 16.3.8 / Node 24.21.0 / npm 11.6.2 / Bun 1.4.0 / Chrome 154.0.8037.98, macOS 26.6.2 arm64. production build Before `I6A8JzmAqeqa3N8tX9IZA`, After `r4jQUMb4BpNXlEyfppZm_`. Dev 모드 결과를 성능 근거로 쓰지 않았다.

| 흐름 | 환경·표본 수 | 지표 | Before | After | 절대 변화 | 상대 변화 | 노이즈·신뢰구간 | 판정 | 증거 경로 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 토스트 192회 표시/닫기 | 실제 reducer + 가상 타이머; 조건당 1실행, 192종속 반복 | 대기 삭제 타이머 수 | 192 | 1 | 191개 감소 | 99.48% 감소 | 결정적 자원 계수; heap CI 아님 | 해당 누적 결함 수정 | toast-retirement-before-v1.log / toast-retirement-after-v1.log |
| 실제 맛집 공유/닫기 6회 | Chrome production, CPU4, 390×844 / 820×1180 / 1440×900; Before 1프로세스·After 3프로세스, 각 화면당 6종속 반복 | 대기 1,000,000ms 타이머 수 | 6 | 1 | 5개 감소 | 83.33% 감소 | Before n=1로 통계적 CI 산출 안 함. After 모든 반복에서 1. | 실제 해당 UI 누적 해소 관찰 | before-5.json / after-0..2.json |
| 토스트 진입 | 같은 세 화면, Before/After 각각 3독립 프로세스, 화면당 6회 | 브라우저 animation duration | 0ms | 150ms | −150ms (before−after) | 기준선 0이라 계산 안 함 | 광학 duration이며 INP/응답 지연 아님; p95/CI 미제시 | 디자인 모션 추가; 속도 개선 아님 | before-2..4.json / after-0..2.json |
| 데스크톱 카테고리 팝업 | 1440×900; 조건당 3독립 프로세스 | 진입 animation duration | 0ms | 150ms | −150ms | 계산 안 함 | 버튼·검색·선택·Escape는 완료를 기다리지 않음 | 작은 진입 효과; 닫기 즉시 유지 | normal/reduced 기록 |
| 모바일·태블릿 필터 | 390×844 / 820×1180; 조건당 3프로세스 | sheet animation duration | 0ms | 0ms | 0ms | 계산 안 함 | 관찰 환경 밖 주소창/회전/실기기 미검증 | 즉시 드래그/열기 유지 | before-2..4.json / after-0..2.json |
| 감소 모션 | 세 화면; After 3프로세스 + swipe1 | 토스트·팝업 animation | none | none | 0 | 해당 없음 | 토스트 transition은 all→none; 애니메이션 비활성 확인 | 통과 | toastReduced / reduced |
| CSS 전송량 | 실제 Before/After named dist, canonical CSS validator | home CSS 압축 바이트 | 46,613B | 46,990B | −377B | −0.81% | 빌드 산출물의 결정적 크기, 실행시간 CI 아님 | 작은 비용 증가 공개; 기존 budget 통과 | css-comparison-v1.json |
| 브라우저 오류 | 조건당 3프로세스, 각 세 화면 | console error/프로세스 | 10 | 10 | 0 | 0% | CSP6 + other4, 원문 비공개. 새 개선 입증 안 됨. | 잔여 오류 보존 | before/after JSON |

낮을수록 좋은 항목은 절대 감소량 `before−after`, 상대 감소율 `(before−after)/before×100`을 썼다. 새 모션과 타이머 정리는 서로 다른 변경이고 개선율을 합산하지 않는다. 테스트는 전/후 묶음 순서로 실행했으며 무작위 A/B와 충분한 A/A 신뢰구간을 확보한 앱 성능 실험이 아니다. 계수용 timer instrumentation은 exact delay만 추적하고 heap/메모리 성능 표본으로 승인하지 않는다. 원래 캐시·메모리 guard는 변경하지 않았다.

토스트 타이머 Map은 화면의 TOAST_LIMIT=1과 달리 이벤트 K회마다 O(K)로 증가했다. evicted/removed ID의 timer 취소, 없는 ID의 dismiss 무예약, 중복 예약 방지로 보존 상한을 O(1)로 묶었다. title·update·dismiss·12초 읽기 시간·오류 피드백·Radix ARIA/포커스는 유지한다. 브라우저 스와이프 취소/완료도 세 화면에서 통과했다. 마우스 기반 브라우저 포인터 검사이며 Galaxy 터치 검사로 부르지 않는다.

모션은 opacity 0.95와 8px/0.97 scale에서 시작해 읽을 수 있는 첫 프레임을 유지한다. 명시적 transform 전환, 단일 root CSS 소유, scoped reduced-motion을 사용했다. blur·상시 will-change·강제 reflow·새 JS 타이머·전환 완료를 기다리는 상태 업데이트를 추가하지 않았다. CSS 소유 수정 후 home 전체 CSS는 194,468→195,752B(+1,284B). 글로벌 지도 SDK와 큰 sheet의 모션을 덮지 않는다.

토스트 표시 후 약 220ms를 rAF로 관찰한 After 54회 중 opacity<0.9인 불필요한 소실은 **0회 관찰**됐다. 777프레임, 샘플 간격 중앙값 약16.7ms. 같은 프로세스의 반복은 종속이고, probe가 시작되기 전 첫 프레임·프레임보다 짧은 플리커·화면 위치 변화·SDK 픽셀·네비게이션 뒤 검은 사각형을 탐지하는 검사가 아니다. 해당 결함 전체 제거를 단정하지 않는다.

검증: 전체 웹 3,435 pass /11 skip /0 fail; focused 기존71 pass, 새 수명주기3 pass; targeted lint, native7.0.2/compat6.0.2 parity, 최종 production build와 실제 named-dist CSS gate 통과. 실제 Naver SDK/타일은 원격 그대로 로드했고 REST735/Auth401은 합성 fixture다. 신규 계정·리뷰·운영 DB를 쓰지 않았다. Screenshot은 synthetic 화면만 보관한다.

실패도 보존했다. before-0/1은 모바일을 데스크톱 combobox로 찾은 harness 오류다. unit-v1은 기존 소스 테스트의 오래된 fade class 계약 실패이며 동작 검증으로 대체·갱신했다. motion-v1 build는 중복 CSS import로 canonical CSS gate 실패; 컴포넌트 import를 제거하고 root 단일 소유로 고쳤다. canonical-zero-v1은 사건 정렬 오류로 scorer 실패, v2는 scorer 뒤 detached hash 생성 단계 누락으로 조립 실패했다. 기존 원자료를 정규화/덮어쓰지 않고 v3에서 규칙대로 새로 생성해 scorer와 독립 validator를 통과했다.

canonical-zero-v3는 items0/admissions0, console40 사건을 유지해 releaseBlocked=true다. 타이머 수와 광학 duration은 canonical CWV/performance budget 항목이 아니며 이를 앱 성능 성과로 억지 등록하지 않았다. scorer/validator PASS는 성능 승인·운영 배포 통과가 아니다. 기존 원래 메모리 후보/실패/실기기/field 미완료 증거는 유지한다.

소스·로컬 production 렌더링 검증은 끝났고, 운영에 이 변경이 배포됐다는 증거는 아직 없다. 보호된 develop→data→main, exact-head CI, READY/alias/SHA readback과 운영 재검증은 별도 전달 단계다. 사용자의 최신 지시에 따라 휴대폰을 사용하지 않았고 실기기 검증은 미검증으로 남긴다. prospective field 성과·전체 자연 heap guard/128검색/느린 네트워크/2000행 성능 통과도 이번 결과로 주장하지 않는다. 이번 작업 운영 DDL·사진 이전·배포0; 앞선 리뷰 Apply 시도1의 불확실한 상태를 덮거나 재전송하지 않았다.
