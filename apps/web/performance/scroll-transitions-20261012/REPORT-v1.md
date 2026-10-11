# 스크롤 애니메이션과 문서 검색 비용 개선

설치한 transitions-dev / transitions-polish의 짧은 거리·명시적 속성·감소 모션 원칙을 기존 MY·관리 콘솔의 opt-in 섹션에 적용했다. 8px /150ms의 1회 전환이며, 첫 화면은 즉시 표시하고 대기 중인 구획도 opacity0.96으로 읽을 수 있게 유지한다. Row별 stagger·blur·상시 GPU promotion·지도 애니메이션·추가 폼 지연은 넣지 않았다.

실제 Naver 지도 production 흐름에서 12회 드래그 후, 불필요한 문서 전체 `[data-scroll-reveal]` 검색은 모바일24→0회, 태블릿17→0회, 데스크톱19→0회로 감소했다. 이는 해당 함수의 호출 수이며 전체 UI 응답속도·FPS·LCP·INP·heap 개선율이 아니다.

| 흐름 | 환경·표본 수 | 지표 | Before | After | 절대 변화 | 상대 변화 | 노이즈·신뢰구간 | 판정 | 증거 경로 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 지도 12회 드래그 | Chrome154 production CPU4,390×844; 조건당1프로세스·12종속 동작 | 드래그 중 문서 전체 검색 | 24회 | 0회 | 24회 감소 | 100% 호출 감소 | n=1, SDK 타일 타이밍 차이 가능, 시간 CI 없음 | 해당 불필요 작업 제거 관찰 | before-0.json / after-0.json |
| 지도 12회 드래그 | 같은 조건,820×1180 | 문서 전체 검색 | 17회 | 0회 | 17회 감소 | 100% 호출 감소 | 위와 같음 | 관찰 범위 통과 | 같은 원자료 |
| 지도 12회 드래그 | 같은 조건,1440×900 | 문서 전체 검색 | 19회 | 0회 | 19회 감소 | 100% 호출 감소 | 위와 같음 | 관찰 범위 통과 | 같은 원자료 |
| 관련 없는 200개 DOM 추가 | 실제 React production component/browser fixture,조건당1실행 | 추가 전후 전체 문서 검색 | 1→2 | 1→1 | 추가 검색1회 감소 | 100% 추가 호출 감소 | fixture 성질 검증; 전체 앱 벤치마크 아님 | 불필요 재검색 결함 수정 | browser-before-v2.log / browser-after-v2.log |
| 스크롤 효과 | 세 화면 component fixture | 설정 전환 시간 | 240ms | 150ms | 90ms 감소 | 37.5% 설정값 감소 | CSS 이론값; INP/입력 지연의 실측 아님 | 짧은 시각 피드백 | source.patch |
| 설정 변경/재삽입/키보드 | 같은 source를 실행한 browser6cases | 새 기준 검사 | 0pass/6fail | 6pass/0fail | 별도 성질 검증 | 개선율 계산 안 함 | 통계적 field 표본 아님 | 관찰자 수명·읽기·설정 대응 통과 | browser-before-v2.log / browser-after-v2.log |
| 주요 지도/필터/공유 흐름 | 세 viewport production fixture | page error /console error | 0/10 | 0/10 | 0/0 | 0% | CSP6+other4 잔여 오류 보존 | 새 오류 증가 관찰 없음; 전체 무오류 아님 | before/after JSON |

Before source `73edf0720d9ec3a8dcdfc1a102767ad52481cce6`의 ScrollEffects/product-ui는 `.next-media-followup-motion-v3` 빌드 source1c672aca와 동일하다. Before buildID r4jQUMb4BpNXlEyfppZm_, After source e3c710dc38cf9316a61c8d08e31a6d96c6e735ca /buildID b8y0Z3ltPMT5TUTaffO44. Next16.3.8/Node24.21.0/npm11.6.2/Bun1.4.0/Chrome154.0.8037.98, macOS26.6.2 arm64. REST735/Auth401은 합성 strict fixture이며 SDK/타일은 원격 그대로다. cache off/SW block/CPU4, network unthrottled. Before→After 묶음 순서이고 무작위 A/B·충분한 A/A·95% CI는 확보하지 않았으므로 전반적인 성능 개선으로 승인하지 않는다.

원인은 body 전체 MutationObserver가 모든 child mutation을 계기로 document 전체 selector를 반복한 것이다. 이전 비용은 RAF batch마다 문서 D 크기에 대한 검색 O(D); 새 구조는 추가된 subtree Δ만 찾고 제거 시 대기 W(최대40)만 확인한다. 대략 O(ΣΔ+R·W), 초기/모션 재활성화 시에만 전체 검색을 한다. 강하게 보존하는 waiting/queued의 고유 구획은 최대40이고 seen은 WeakSet이다. 이 복잡도 모델은 wall-clock 시간이 0이라는 뜻이 아니다. MutationObserver와 작은 subtree 확인 자체는 남는다.

모션 감소로 시작한 뒤 normal로 바꾸어도 초기화할 수 있도록 listener를 항상 등록하고, reduce로 돌아가면 IO/MO/RAF/queue를 정리한다. 제거·재배치한 waiting 구획은 즉시 기본 표시로 복귀한다. 오래된 IO callback은 현재 observer와 같을 때만 적용해 경합을 막는다. 키보드 focus는 해당 구획을 visible로 완료하고 다시 숨기지 않는다. 숨겨진 responsive header와 최초 viewport 콘텐츠는 모션을 기다리지 않는다. 데이터·선택·스크롤 위치·key·React 상태는 바꾸지 않는다.

browser-before-v1은 테스트 자체 timeout이 브라우저를 종료해 마지막 항목을 오염시킨 최초 실패다. 보존했고, 짧은 assertion timeout과 역사 소스/스타일 직접 번들 옵션을 더한 v2에서0pass/6fail을 온전하게 재현했다. CI에 Chrome이 없으면 browser lane은 skip이며 pass로 부르지 않는다. current Mac에서는6cases 모두 실행·통과했다.

최초 full-unit-v1은 별개 로컬 bridge test의 500ms 실행 기한 안에 부모/손자 PID 파일이 생겼는지 확인하지 못해1fail, 후속 isolated lanes는 미실행이다. bridge-retry-v1에서 같은 source/제한값으로24pass/0fail을 기록했다. 이 한 재시도로 원인·재발 방지를 확정하지 않는다. 전체 재실행 결과와 검사 pin은 FINAL-v1.json에 별도 기록한다. 최초 실패를 덮어쓰거나 timeout/검사를 약화시키지 않았다.

최종 source production build·실제 named-dist CSS gate와 targeted lint/native/compat parity는 통과했다. 실제 스크롤 hook·CSS를 production React로 번들한 fixture 검사와 실제 Next production Naver 지도 흐름은 다른 증거다. 실제 MY/admin 인증 사용자 화면·물리 Galaxy·삼성 인터넷·느린 네트워크/2000행/전체 heap guard·prospective field·운영 배포를 이번 결과로 완료 처리하지 않는다. 사용자 지시에 따라 휴대폰은 사용하지 않았다.

기존 transitions-adoption-20261012의108개 frozen artifact와 이전 두 통합 패키지는 변경하지 않았다. 해당 canonical-zero-v3의0 admission/console40/releaseBlocked를 그대로 보존하며 새 source의 성능 승인으로 재사용하지 않는다. 이번 문서 검색 count와 CSS 설정 시간은 canonical performance budget metric이 아니므로 성능 admission은0이다. 원래 장기 목표의 보호된 승격·배포·field/메모리 평가와 pending review Apply 상태는 별도로 남아 있다.
