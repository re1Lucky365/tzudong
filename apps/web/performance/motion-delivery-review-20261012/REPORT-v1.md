# 트랜지션 전달 전 회귀 수정

트랜지션·스크롤 소스를 검토하면서 모바일 리뷰 시트의 접근성 경합, 모바일에서 리뷰를 닫은 뒤 남는 화면 전환 가드, 정상 OCR 사진을 정리 대기로 세는 결함을 추가로 수정했다. 과거 증거의 원자료·지도·해시는 보존했다. 이 보고서는 로컬 소스·production 빌드·합성 브라우저 흐름의 결과이며 운영 배포, 실제 로그인, 실기기 또는 field 성과가 아니다.

최종 소스는 `cc14014db5d8199260aabc9b1e30f63c3fc1e134`, 비교용 앱 빌드는 `uy4y-gS3pEl9YZy1_RLGD`, 수정 후 빌드는 `mjio1rgGX_hXAqTZ6x-mZ`다. 수정 후 stamp 소스 SHA256은 `4418cc36774792e55e9ab910579f5665320f64ee77b169568e2083181c791da9`이다. build receipt의 dirty source는 이 최종 커밋의 파일 바이트와 연결해 검증한다.

| 흐름 | 환경·표본 수 | 지표 | Before | After | 절대 변화 | 상대 변화 | 노이즈·신뢰구간 | 판정 | 증거 경로 |
|---|---|---|---|---|---|---|---|---|---|
| 리뷰 작성 열기·닫기·화면 확대 | Chrome154, 390/820/1440×900, variant별 새 browser 1개 안의 9개 context | 접근 가능한 작성 버튼·닫기·desktop 전환 실패 | 3/9 | 0/9 관찰 | 3건, 33.3%p 감소 | 관찰 실패 건수 100% 감소 | 독립 실행 n=1/variant; cache·background 부하 미통제. CI/일반 발생률 추정 없음 | 해당 반복에서 개선 관찰; 확증·완전 제거 아님 | stamp-before-v9.json, stamp-after-v9.json |
| OCR 사진 교체 후 owner cleanup | 격리 Supabase PostgreSQL17.6, 합성 before/after DB 각 1개 | 정상 참조 사진의 잘못된 pending | 1 | 0 | 1건 감소 | 100% | 결정적 기능 검사; 통계 CI 대상 아님 | 사진·live stage row 보존, 진짜 retired work·권한·rollback 통과 | owner-cleanup-pg17-v2.json, owner-permissions-v1.json |
| 과거 증거 검증 | 새 경로의 sparse Git checkout, Python normal/-O, Node24 | 원본 정상/변조 거부와 checkout-local validator | 현재 소스 drift, assert 제거, 원래 Mac 경로 의존 | 4개 verifier 정상 입력 통과; 양 모드 변조 거부 | 기능 교정 | 비율 계산 없음 | unittest 3개 안의 여러 종속 probe; 성능 표본 아님 | 통과, 과거 소스로 명시 결속 | verifier-tests-v4.log, historical-validation-v1.json |
| 브라우저 console | 위 동일 기능 검사의 종속 이벤트 | 분류되지 않은 error 수 | 12 | 9 | 3건 감소 | 25% | 반복/부하·원인 분리 부족 | 개선 입증 안 됨, browser health clean=false | stamp-before-v9.json, stamp-after-v9.json |

낮을수록 좋은 수량의 절대 감소량은 before−after, 상대 변화는 (before−after)/before×100이다. 작은 종속 표본의 관찰 비율을 실제 사용자 확률로 일반화하지 않는다. 0 기준선에서 배수·개선율을 계산하지 않았다. 기존 트랜지션과 스크롤 성능 수치를 이 표의 개선율과 합산하지 않는다.

## 원인과 변경

상세 BottomSheet와 작성 BottomSheet가 동시에 modal이면 각각 sibling을 aria-hidden/inert 처리하고 focus를 가둔다. 실행 순서에 따라 작성 화면은 보이는데 역할 기반 탐색에서 버튼을 찾지 못했다. v7의 820px, v9의 실패 3개 screenshot은 보이는 작성 화면을 보존한다. 관련 소스와 동작을 대조해 작성 중 상세 시트에 `modal=false`를 전달하고 상세 닫기를 차단했다. 상세 DOM·선택·높이 상태는 유지한다. 공유 BottomSheet나 인증 경계를 약화하지 않았다. 새 delay/debounce/timeout 또는 강제 reflow를 제품에 추가하지 않았다.

리뷰 close callback은 모든 breakpoint에서 continuation ref를 먼저 해제하고 desktop redirect만 조건부 수행한다. 기존 callback은 모바일에서 ref를 계속 보유했다. 실제 callback 실행 검사는 7개 continuation test 안에 포함된다. 초기 v5 브라우저 baseline은 이 별도 ref 결함을 재현하지 않았으므로 해당 화면 실패의 전후 개선 수치는 주장하지 않는다.

