# 2026-10-12 UI·Gemini source 전달 증빙

이 디렉터리는 `dd0c790be7ffc94a86f95126aa60019ded8ff9b7` 기반 전달 후보의 합성 loopback UI 검증을 보관한다. 이식된 기존 261개 UI·Gemini 산출물은 각각의 frozen source와 실행 환경에 대한 역사적 증빙이다. 현재 후보의 commit, PR, 보호 검사, 배포 또는 운영 동작을 입증하지 않는다.

`artifact-map.json`의 `changedSources` SHA·bytes는 build `HcJtq7WT9AGLOOijoRGrZ` 당시 결합을 보존하는 **역사적 source binding**이며 현재 소스 결합이 아니다. 최초 `source-reconciliation-delta-20261013.json`도 두 파일만 비교한 중간 checkpoint로 보존한다. 현재 checkpoint `bb6f9228209c9a4a8251ca2e182428f7021d6a3e`의 `source-reconciliation-delta-20261013-v2.json`은 검토로 바뀐 역사적 binding 5개와 역사 목록에 없던 관련 source 2개를 별도로 결속한다. 이는 선택된 counterpart 정정일 뿐 전체 `changedSources`·579개 build manifest 검증이 아니며, build·브라우저 readback·provider 호출은 재실행하지 않았다.

## 헤더 보정 결과

변화율은 `(후값 - 전값) / 전값 × 100`으로 계산했다. 음수는 높이 감소다.

| 보정 | 전 → 후 | 절대 차이 | 변화율 | 표본과 환경 |
| --- | ---: | ---: | ---: | --- |
| 사용자 관리 데스크톱 헤더 | 77 → 57px | -20px | -25.97% | 보정 전·후 각 `n=1`, 1423×954. `initial-desktop-render.json`의 build `eswzT-sFIORGW3eyYZ0Kt`와 `second-build-header-render.json`의 build `STpIA_Q_8M_46VV2A7HMt` |
| 배너 관리 모바일 헤더 | 163 → 113px | -50px | -30.67% | 보정 전·후 각 `n=1`, 390×844. second build와 `third-build-header-render.json`의 build `S3htZTxU6dtVvs3lBNoM4` |
| 맛집 관리 모바일 헤더 | 121 → 113px | -8px | -6.61% | 보정 전·후 각 `n=1`, 390×844. second build와 third build |

최신 third build는 Node 24.21.0, Next 16.3.8 공식 webpack production bundle, Chrome extension, 합성 loopback 데이터 환경에서 실행했다. hosted DB와 provider는 비활성화했다. 15개 메뉴 × desktop/tablet/mobile 3폭, 총 45조합을 모두 관측했다. desktop/tablet 헤더는 전부 57px이고, mobile에서 액션이 있는 대상 헤더는 113px이다. 제목 잘림, body/header 수평 overflow, 44px 미만 모바일 버튼 위반은 모두 0건이며 mobile canvas focus는 15/15다.

고정된 각 모듈·폭을 1회 전후 관측한 전수 기하 검증이므로 확률 표본 분포가 없다. 따라서 세 높이 변화에 통계적 95% 신뢰구간을 적용하지 않는다. GitHub 필수 검사도 아직 실행 전이다. source가 commit/PR 전이고, 이 검증은 합성 loopback의 화면 기하·탐색만 다루기 때문이다.

## 상호작용 판정

- 그래프 높이는 그래프 285.15625px → 표 → 그래프 285.15625px로 정확히 복원됐다. Escape 뒤에는 모바일 메뉴 트리거로 focus가 돌아왔다.
- 최신 build에서 pointer wheel 또는 gesture에 의한 헤더 숨김은 재현하지 못했다. 이를 성공으로 세지 않는다. keyboard PageDown은 canvas를 748px 이동했고 mobile header는 계속 표시됐다. 두 입력 경로는 별도 결과다.
- 처음 직접 실행한 Turbopack build는 실패했다. 이후 공식 webpack production bundle은 성공했고, 최신 UI 관측은 그 bundle을 사용했다.

