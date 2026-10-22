# 렌더링과 저장 경계

## 마커

네이버 지도 마커에는 Three.js 캔버스를 만들지 않는다. 마커당 추가 WebGL 컨텍스트 수는 0이다. 기본 표현은 SVG 또는 WebP다. 불 효과와 무지개 효과는 `transform`과 `opacity`만 애니메이션한다. `filter: drop-shadow`를 키프레임으로 움직이지 않는다. 모든 마커에 `will-change`를 무조건 주지 않는다. 지도가 이동하는 동안 반복 애니메이션은 멈춘다. 화면 밖과 과밀 구간은 클러스터링한다. `prefers-reduced-motion: reduce`이면 애니메이션을 끈다.

`data-popularity-tier`는 `fire | rainbow | standard`다. 기존 `MapMarker.markerType`의 `"fire" | "star"`와 같은 단어 `fire`를 공유하지만 같은 필드가 아니다. Task 1은 `apps/web/types/restaurant.ts`를 바꾸지 않는다.

60fps 고정과 Paint 0ms는 불변식이 아니다. 타일, 이미지 디코드, 글꼴, 레이아웃이 페인트를 만들 수 있다. 나중에 재는 값은 기기별 p50과 p95 프레임 시간, 50ms를 넘는 Long Task 빈도, 배지를 넣기 전후의 차이, 패널을 반복해 열고 닫은 뒤의 메모리 추세, WebGL 컨텍스트 손실과 복구다. 임계 숫자는 기준선을 재기 전에는 확정하지 않는다.

## 상세 배지

### 2026-10-18 공개 발행 경로

현재 운영 `restaurants`에는 `popularity_tier` 컬럼이 없다. 공개 등급은 별도 소스인 `apps/web/lib/evidence-engineering/public-popularity-publication.json`을 보호된 Git 검토·승격으로 발행한다. 목록 병합과 상세 hydration은 같은 읽기 전용 인덱스를 사용한다. 공개 발행 v2의 각 항목은 정렬된 memberRestaurantIds 전체와 그 첫 ID인 canonical restaurantId를 포함한다. 검토된 모든 구성원 ID가 같은 항목의 등급을 조회하므로 youtube_meta 포함 여부에 따른 표시 대표 행 변경이나 부분 조회가 등급을 바꾸지 않는다. 새 구성원은 발행 자료를 갱신하기 전까지 standard다. 현재 병합 그룹에 미발행 구성원이나 서로 다른 등급이 섞이면 그룹 전체도 standard로 내린다. 다른 등급 중 높은 것을 고르지 않는다. private metrics/shadow의 등급이나 원시 응답의 동명 필드를 복사하지 않는다. 승인된 발행 자료가 없는 기본 스냅샷은 `unpublished`와 빈 entries이므로 모든 식당은 standard다. 형식 검증은 승인 영수증이 아니며 임의 점수·계수로 빈 자료를 채우지 않는다.

스냅샷은 항목과 전체 구성원 ID 각각 최대 5,000개·512KiB다. 중복·다른 그룹의 ID 충돌·정렬/대표 ID 불일치를 거부한다. 각 런타임의 모듈 로드 시 한 번 O(Q) 구성원 인덱스를 만들고 행마다 O(1)로 조회한다. 공유 상세 패널도 호출자의 popularity_tier를 신뢰하지 않고 같은 발행 인덱스로 조회하므로 모바일 리뷰 등 raw 행 진입도 동일하다. 추가 요청·검색별 캐시는 없다. `/api/public-popularity`는 동일 스냅샷과 SHA256 ETag만 제공한다. 새 발행 자료는 새 배포·페이지 로드로 반영된다. 원격 실시간 점수 갱신을 구현한 것은 아니다. 같은 ID의 등급이 달라지면 마커의 외부 렌더 가드와 HTML 캐시가 모두 무효화되며, 현재 결과 밖의 선택·검색 마커도 포함한다.

정적 배지는 40/80px 무손실 WebP를 40 CSS px의 1x/2x 소스로 사용한다. 256/512px 원본 변환본은 초기 화면에서 요청하지 않는다. 생성 원본의 해시·변환본 크기·알파 검증은 작업 증거에 보존한다. 15KB는 원본 변환본이 충족하지 못한 목표이며, 표시용 소형 파일은 실제 바이트를 별도 기록한다. 3D는 버튼을 누른 뒤 로드되고, DPR2에서도 120 CSS px를 유지한다. reduced-motion에서는 1회만 그리며 RAF를 예약하지 않는다. 닫기·Escape는 포커스를 원래 버튼으로 돌리고 상위 상세 패널 Escape에 전파하지 않는다. 실제 컨텍스트 손실은 1회 재생성 후 정적으로 대체하고, 종료 시 리스너를 먼저 제거한 뒤 dispose와 명시적 context loss를 실행한다.

기본 배지는 정적 WebP다. 표준 티어는 배지를 그리지 않는다. 실험 3D는 기본 꺼짐이고, 사용자가 켠 뒤에만 동적 임포트한다. 초기 렌더에서 Three.js를 로드하지 않는다. 뷰어를 구현할 때는 종료 시 리소스 해제, 컨텍스트 손실 복구, 렌더러 중복 생성 방지, 저전력 대체 UI, 키보드 접근을 포함한다. 36px에서 40px 배지 하나를 위해 초기 번들에 Three.js를 넣지 않는다.