OCR staging은 live 사진에도 incomplete row를 남긴다. 기존 owner finish RPC의 count가 모든 incomplete row를 세어 정상 사진이 pending이 됐다. 새 CLI 생성 forward migration `20261011175912_review_owner_cleanup_completion.sql`은 retired·unreferenced·incomplete만 센다. 실제 사진, staging row, RPC signature/metadata/ACL, G014 assertions/manifest/memberships는 보존한다. 기존 applied SQL은 수정하지 않는다. canonical units140와 관련 receipt/parser/후속 검사 수를 함께 정합화했다. 반환 count 필터 교정으로 전체 큐의 검색 복잡도는 바뀌지 않으며 시간 단축 주장이 아니다.

증거 verifier는 실제 snapshot의 Git commit592b1415/3fdc25d1에 source hash를 대조한다. 과거 packet을 현재 파일로 다시 핀하지 않았다. 트랜지션·스크롤 verifier의24개 assert는 explicit failure로 바꿨다. frozen Node command는 실행 이력으로 보존하고 현재 Node24와 checkout-local validator/root로 새 argv를 만든다. 허용한 validator/인수 형태만 실행하며 shell을 쓰지 않는다. 다른 경로 정상 실행, 양 모드 map 변조 거부, checkout-local script 교체 probe를 확인했다.

## 검증과 보존한 실패

웹 full final:3442 pass/11 skip/0 fail. 관련 Python109 pass(baef 소스), 이후 확장 verifier3 pass(54b 소스). lint, native7.0.2/compat6.0.2 parity3146 inputs/diagnostics0, Next16.3.8 build와 actual route CSS gate 통과. `FINAL-v1.json`은 각각의 원시 로그 hash를 기록한다.

PG17 apply/rollback은 named network-none/ports-none synthetic clone에서 postgres actor로 수행했다. 익명·service 실제 호출은42501, claim 없는 authenticated 호출은 NULL이다. 정상 사진 pending1→0, retired object가 존재하면 pending1, 삭제된 metadata이면 pending0을 확인했다. v1 fixture는 Supabase의 direct metadata DELETE protection42501로 실패했다. v2는 동일 local fixture에서 기존 Storage 테스트처럼 명시적인 metadata-delete 설정을 사용했으며 실제 Storage API·운영 객체를 삭제하지 않았다. 이전 실패와 소비된 DB를 보존한다.

source-tests-v2의 Python3.9 `enterContext`/`zip(strict)` 부재와 마지막 migration 이름 기대 실패는 보존했다. 핀한 Python3.12.14와 갱신한 canonical terminal unit으로 v3의109 검사를 통과했다. v1의40 검사는 더 좁은 범위였다.

browser v1은 합성 cookie와 runtime config 부재로 서버가 `/auth/required`를 반환했다. v3는 client Auth fixture와 cookie-free guest SSR을 분리했으나 미선언 user_bookmarks를400으로 응답했다. v4에서 이를 확인하고 v5 이후 빈 bookmark 계약을 명시했다. v5/v7의 작성 버튼 실패를 보존하고, 같은12초 조건·9개 시나리오의 v9에서 최종 소스를 확인했다. v9 Before는 최초 원본e3가 아니라 ref 교정 후·시트 교정 전 빌드다. 측정은 시트 변경의 개별 기능 효과만 비교한다.

페이지 오류0, 미지원 fixture0, mutation 시도0이다. console other12/9는 아직 원인 분리하지 않았다. screenshot은 실패 뒤 한 장씩이며 연속 프레임 기록이 아니다. 플리커 지속 시간, 하단 검은 사각형, 물리 터치·키보드 또는 완전한 접근성 인증을 증명하지 않는다. 타이밍 p95/heap/FPS·필드 통계는 측정하지 않았다.

## 기존 트랜지션 증거와 남은 작업

transitions-adoption-20261012의 필터/toast150ms·80ms, bounded retirement192→1은 그대로 유지한다. scroll-transitions-20261012의 actual SDK12 map drag에서 whole-document scan24/17/19→0, one-shot150ms/8px, 최대40 waiting panel, reduced-motion 대응도 유지한다. 네 과거 verifier를 -O로 다시 실행해 map/source/결론 경계를 확인했다. timer 수는 JS heap 해소 증거가 아니며 scan 수는 INP/FPS 개선률이 아니다.

운영 SQL/사진 이동/배포0, 실기기·field admission0, 전체 memory guard 해소 미입증이다. source delivery는 PR3147 exact CI와 conversation closure 후 develop→data→main을 따른다. 최신 운영 rollback/guard/project/catalog/ledger를 재확인하고 source·DDL·READY alias와 실제 흐름 readback을 따로 완료해야 한다. 휴대폰 없이 검증하라는 지시를 지켰다. 이 packet의 performanceAdmission0은 변하지 않는다.
