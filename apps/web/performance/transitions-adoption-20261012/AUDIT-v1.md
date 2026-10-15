# Transitions.dev 적용 감사

사용자가 요청한 저장소의 무료 Codex 스킬 transitions-dev / transitions-polish를 2773886681b6bb8effe0d7b5c66306430d18e000에 고정 설치했다. 각 파일 해시는 installation-v1.json에 있다. Pro, 로그인, 라이브 relay, 별도 모델 호출, 전역 설정 변경은 사용하지 않았다.

| 실제 표면 | 대응 레시피 | 적용 판단 |
| --- | --- | --- |
| 데스크톱 카테고리 Popover | 05-menu-dropdown | 작은 표면에만 t-dropdown opt-in, Radix origin/data-state 사용. 150ms 진입, 닫기는 기존처럼 즉시. 검색·선택·키보드는 애니메이션 완료를 기다리지 않는다. |
| 공유 성공/오류 등의 공통 Toast | 22-toast | 8px 짧은 진입과 150ms/80ms 시각적 비대칭, transform만 transition. 기존 의미·닫기·발표·12초 읽기 시간은 유지. |
| 모바일·태블릿 필터 BottomSheet | 07-panel-reveal | 기존 즉시 진입/드래그 유지. 높이·blur·지도 이동 애니메이션 추가는 배제. 실제 브라우저 재검증 대상이다. |
| 지도/마커/바텀 네비게이션 | 07/08/16 | 기존 플리커·레이아웃 의도가 있어 변환·key·remount·active pill을 추가하지 않았다. |
| 계정/리뷰 Dialog 및 큰 Sheet | 06-modal | 폼 상태/포커스/키보드/불확실한 저장을 보존. 일괄 새 모션 대신 기존 즉시 표시 유지. |
| 데이터 로딩/리뷰 목록/가상화 | 14/18 | 지연·stagger·cross-blur로 로딩 피드백이나 데이터를 가리지 않았다. |
| Accordion | 21-accordion | 현재 공개 흐름의 실제 호출 없음. 레시피를 넣어 성과로 보고하지 않았다. |
| 관리 콘솔 Storyboard | 31/32 | 다른 소유 작업/기존 시각 의도를 보존; 공유 파일을 광범위하게 변경하지 않았다. |

스킬의 원문 CSS 통째 복사/상시 will-change/blur/강제 reflow/timer 제안보다 사용자의 기존 성능·보안·접근성 제약을 우선했다. 레시피의 거리·원점·명시적 속성·감소 모션·열기/닫기 원리를 React/Radix 상태에 맞춰 적용했다. 새 JS, 상태, 이벤트 구독, 캐시, 모션 패키지는 없다. CSS rule/state 계산은 표면당 O(1)이고 리스트 수 N에 비례하는 애니메이션을 추가하지 않는다. 브라우저의 paint/composite 비용이 0이라는 뜻은 아니다.

감소 모션은 .t-dropdown/.t-toast에만 적용하고 SDK 전체를 덮는 wildcard를 쓰지 않는다. 등장 첫 프레임도 opacity 0.95로 피드백을 읽을 수 있다. 토스트 스와이프는 기존 Radix 이동 값을 따르고 cancel/end를 별도 처리한다. 자연 종료 시 상시 GPU promotion/filter를 남기지 않는다.

기준선 production 관찰에서 기존 토스트 animation은 0ms로 기록되었다. 소스에 남아 있던 animate-* 선언을 실제 150ms의 애니메이션과 동일시하지 않는다. 추가 시각 모션은 디자인 변경이며, 속도 개선·메모리 회귀 해소·field 성과를 주장하지 않는다. 애니메이션 지속시간과 입력-화면 지연/INP는 다른 지표다.

라이선스: Copyright (c) 2026 Jakub Antalik / Transitions.dev. 개인/상업 제품 안에서 수정·사용할 수 있고, 경쟁하는 전환 라이브러리로 재배포할 수 없다. 설치본 LICENSE.txt와 https://transitions.dev/terms.html 참조.


추가로 실제 reducer에 192 show/dismiss를 주입했을 때 1,000,000ms 삭제 타이머가 192개 남는 문제가 재현되었다(toast-retirement-before-v1.log). toast 수가 1개여도 타이머 Map은 이벤트 횟수 K에 비례해 O(K)였다. 새 토스트가 기존 항목을 밀어내거나 명시적 삭제가 발생하면 기존 timer를 취소하고, 존재하지 않는 toast의 dismiss는 예약하지 않는다. 보존 상한은 TOAST_LIMIT=1로 O(1)이다. 12초 표시 시간·수정·중복 dismiss의 기존 의미는 유지한다. 192→1 타이머는 이 한 경로의 99.48% 감소이며 JS heap, RSS, 전체 앱 메모리 회귀의 개선율이 아니다. 실제 공유 버튼 반복도 production 빌드에서 별도로 계수한다.

첫 motion-v1 production build는 CSS 중복 소유 검사에서 실패했으며 실패 원자료를 보존했다. 모션 CSS는 공통 컴포넌트 직접 import를 제거하고 최소 root stylesheet 하나에서만 소유하도록 수정했다. 기존 gate를 완화하지 않았고 motion-v2의 실제 named dist 검사는 통과했다. 마지막 hook 수정은 별도 motion-v3 build로 검증한다.
