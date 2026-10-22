# Gemini live validation — 2026-10-12

이 디렉터리는 합성 입력으로 순차 실행한 OCR, 일반 storyboard, Pro image canary의 정규 인덱스다. 단계별 영수증과 이미지는 원래 경로에 그대로 있으며, 기계 판독용 상세값과 파일 무결성은 [`artifact-map.json`](./artifact-map.json)에 기록했다.

`existingFundedProjectVerified=true`

## Provider 계측

| 단계 | 모델 | provider 요청 | 계측 시간 (ms) | prompt tokens | output tokens | thought tokens | total tokens |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| OCR metadata | metadata endpoint | 1 | 별도 계측 없음 | 해당 없음 | 해당 없음 | 해당 없음 | 해당 없음 |
| OCR generation | `gemini-3.6-flash` | 1 | 4,187.453750 | 1,495 | 127 | 385 | 2,007 |
| Storyboard draft | `gemini-3.8-flash` | 1 | 28,306.275000 | 266 | 1,389 | 2,050 | 3,705 |
| Storyboard image | `gemini-3.1-flash-image` | 1 | 11,799.955333 | 32 | 1,505 | 0 | 1,537 |
| Pro image | `gemini-3-pro-image` | 1 | 19,022.027208 | 32 | 1,215 | 213 | 1,460 |
| **합계** |  | **5** | **63,315.711291** | **1,825** | **4,236** | **2,648** | **8,709** |

합계 시간은 네 generation 호출에서 SDK가 기록한 elapsed time의 합이다. OCR metadata 요청은 요청 수에는 포함되지만 별도 시간이 없으므로 시간 합계에는 포함되지 않는다. SDK `attempts: 1`이 세 단계 모두에 적용되었고, 시작된 generation 호출은 OCR 1회, 일반 storyboard 2회, Pro image 1회다.

총 토큰 8,709는 단계별 영수증의 `totalTokenCount`를 독립 재합산한 값이다: `2,007 + 3,705 + 1,537 + 1,460 = 8,709`. metadata 요청에는 generation token usage가 없다.

## 결과와 무결성

- 세 단계 모두 `passed=true`, `pending=null`, `syntheticInput=true`, `operationalDatabaseWrites=0`이다.
- 일반 storyboard 이미지는 JPEG 1,376×768, 812,434 bytes이며 SHA-256은 `126c591f8772d5c06f4f104ecf9975d9e11e5cf6ce5a0686e8290f167d6db033`이다.
- Pro 이미지는 JPEG 1,376×768, 728,835 bytes이며 SHA-256은 `4c90ba26de03adbe9196216082b5299e9fa60e5b83377394235f8e9afad398cc`이다.
- 두 이미지의 파일 해시·크기·형식·픽셀 크기를 영수증과 독립 대조했다. 육안 재검토에서 사람, 얼굴, 문자, 로고, 식별 가능한 개인정보가 보이지 않았다.
- 단계별 영수증과 이미지는 mode `0600`이며 기존 경로에서 변경하지 않았다.

## Source binding

세 단계가 기록한 Git binding은 `HEAD bd80988fb925e7c47d4fe202da8d929d119a6cca`, tree `998d3a5568190d2fc0ba3e3634c302313f3c5b9c`다. 실행 당시 working tree는 dirty 상태였으므로 커밋만으로 실제 source를 대표하지 않는다. 각 영수증의 source SHA-256은 당시 실행의 기록으로 보존한다. 현재 checkpoint `bb6f9228209c9a4a8251ca2e182428f7021d6a3e`에서 역사적 provider-bound 경로만 다시 비교한 `source-reconciliation-20261013-v2.json`에는 단계별 불일치 7개(고유 경로 3개)와 현재 OCR 검증 체인 3개 파일의 SHA-256을 분리해 기록했다. 이는 전체 application source 검증이나 현재 코드의 실제 유료 호출 증거가 아니다. 원본 map, provider receipt와 앞선 정정 파일은 그대로 보존했고, v2 정정의 새 공급자 호출은 0회다.

| 단계 | configuration SHA-256 |
| --- | --- |
| OCR | `6748727560a176b3482ebca41aa51a6fe68b88cd86f19a81ce8cde870a17b121` |
| Storyboard | `d792ed798244eff4426d2a395eb835e59952ec17509e12499b4d9c5c38d95cb4` |
| Pro image | `163dcd015543e8daa2fdda1339cafe93f97b44e97dea9eabb5a40fd7d952a956` |

정확한 source별 SHA-256과 단계별 artifact 경로·SHA-256·크기는 `artifact-map.json`에 있다.

## 검증 범위

각 단계는 합성 입력 한 건인 `n=1` canary다. 이 증빙은 해당 입력에서 provider 응답, 구조 검사, 이미지 decode 및 로컬 무결성 검사가 성공했음을 보인다. 일반 정확도, 반복 실행의 안정성, 성능 분포, 비용 차감 또는 절감은 증명하지 않는다. 전체 사용자 흐름과 인증 흐름, DB·Storage·worker 동작, 배포 상태도 이 실행 범위 밖이다.
