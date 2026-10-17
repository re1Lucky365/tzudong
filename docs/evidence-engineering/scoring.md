# 인기 점수 계약

## 채택하지 않는 Thesis 식

맛집 `i`에 대해 Thesis는 다음 식을 제시했다.

```text
S_i = (w_v * ln(1 + V_i) + w_c * ln(1 + C_i) + w_l * ln(1 + L_i) + w_r * ln(1 + R_i)) * D(t_i) * M_i
D(t_i) = 1 / (1 + λ * Δt_i)
λ = 0.0015
w_v = 1.0
w_c = 2.5
w_l = 1.5
w_r = 3.0
M_i = 1 + 0.2 * (visit_count - 1)
```

`V_i`는 조회수, `C_i`는 댓글 수, `L_i`는 좋아요 수, `R_i`는 서비스 리뷰 수, `Δt_i`는 게시일 이후 경과 일수다. 티어는 코호트 백분위다. `S_i >= P95`이면 `fire`, `P85 <= S_i < P95`이면 `rainbow`, 그 외는 `standard`다.

이 곱셈식은 프로덕션 점수가 아니다. `THESIS_SCORE_WEIGHTS.adopted`는 `false`다. 선형 방문 승수 `0.2`도 프로덕션 승수가 아니다.

쌍곡선 반감기 정정은 채택한다. `D(t) = 0.5`가 되는 날은 `t = 1 / λ = 2000 / 3`일, 약 666.6666667일이다. `D(460) = 100 / 169`, 약 0.5917159763이다. Thesis가 말한 460일 50%는 거짓이다. 460일은 `exp(-λt)`의 `ln(2) / λ`, 약 462.1일과 혼동한 값이다.

## 채택하는 순수 함수

감쇠 가능 부분의 반감기 형태는 다음과 같다. 계수 `floor`와 `halfChangeDays`는 호출자가 넘긴다. `classicFloor = 0.5`, `decayableHalfLifeDays = 460`, `visitGamma = 0.25`는 제안값이며 `locked`는 `false`다. 함수 기본값으로 쓰지 않는다.

```text
decay(days, floor, halfChangeDays) = floor + (1 - floor) / (1 + days / halfChangeDays)
```

전제: `days`, `floor`, `halfChangeDays`가 모두 유한하다. 아니면 `non_finite`. `days < 0`이거나 `floor < 0`이거나 `floor >= 1`이거나 `halfChangeDays <= 0`이면 `invalid_decay_parameters`. 미래 게시일은 `days < 0`으로 거부한다. `days = 0`이면 결과는 1이다. `decay(460, 0.5, 460) = 0.75`다. 460일은 전체 가중치의 반감기가 아니라 감쇠 가능 부분의 반감기다. `decay(1825, 0.5, 460) = 549 / 914`, 약 0.6006564551이다.

원래 쌍곡선은 비교용으로만 남긴다.

```text
hyperbolicDecay(days, lambda) = 1 / (1 + lambda * days)
hyperbolicHalfLifeDays(lambda) = 1 / lambda
```

`lambda`의 기본 인수는 Thesis 값 0.0015다. `lambda <= 0`이면 `invalid_decay_parameters`다.

방문 승수는 고유 `video_id` 집합의 크기를 쓴다.

```text
visitsMultiplier = 1 + gamma * log1p(max(0, uniqueCount - 1))
```

`gamma`가 유한하지 않거나 음수면 `invalid_gamma`. 빈 집합과 영상 1개의 승수는 1이다. 같은 아이디를 여러 번 넣어도 한 번으로 센다. 아이디는 기존 11자 유튜브 아이디 규칙과 같아야 하고, URL 전체를 아이디로 받지 않는다.

신호는 네 필드를 곱하지 않은 채로 둔다.

```text
PopularitySignals {
  video_engagement: finite and >= 0
  freshness: decay 결과
  visit_multiplier: visitsMultiplier 결과
  platform_review_signal: number | null
}
```

`SCORING_GATES.multipliedScoreAdopted`는 `false`다. 단일 `S_i`를 이 계층에서 만들지 않는다.

## 개수 해석

`safeCount(value, maximum)`은 합의록의 `safe_count`다.

- `null`과 `undefined`는 결측이다. 반환은 `null`이다.
- `true`와 `false`는 결측이다.
- 정수 0과 문자열 `"0"`은 실제 0건이다.
- 문자열은 쉼표를 제거한 뒤 Python `int`가 받아들이는 정수 문법만 허용한다. `+`, 자리 밑줄, 앞자리 0을 포함한다. `"1.5"`, `"1.0"`, 공백이 섞인 숫자는 결측이다.
- 음수는 결측이다.
- 유한한 정수가 아닌 숫자는 결측이다. JavaScript는 `1.0`과 `1`을 구분하지 못하므로 안전한 정수는 개수로 받는다.
- `Number.MAX_SAFE_INTEGER`를 넘는 자릿수는 결측이다.
- `maximum`은 0 이상의 안전 정수여야 한다. 아니면 `invalid_maximum`. 유효한 개수가 상한보다 크면 상한으로 자른다.
- 리뷰 항의 이름은 `parsed_review_count`다. 베이지안 사후평균이 아니다. `ln(1 + R / (1 + τ))`와 `τ = 1`은 기각한다.

## 영상 단위 집계

한 영상의 조회수, 댓글 수, 좋아요 수를 그 영상에 나온 식당 수로 나누지 않는다. `1 / N`과 `1 / sqrt(N)`은 채택하지 않았다. 노출 시간과 소개 비중을 이 계약이 알지 못하기 때문이다.

`aggregateUniqueCounts`는 `video_id`마다 한 번만 더한다.

- 같은 아이디와 같은 해석 개수는 한 행이다.
- 같은 아이디의 결측과 0, 또는 서로 다른 개수는 `duplicate_video_conflict`다.
- 결측 아이디는 `missingVideoIds`에 두고 `knownSum`에 0으로 넣지 않는다.
- 알려진 합이 안전 정수를 벗어나면 `non_finite`다.

## 티어 메타데이터

백분위 추정법은 Thesis가 정하지 않았다. 이 계층은 `P85`와 `P95`를 계산하지 않는다.

이미 계산된 배정은 다음을 모두 가져야 한다.

```text
scoring_version, cohort_version, computed_at, popularity_tier, popularity_score
```

`popularity_tier`는 `fire | rainbow | standard`만이다. `popularity_score`는 유한해야 한다. `computed_at`은 `YYYY-MM-DDTHH:mm:ss.sssZ`다. 버전 토큰은 1자 이상 64자 이하의 `[A-Za-z0-9._-]`다.

서로 다른 `scoring_version`, `cohort_version`, `computed_at`을 한 코호트로 섞으면 `mixed_scoring_cohort`다. 이 함수는 가장 높은 티어를 고르지 않는다. 빈 입력은 `empty_cohort`다. 같은 코호트 안에서 식당마다 티어가 다른 것은 허용한다.

점수 레코드는 `restaurant_popularity_metrics`에 속한다. 필드는 `canonical_key`, 0 이상의 `source_revision`, 위의 배정 필드다. 식당 행의 `updated_at`을 바꾸지 않는다. 공개 `SELECT`를 기본 허용으로 두지 않는다.

배포 전 전체 코호트 shadow 비교는 필수다. 재현 입력이 없는 상관계수 `r = -0.9090`, `r = 0.1296`과 763개 몬테카를로 결과는 배포 게이트 숫자가 아니다.