Thesis의 에셋 이름은 `badge_popular_fire_3d`와 `badge_popular_rainbow_3d`다. 목표 형식은 알파가 있는 WebP다. 15KB 이하와 256, 512 정사각은 Thesis의 목표이지 측정된 사실이 아니다. GPT 이미지 생성은 이 계약의 순수 함수가 아니다.

상세 배지 호버는 `transform: scale(1.15)`만 적용한다. `prefers-reduced-motion: reduce`이면 확대하지 않는다. 이 확대는 마커 WebGL을 허용하지 않는다.

## 저장

`evaluation_results` JSONB 안에 검수 프레임이나 인기 점수를 넣지 않는다. 파이프라인 재수집이 그 JSON을 다시 쓰기 때문이다. 결측 변환은 `evaluation_results = null`일 수 있다.

두 위성 테이블의 소유권은 다음과 같다.

| 테이블 | 내용 | 금지 |
| --- | --- | --- |
| `restaurant_evidence_frames` | 불변 프레임, 콘텐츠 해시, 검수 상태 | 수집 작업이 검수 상태를 삭제 |
| `restaurant_popularity_metrics` | 점수, 티어, `scoring_version`, `cohort_version`, `source_revision`, `computed_at` | 식당 `updated_at` 변경, 일반 사용자 쓰기, 무조건 공개 읽기 |

`ON DELETE CASCADE`는 결정하지 않았다. Gemini SQL의 `uuid REFERENCES restaurants(id)`, `timestamp_ms integer`, `evidence_level = SOURCE_OBSERVED` 강제, `USING (true)` 공개 읽기를 그대로 적용하지 않는다. 실제 `restaurants.id` 타입과 RLS는 마이그레이션 전에 기존 스키마에서 확인한다. `batch_upsert_restaurants`의 200행 제한과 `updated_at` CAS는 SQL 정의를 읽기 전까지 `DEFER`다. 호스티드 `hosted_apply`는 계속 비인가다. 일일 04:00 KST 배치는 로컬 데이터 경계 안에서만 설계한다.

인기 점수를 같은 `source_revision`에서 알고리즘만 바꿔 덮어쓰려면 `scoring_version`이 함께 있어야 한다. 더 오래된 `source_revision`이 최신 행을 덮어쓰지 못한다. 같은 계산의 재실행이 중복 행을 만들지 못한다. 청크 성공은 배치 전체 성공이 아니다.

## 화면 병합

다중 방문 병합은 승인된 프레임을 `frame_id`로 합친다. 대표 행 하나의 프레임만 남기는 병합은 틀리다. 서로 다른 산출 시점의 티어 중 높은 것을 고르지 않는다. `youtubeLinks`, `tzuyangReviews`, `youtubeMetas`, `categories`의 기존 병합은 유지하고, 프레임과 티어 규칙을 그 옆에 추가한다.

상세 패널의 방문 근거 제목은 `이 맛집이 등록된 이유 (영상 속 실제 간판·장면)`이다. 카드 비율은 16:9다. 프레임 활성화는 해당 `youtube_seek_url`로 이동한다. `closure_candidate`, 검수된 `closed_store`, 검수된 `relocated`는 영업 중단 또는 상호 변경 안내와 네이버 플레이스 이동을 요구한다. 검색 실패만으로 그 배지를 켜지 않는다.

관리자 승인 API는 `requireAdmin` 이후에만 동작한다. 순서는 Preview, Confirm, Apply, Readback, Audit다. 오류 코드는 고정된 짧은 코드만 반환한다. 제공자 본문과 데이터베이스 오류 문자열을 반환하지 않는다.

판정 기록은 A01부터 A20까지다. `ACCEPT`는 방향의 수용이지 Gemini 패치의 줄 단위 수용이 아니다.

| ID | 판정 | 대상 |
| --- | --- | --- |
| A01 | ACCEPT | 460일 반감기 주장의 수학적 오류 |
| A02 | CONDITIONAL | 오래된 영상의 과도한 감쇠. 상관계수는 재현 전 |
| A03 | CONDITIONAL | 바닥 감쇠 형태. 계수는 미잠금 |
| A04 | REJECT | 리뷰 수를 베이지안 사후평균이라고 부른 식 |
| A05 | ACCEPT | 매장과 영상을 나눠 집계 |
| A06 | ACCEPT | 마커별 Three.js 배제 |
| A07 | CONDITIONAL | 상세 패널 3D는 실험 옵트인 |
| A08 | REJECT | 60fps와 Paint 0ms 보장 |
| A09 | REJECT | I-frame만으로 2fps 보장 |
| A10 | CONDITIONAL | 기존 프레임 파이프라인을 먼저 확장 |
| A11 | REJECT | 쿠키와 토큰 우회를 복구로 사용 |
| A12 | REJECT | 광역 검색의 자동 동일 매장 확정 |
| A13 | CONDITIONAL | 인허가 폐업은 동일성과 시점이 필요 |
| A14 | DEFER | 200행 RPC와 CAS는 SQL 확인 전 |
| A15 | ACCEPT | 수동 검수를 `evaluation_results` 밖에 저장 |
| A16 | ACCEPT | 인기 지표가 원본 `updated_at`을 바꾸지 않음 |
| A17 | REJECT | Gemini SQL을 그대로 적용 |
| A18 | ACCEPT | 승인 프레임의 아이디 합집합 |
| A19 | REJECT | 서로 다른 시점의 최고 티어 선택 |
| A20 | ACCEPT | 밀리초와 해시 프리픽스의 불변 키 |