## Gemini와 전달 경계

기존 Gemini canary 4회는 당시 frozen source에서 수행한 실제 provider 호출이다. 사용자 인증, 운영 DB 저장, 배포 UI 또는 현재 source의 provider 동작을 검증한 결과는 아니다. 역사적 누계는 HTTP 11회, generation 요청 8회, 결과 수신 5회(유효 canary 4회 + strict validator 거절 pilot 1회), 알려진 tokens 24,014이며 실패 3회의 usage와 cost는 미확인이다. 신규 롱폼 완료는 0/1,071이다.

`tsconfig.json`의 generated include 2개를 원래 SHA `776471d5…` bytes로 복원했다. CLI의 디렉터리 생성·영수증 갱신·이미지 저장은 검증한 디렉터리 fd를 기준으로 수행한다. 상대 helper 경로·helper 부재·실행 실패와 부모 경로 교체는 고정 오류로 거절하며 외부 replacement 대상 쓰기는 0건이었다. 프로젝트 Python 3.14.8로 CLI 경계 테스트 18개·103 assertions와 대상 ESLint가 통과했다. 열린 원본 디렉터리 inode 자체를 옮기는 동일 사용자 행위는 fd capability의 일반적 한계로 남긴다. Windows fallback은 이번 descriptor 검증 범위에 포함되지 않는다.

최종 공식 webpack build는 `HcJtq7WT9AGLOOijoRGrZ`, 종료 코드 0이다. 579개 source manifest SHA `2cc2a16f055ce9bbcb3cd1c75ac05c90cc0cbd36d29661d1967260ccf8dc3cfa`가 build 전후 일치한다. `final-source-bound-render.json`에서 같은 build의 45조합·mobile focus 15/15·버튼 및 링크 44px 위반 0·동일 chart 높이 복원·Escape 복귀를 다시 확인했다. 콘솔 오류 0, 합성 동선의 route-candidate fallback 경고 1이며 Recharts 크기 경고는 0이다. native 7.0.2 / compat 6.0.2 parity는 진단 0·논리 입력 3,149개로 통과했다. commit, PR, 보호 검사, 배포와 운영 readback은 전달 시 별도 확인한다.

`db-prepare/`의 protected-main migration 11개·137,238 bytes·112 statements carrier는 SHA·blob·statement-vector 일치와 PostgreSQL 17.6 관련 50/50 회귀를 확인한 준비물이다. 운영 적용기가 11단계를 지원하는 실제 원자적 runner와 fresh writer fence는 별도 작업 트리에서 준비 중이며, 운영 적용 증거가 아니다.

## 다음 갱신 필드

- `tsconfig.json` generated include 복원 readback
- CLI 출력 부모 교체 경쟁 수정의 source와 targeted regression 결과
- 최종 공식 webpack build ID와 성공 영수증
- commit SHA, PR, 필수 보호 검사와 conversation resolution 상태
- 배포 ID, serving source SHA와 실제 관리자 화면 readback

원본 JSON SHA-256은 `initial-desktop-render.json` `73eddd45d2f7d28aefbfd3c10277f4c3a8bcf347af6d43ca925dce2279a38bc5`, `second-build-header-render.json` `adab8aa5f3aded104c68678e08dd756a348ce66ed5322a9f62b09b83802de88c`, `third-build-header-render.json` `0fe3c495538d0dd9d0cfe695bab0ee64fe4c88c4d9d7d9f94c303647d96818ba`다.

최종 build의 캡처된 정제 CLI 출력은 `final-build-output.txt.gz`에 무손실 압축했다. 압축 해제 bytes·SHA는 `build-log-container.json`에 결박한다. 원본 bytes와 압축 전 staging map은 비공개 runtime-cache에 보존했고, 최초 diff-check의 원시 로그 trailing whitespace 실패를 숨기지 않는다.
