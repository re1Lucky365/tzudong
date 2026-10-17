# 렌더링과 저장 경계

## 마커

네이버 지도 마커에는 Three.js 캔버스를 만들지 않는다. 마커당 추가 WebGL 컨텍스트 수는 0이다. 기본 표현은 SVG 또는 WebP다. 불 효과와 무지개 효과는 `transform`과 `opacity`만 애니메이션한다. `filter: drop-shadow`를 키프레임으로 움직이지 않는다. 모든 마커에 `will-change`를 무조건 주지 않는다. 지도가 이동하는 동안 반복 애니메이션은 멈춘다. 화면 밖과 과밀 구간은 클러스터링한다. `prefers-reduced-motion: reduce`이면 애니메이션을 끈다.

`data-popularity-tier`는 `fire | rainbow | standard`다. 기존 `MapMarker.markerType`의 `"fire" | "star"`와 같은 단어 `fire`를 공유하지만 같은 필드가 아니다. Task 1은 `apps/web/types/restaurant.ts`를 바꾸지 않는다.

60fps 고정과 Paint 0ms는 불변식이 아니다. 타일, 이미지 디코드, 글꼴, 레이아웃이 페인트를 만들 수 있다. 나중에 재는 값은 기기별 p50과 p95 프레임 시간, 50ms를 넘는 Long Task 빈도, 배지를 넣기 전후의 차이, 패널을 반복해 열고 닫은 뒤의 메모리 추세, WebGL 컨텍스트 손실과 복구다. 임계 숫자는 기준선을 재기 전에는 확정하지 않는다.

## 상세 배지

기본 배지는 정적 WebP다. 표준 티어는 배지를 그리지 않는다. 실험 3D는 기본 꺼짐이고, 사용자가 켠 뒤에만 동적 임포트한다. 초기 렌더에서 Three.js를 로드하지 않는다. 뷰어를 구현할 때는 종료 시 리소스 해제, 컨텍스트 손실 복구, 렌더러 중복 생성 방지, 저전력 대체 UI, 키보드 접근을 포함한다. 36px에서 40px 배지 하나를 위해 초기 번들에 Three.js를 넣지 않는다.

Thesis의 에셋 이름은 `badge_popular_fire_3d`와 `badge_popular_rainbow_3d`다. 목표 형식은 알파가 있는 WebP다. 15KB 이하와 256, 512 정사각은 Thesis의 목표이지 측정된 사실이 아니다. GPT 이미지 생성은 이 계약의 순수 함수가 아니다.

호버 확대 `scale(1.15)`는 Thesis의 상호작용 목표다. 마커 WebGL을 허용하는 근거가 아니다.

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
