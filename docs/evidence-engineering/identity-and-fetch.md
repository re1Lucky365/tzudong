# 동일성 판정과 외부 수집

## 질의 단계

Thesis는 10단계라고 적고 1단계부터 5단계까지만 정의했다. 6단계에서 10단계의 질의 문구는 없다.

| 단계 | 종류 | 템플릿 |
| --- | --- | --- |
| 1 | exact | 원문 상호명 + 전체 도로명 주소 |
| 2 | exact | 원문 상호명 + 지번 주소 |
| 3 | exact | 시/군/구 + 원문 상호명 |
| 4 | broad | 시/군/구 + 핵심 키워드 + 업종 |
| 5 | broad | 과거 상호 + 행정동 |

5단계를 broad로 둔 이유는 전체 주소가 없고, 합의록이 광역 폴백을 후보 발견 전용으로 제한하기 때문이다. 선언된 단계 번호는 1 이상 10 이하의 정수다. 그 밖은 `invalid_query_stage`다. 6 이상 10 이하는 선언만 되어 있으므로 자동 확정하지 않는다.

자동 확정이 가능한 단계는 1, 2, 3뿐이다. 4단계와 5단계는 어휘 유사도와 150m 이내가 함께 있어도 `supported`가 되지 않는다.

## 거리와 문자열

Thesis 반경은 150m다. `distanceMeters`가 유한하고 0 이상이며 150 이하이면 반경 안이다. 150.0은 안이고, 그보다 크면 밖이다. 음수와 비유한 값은 `invalid_distance`다. 반경 안이라는 사실은 동일 매장이 아니다. 40m 떨어진 유사 상호도 다른 사업체일 수 있다.

레벤슈타인 거리는 코드 포인트 단위의 삽입, 삭제, 치환 비용 1이다. 빈 문자열끼리의 거리는 0이고 유사도는 1이다. 유사도는 `1 - distance / max(len(left), len(right))`다. 비교 길이가 200코드 포인트를 넘으면 `invalid_name_length`다. Gemini가 적은 유사도 0.82와 50m 확정 규칙은 채택하지 않았다. 거리 함수는 후보를 설명하는 순수 함수이고 자동 확정의 컷오프가 아니다.

## 자동 상태

파이프라인 단계 이름은 `candidate_discovered`와 `identity_evidence_checked`다. 자동 판정 결과는 그 둘을 반환하지 않는다. 종료 상태는 `supported | conflict | needs_review | closure_candidate`뿐이다. 반환의 `autoClosedStore`와 `autoRelocated`는 항상 `false`다.

입력 증거군은 다음만 허용한다. 같은 이름의 중복은 하나로 센다. 다른 문자열은 `unknown_evidence_family`다.

- `lexical_name_match`
- `exact_parcel_coordinate_match`
- `bounded_spatial_proximity`
- `telecom_identifier_match`
- `mois_public_license_closed`

전화번호 자체는 저장하지 않는다. 통신 식별 일치는 증거군 이름만 남긴다.

판정 순서:

1. `evidenceConflicts`가 참이면 `conflict`.
2. 폐쇄 원장이 완전하고, 동시에 exact 단계에서 검색 실패가 아니며 서로 다른 증거군이 2개 이상이면 `conflict`.
3. 폐쇄 원장만 완전하면 `closure_candidate`. `closed_store`가 아니다.
4. exact 단계이고 검색 실패가 아니며 서로 다른 증거군이 2개 이상이면 `supported`.
5. 그 외는 `needs_review`.

검색 결과가 없다는 이유만으로 `closed_store`를 주지 않는다. 인허가 상태가 폐업이라는 이유만으로 검색을 끊고 `closed_store`로 확정하지 않는다. `mois_public_license_closed` 하나와 검색 실패는 `needs_review`다.

완전한 폐쇄 원장은 다섯 필드를 모두 가진다. 하나라도 없거나 비어 있으면 레코드 자체를 `null`로 두어야 하며, 반쪽 객체를 넘기면 `invalid_closure_record` 또는 `invalid_calendar_date`다.

```text
ledgerId: 사업장 원장 식별자, 1자 이상 200자 이하
businessAddress: 사업장 주소, 1자 이상 200자 이하
effectiveOn: YYYY-MM-DD, 실제 달력 날짜
branchDistinction: 지점 구분, 1자 이상 200자 이하
sourceUpdatedOn: 원장 갱신일 YYYY-MM-DD
```

텍스트 필드는 제어 문자, `@`, 전화 형태를 거부한다. 사람 검수가 `approved`일 때만 `supported | conflict | closed_store | relocated`를 쓸 수 있다. `pending`과 `rejected`는 `needs_review`다.

`DATA_CONTRACTS.md`의 위치 성공 조건은 유지한다. 성공한 위치 일치는 이름과 서로 다른 증거군이 최소 2개다. 광역 단계는 그 조건을 만족해도 자동 `supported`가 아니다.

## 외부 수집 판정

계정 쿠키 재사용, 인증 우회, 프록시 분산은 복구 절차가 아니다. 판정 이름은 `accept | retry_later | stop_source`다. 같은 파일 앞부분의 `allow | disable_source`는 채택하지 않는다.

```text
challenge가 참이거나 status가 401 또는 403이면 stop_source
그렇지 않고 status가 429이거나 500 이상 599 이하이면 retry_later
그렇지 않고 status가 200 이상 300 미만의 정수이면 accept
그 외는 stop_source
```

`challenge`는 429보다 우선한다. 정수가 아닌 상태는 `stop_source`다.

`retry_later`는 무제한 재시도가 아니다. `mayRetryFetch`는 결정이 `retry_later`이고, 회로가 닫혀 있고, `attemptsUsed < maxAttempts`이며, 둘 다 0 이상의 안전 정수이고, `retryAfterSeconds`가 `null`이거나 0 이상의 유한 수이며, `dailyRemaining`이 1 이상의 안전 정수일 때만 참이다. 하루 상한의 숫자는 이 함수가 정하지 않는다. 이 함수는 대기하거나 다시 요청하지 않는다.
