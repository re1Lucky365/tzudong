# 키트 내부 모순

아래 항목은 문서를 맞추기 위해 지우지 않는다. Task 1 코드가 한쪽으로 동작하는 경우에는 그 동작을 같이 적는다.

1. Thesis 제7.1절은 `λ = 0.0015`의 반감기가 약 460일이라고 했다. 같은 식의 반감기는 `1 / 0.0015 = 2000 / 3`일이다. `D(460) = 100 / 169`다. 합의록 A01이 이 정정을 채택했다. 코드의 `thesisHalfLifeClaimIsExact()`는 `false`다.

2. Thesis 점수는 로그 가중합에 쌍곡선 감쇠와 선형 방문 승수를 곱한다. Gemini는 바닥 감쇠, MAD 로버스트 Z점수, 리뷰 로그 스무딩, 제곱근 식당 수 할인, 로그 방문 승수를 제안했다. 합의록은 바닥 감쇠의 형태와 로그 방문 승수의 형태만 조건부 채택하고, 계수와 `1 / N` 할인과 베이지안이라는 이름과 단일 곱셈 점수는 잠그지 않았다. Task 1은 `decay`, `visitsMultiplier`, `safeCount`, 분리된 `PopularitySignals`만 계산한다.

3. Gemini는 1825일에서 바닥 감쇠가 최소 59.1%라고 했다. `0.5 + 0.5 / (1 + 1825 / 460) = 549 / 914`, 약 60.06564551%다. 59.1%는 원래 쌍곡선의 `D(460)`과 숫자가 같다. 이 59.1%는 배포 숫자가 아니다.

4. 마스터 플랜은 W001부터 W024까지 있다고 하고, W012를 배지, W013부터 W024를 E2E와 Safe Area와 레이지 로딩으로 묶었다. 작업지시서 파일은 W001부터 W018까지이고 W012는 점수 계산, W013은 마커 CSS, W014는 Three.js, W015는 배지 에셋, W016은 폐업 안내, W017은 병합, W018은 렌더 측정이다. 작업 순서는 파일 제목을 따른다. Safe Area와 레이지 로딩은 파일 번호가 없으므로 마지막 마일스톤에 따로 둔다.

5. Thesis ADR-002는 10단계 질의라고 하고 5개만 적었다. Gemini도 6단계부터 10단계가 비어 있다고 했다. 코드는 1부터 5만 템플릿을 가지고, 6부터 10은 자동 확정하지 않는다.

6. 5단계 `과거 상호 + 행정동`을 broad로 분류한 것은 Task 1의 명시적 선택이다. Thesis는 번호를 매겼을 뿐 광역 여부를 적지 않았다. 전체 주소가 없으므로 4단계와 같이 후보 발견 전용이다.

7. Thesis와 Gemini 상태 이름은 `supported | conflict | closed_store | relocated`다. 합의록의 자동 전이는 `supported | conflict | needs_review | closure_candidate`다. 코드의 자동 판정은 합의록을 따른다. `closed_store`와 `relocated`는 승인된 사람 검수에만 쓴다.

8. Gemini `verify_candidate_with_two_evidence_families`는 인허가 폐업과 단계 3 이상이면 `closed_store`로 끊고, 단계 4에서도 어휘 또는 전화가 있으면 두 증거군으로 `supported`가 될 수 있다. 합의록은 그 자동 확정을 거부했다. 코드는 Gemini 함수를 실행하지 않는다.

9. ADR-003 인터페이스는 `evidence_level: 'SOURCE_OBSERVED'`만 허용한다. 제2절 L1은 간판과 공식 자막만 L1이다. 합의록은 수집과 검수를 나눈다. 코드는 일곱 레벨을 저장하고 L1 판정은 간판과 자막의 승인된 `SOURCE_OBSERVED`만 참이다.

10. Gemini SQL은 `timestamp_ms integer`다. 합의록은 `bigint`를 권한다. Task 1의 TypeScript 값은 0 이상의 안전 정수다. SQL은 아직 쓰지 않는다.

11. Gemini는 `frame_id` 길이 12 이상을 무결성으로 썼다. 합의록은 길이 검사가 콘텐츠 해시와 묶이지 않는다고 했다. 코드는 `frame_id`와 `content_sha256`을 둘 다 필수로 두고 서로 같아야 한다는 조건은 두지 않는다.

12. 마스터 플랜 시크 URL은 `https://youtu.be/{id}?t={sec}`다. `DATA_CONTRACTS.md`와 `buildCanonicalYouTubeWatchUrl`은 `https://www.youtube.com/watch?v={id}`다. 기존 정규화는 신원용 `youtube_link`에서 `t`를 제거한다. Task 1은 프레임 시크를 시청 URL에 `t`를 붙인 별도 필드로 만든다. `youtu.be` 형태는 빌더 출력이 아니다.

13. 합의록 파일 앞부분은 `FetchDecision`을 `allow | retry_later | disable_source`로 적고, 제8.4.3절은 `accept | retry_later | stop_source`로 적는다. 코드는 제8장의 세 이름을 쓴다.

14. Thesis 제7.3절은 정적 15KB WebP 배지이고 제7.5절은 같은 배지에 Three.js를 동적 로드한다. 합의록 A07은 정적 배지를 기본으로 하고 3D는 측정 전 실험이다. 코드 상수는 그 기본값을 고정한다. 15KB는 측정값이 아니다.

15. Thesis와 Gemini는 마커 `filter: drop-shadow`와 `will-change`로 60fps를 주장한다. Gemini는 이후 drop-shadow 애니메이션을 반박하고, 정적 배지면 Paint 0ms라고도 했다. 합의록 A08은 Paint 0ms를 거부했다. 코드는 drop-shadow 애니메이션과 무조건 `will-change`와 60fps 보장을 끄고, 마커 WebGL 수를 0으로 둔다.

16. 기존 `MapMarker.markerType`은 `"fire" | "star"`다. Gemini 패치는 `"fire" | "rainbow" | "star" | "standard"`를 제안한다. 인기 티어의 `fire`와 기존 마커 종류 `fire`가 충돌한다. Task 1은 식당 타입 파일을 수정하지 않는다.

17. W006은 엑셀과 Supabase의 양방향 동기화라고 했다. 합의록 A15는 재수집이 검수 이력을 지우면 안 된다고 했다. 이후 동기화 작업은 수집본이 검수 상태를 덮어쓰지 못하는 방향만 허용한다. 양방향 덮어쓰기는 요구 사항으로 남기지 않는다.

18. 제7.4절은 `pipeline-worker`가 프로덕션 `restaurants`에 인기 점수를 직접 갱신한다고 했다. `DATA_CONTRACTS.md`는 `hosted_apply`를 비인가로 두고, `batch_upsert_restaurants`의 CAS를 수집 행 보호에 쓴다고 Gemini가 인용했다. 합의록 A14는 그 RPC의 실제 SQL을 확인하기 전까지 `DEFER`다. A16은 점수 갱신이 원본 `updated_at`을 바꾸지 못하게 한다.

19. Thesis는 `visit_count`로 선형 승수를 계산한다. 합의록은 고유 `video_id` 개수를 쓴다. 같은 영상의 중복 행은 방문 횟수를 늘리지 않는다. 코드의 승수는 고유 아이디 집합이다.

20. 백분위 티어의 추정법, `P85`와 `P95`가 같을 때의 경계, 코호트에 식당이 하나일 때의 티어는 키가 정하지 않았다. Task 1은 백분위를 계산하지 않는다.
