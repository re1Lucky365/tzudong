# GitHub CI 증분 감시와 다음 최적화 방향

PR [#3168](https://github.com/twoimo/tzudong/pull/3168)의 CI 간소화에 읽기 전용 감시를 추가했다. 광범위한 기존 목표는 일시중지 상태이며, 이번 사용자 요청으로 CI 감시만 수행한다. 운영 DB·배포·병합·워크플로 재실행·한도 증액은 수행하지 않는다.

## 수학적 선택 기준

병렬 job의 대기와 실행을 각각 \(q_j,t_j\)라 하면 \(T=\max_j(q_j+t_j)\), 러너 점유량은 \(R=\sum_j t_j\)다. 비용 청구와 두 시간을 혼동하지 않는다. 임계 경로에 없는 작업의 단축은 전체 완료 시간을 줄이지 않을 수 있다.

수집은 목록 페이지 \(P\), 갱신 attempt job set \(A\), 캐시되지 않은 소스 조회 \(S\)에 대해 API 읽기 \(O(P+A+S)\), SQLite 조회는 건당 \(O(\log H)\)다. 중복 키는 `(run_id, attempt)`이며 검증된 완료 기록만 재사용한다. 신규 분석은 \(O(r(j+s))\), 체크포인트 읽기·쓰기는 \(O(H)\), bootstrap은 코호트·지표마다 \(O(B(n_0+n_1))\)다. 전체 작업을 상수 시간이라고 주장하지 않는다.

이벤트·러너 계열·워크플로 blob·실행 모드·job topology가 다른 결과는 분리한다. 소스 tree마다 중앙값을 만든 후 군집 bootstrap 10,000회로 명목 95% 구간을 계산한다. 전후 각각 성공 7개와 소스 tree 7개 미만이면 개선 판정을 보류한다. p95는 각각 소스 군집 20개부터 표시한다. 반복 관측과 여러 지표의 검정은 오탐 위험을 높이므로 모든 신호는 탐색용이다. 인과적 개선·기존 G003 scorer 승인·금액 절감으로 승격하지 않는다. 새로운 워크플로 버전에는 새 비교 기준선이 필요할 수 있다.

탐색 경보는 95% 구간 전체가 절대·상대 임계값을 동시에 넘을 때만 발생한다.

| 지표 | 절대 기준 | 상대 기준 |
| --- | ---: | ---: |
| 임계 경로 | 30초 | 5% |
| 러너 점유량 | 120초 | 5% |
| 최대 대기 | 20초 | 25% |

이는 감시용 정책이며 기존 compiler 성능 승인 기준을 바꾸지 않는다. 실패·취소·미완료·tombstone은 시간 표본에서 제외하고 별도 집계한다.

## 수집·재시작 경계

- 최초에는 최근 20개만 수집한다. 이후에는 워터마크에서 48시간 겹치는 구간을 페이지당 20개, 최대 5페이지 읽는다. 목록 밖 기존 active run은 최대 100개 직접 확인한다. 각 run은 최근 attempt 최대 10개를 보존한다.
- 페이지 total 변화·중복 경계·상한 도달은 coverage 경보가 된다. 불완전한 구간에서는 워터마크를 전진시키지 않는다. 전체 GitHub 이력을 수집했다고 주장하지 않는다. 알려지지 않은 아주 오래된 run의 재실행은 48시간 목록 범위 밖에서 발견되지 않을 수 있다.
- run과 attempt별 job 수·완료·시간을 확인한다. 불완전한 completed 응답은 다시 확인하고, 이후 변경된 검증 완료 분석은 fail-closed 처리한다.
- 고정 기준선의 완료 attempt는 변경하지 않는다. 뒤늦게 페이지로 발견한 과거 기록은 after 표본에 넣지 않는다. 기준선 시점 이후 시작한 신규 실행·재시도만 after로 분석한다.
- 기준선 hash·네 소스 파일 hash·설정이 바뀌면 수집 전에 중단한다. tick 잠금, SQLite 트랜잭션, atomic/fsync 체크포인트로 겹친 실행과 부분 기록을 보호한다. 유실된 tick 영수증은 완료 attempt를 다시 분석 표본에 추가하지 않고 복구한다.
- collector의 기본 최대 2,000 attempts와 기준선 최대 100개를 합쳐 analyzer 입력 상한 2,100개로 맞췄다. 체크포인트는 5,000개를 넘으면 보존 후 새 명시적 창이 필요하다. 자동 삭제·무한 보존 정책을 만들지 않았다.
- 읽기 시간은 요청당 30초, tick 수집 300초·분석 60초로 제한한다. 모델·raw log·사용자·자격 증명·임의 provider 진단을 저장하지 않는다.

## 실제 관측

환경: macOS arm64 공유 호스트, Python 3.14.8, 현재 인증된 `gh`의 읽기 전용 GitHub REST API. 공급자 네트워크·캐시 영향을 포함한다. 초기 기준선 20개는 성공 17·실패 1·취소 2, 소스 tree 10개다. 변경 후 표본은 아직 없다.

| 실험 | 전 → 후 | 절대 차이 | 감소율 | 95% 구간·표본 |
| --- | --- | ---: | ---: | --- |
| 초기 최근 20개 재조회, API 요청 | 53 → 1회 | 52회 | 98.11% | 동일 기록 1쌍, 추정 구간 없음 |
| 초기 최근 20개 재조회, 수집 시간 | 33.453 → 1.074초 | 32.379초 | 96.79% | 1쌍, 불확실성 미추정 |
| 60개 구간 catch-up → 재조회, API 요청 | 115 → 3회 | 112회 | 97.39% | 동일 기록 1쌍, 추정 구간 없음 |
| 60개 구간 catch-up → 재조회, 수집 시간 | 74.044 → 3.859초 | 70.185초 | 94.79% | 1쌍, 불확실성 미추정 |

초기 20개 실험은 pagination 보완 전의 진단용 영수증이다. 최종 60개 실험은 같은 수집 코드와 동일 record 배열을 사용했다. 첫 catch-up은 이미 캐시된 20개를 재사용하며 나머지 40개를 채웠다. 전체 cold 60개 실험으로 부르지 않는다. 재조회는 job set 60개를 모두 재사용하고 목록 3페이지를 실제 읽었다. 두 수치를 CI 실행 시간·요금 절감으로 일반화하지 않는다. 프로그램의 모델 호출과 원격 mutation은 각각 0회다. heartbeat 자체의 Codex 토큰 사용은 별도이며 0이라고 주장하지 않는다.

기존 중복 compiler 제거의 7쌍 로컬 결과는 평균 43.76 → 22.17초, 평균 쌍별 절감률 49.00%, 95% 구간 40.42–56.72%다. 그 실험과 이번 수집 실험은 [기존 보고서](github-ci-performance-20261010.md)와 구분한다.

## Opus 독립 검토와 다음 방향

설치된 OpenCodex 2.77.0의 실제 catalog·지원 API를 확인한 뒤 기존 OAuth 경로 `google-antigravity/claude-opus-5-5`, reasoning `high`로 검토했다. 모델·라우터·유료 한도를 변경하지 않았다. [공식 proxy 문서](https://opencodex.me/reference/proxy-formats/)와 [GitHub workflow runs API](https://docs.github.com/en/rest/actions/workflow-runs)를 확인했다.

첫 요청은 출력 제한에서 잘려 최종 검토를 받지 못했다(13,141 reported tokens). 좁힌 두 번째 요청은 완료됐다(3,566 reported tokens, 29.527초). 합계 16,707 reported tokens이며 실제 금액은 확인하지 않았다. 완료한 최종 검토와 두 시도의 영수증을 모두 보존했다. 이후 정기 수집마다 Opus를 호출하지 않는다. 새로운 복잡한 병목의 해석이 필요할 때만 사용한다.

직전 후보 실행 `38044128078`의 Windows Bun job은 721초 중 benchmark/report가 481초(66.7%)였다. 이 구간을 절반으로 단축할 수 있다면 해당 job의 작업량 모델은 721 → 480.5초다. 다른 job이 새 임계 경로가 될 수 있으므로 전체 CI의 예상 단축으로 쓰지 않는다. 관측은 1개이며 Windows Bun은 이전 기준 710 → 721초로 11초 악화했다. 다음 개선은 이 측정 구간의 중복·I/O를 확인하는 것으로 정하고, 샘플·scorer·검증 coverage는 유지한다.

## 실행과 증빙

6시간 주기 thread heartbeat는 아래 프로그램을 호출한다. mutable 상태는 저장소 밖 runtime-cache에 둔다. 반복되는 실패·coverage·성능 신호는 같은 키로 중복 알림하지 않는다. 새로운 문제가 있으면 원시 실행과 source tree를 확인하고, 변경은 별도 검증된 PR로 제안한다. 운영 적용이나 자동 병합을 허용하지 않는다.

```sh
python3 .github/scripts/run-ci-monitor.py \
  --state-dir /Users/twoimo/.codex/runtime-cache/tzudong-ci-monitor-20261011 \
  --baseline apps/web/performance/ci-monitor-20261011/baseline.json \
  --baseline-sha256 d8e08c6371f3dab93fdb3495d5b14266d457e6e0490876f1e2546177a0b89070
```

실행 Python은 프로젝트 `/Users/twoimo/Documents/projects/tzudong/.venv/bin/python3`으로 고정한다. 기준선·읽기 영수증·통합 첫 tick·분석·Opus 최종 응답·설정·소스 hash는 `apps/web/performance/ci-monitor-20261011/`에 보존한다. detached `artifact-map.json.sha256`으로 무결성을 확인한다. 공식 운영 개선으로 admitted한 slice는 0이다.

검증: 신규 감시 33개, 관련 Python 16개, Bun source contract 45개, Node classifier 6개 통과. workflow actionlint와 reconciliation도 통과했다. 감시 테스트는 pagination 절단·attempt 실패·손상 시각·scope 충돌·자료 유실·중복 실행·active tombstone·상한 정합성을 포함한다. 이 결과는 로컬 기능 검증이며 미래 heartbeat 실행이나 GitHub CI 성공을 대신하지 않는다.

최초 hosted 감시 테스트 step은 `38123487112`에서 2초로 통과했다. GitGuardian은 sanitization 테스트에 쓴 가짜 비밀번호 문자열을 Generic Password로 탐지했다. fixture는 비자격증명 표식으로 수정하고 33개 테스트를 재검증했다. 검사 설정은 유지한다. [공식 문서](https://docs.gitguardian.com/internal-monitoring/prevent/detect-secrets-in-real-time-in-github)대로 PR의 과거 커밋도 검사하므로 source 수정만으로 이전 탐지가 해결됐다고 주장하지 않는다.
