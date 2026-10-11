# 쯔양 리뷰 전수 검사 후 최소 수정 계획

Gemini3.8 Flash HIGH로 1659행을 전수 분류한 frozen census와 137개 원문 근거 작업의 결과를 재사용했다. 승인751행은 ok590/fix92/needs_source69이며, 승인된 비어 있지 않은 쯔양 리뷰는729개다. 전체1659행은 ok1046/fix205/needs_source408이다. 이 분류는 사실 정확성의 독립 인증이나 모든 문제의 수정 완료를 뜻하지 않는다.

추가161건 중 구조·exact quote를 통과한156건은 propose78/visual36/insufficient35/keep7이다. quote mismatch5건은 부적격으로 보존했다. 78개 제안에서 관리자 편집47개를 보존하고, 문맥 부족8개를 보류했으며 **최소 초안23개(문체15·좁은 원문 수정8)**를 준비했다. 23/23 pre-image unchanged는 09:14:28 UTC의 point-in-time preflight다. 운영 Apply 직전의 새로운 동등성 검사를 대체하지 않는다.

| 단계 | 결과 | 근거 |
|---|---|---|
| 전수 모델 분류 | 1659행 / actual Gemini3.8 Flash HIGH | ../tzuyang-review-census-20261009/REPORT-complete-v7.md |
| 원문 응답 검증 | 137 jobs, 134 responses/156 records admitted, 3 responses/5 records rejected | ../tzuyang-review-source-20261011/REPORT-v2.md |
| 최소 수정 분리 | 15editorial + 8source drafts; admin47·context8 보존 | minimal-review-plan-v1.json |
| fresh 검사 | 23/23unchanged, hosted content writes0 at that snapshot | fresh-minimal-preflight-v1.json |
| 실제 운영 시도 | Preview1 / Applyattempt1 / resend0; 확인된 내용 commit0 | ../readiness-media-followup-20261011/operating-edit-observation-v2.json |

첫 평양옥 문체 수정 시도는 DB revision trigger의 WHERE 누락으로 실패했다. 원래 작업은 expired preview/audit0이다. 안전장치를 유지하는 forward correction과 server-confirmed expiry recovery를 별도 구현·검증했다. 운영에 새 source/schema를 전달하고 **원래 UUID로 GET만** 재확인한 다음, 새 pre-image·Preview·Confirm·Apply·Readback·Audit로 각 초안을 처리해야 한다. 나머지22개를 자동 반복 전송하지 않았다.

Korean metadata인데 원문이 Latin-only인7개 작업은 원문 언어 인증을 보류했다. 모델이 uncertainty=false라고 반환해도 인증하지 않는다. 원문·actor·credential·비공개 provider reply는 이 패킷에 저장하지 않았다. private plan은 runtime-cache에 보존하고 SHA256으로만 연결한다.

로컬 변환기는 한 번의 export와 ID 인덱스를 사용해 O(행 수 + 텍스트·인용 길이)로 처리한다. 테스트5개가 통과한 이 준비 단계에서 토큰·시간·요금 절감을 측정한 것은 아니다. 새 모델 전수 요청이나 native Astra 호출을 추가하지 않았다. 현재 내용 초안23개는 미배포·미적용이며, 운영 반영 완료를 주장하지 않는다.

재현: pinned Python3.12로 test_prepare_minimal_v1.py를 실행한다. 준비 script는 기록된 input/spec/source/plan SHA에 묶인다. 실제 private source 없이 공개 패킷만으로 의미·영상 인증을 재수행할 수는 없다. 별도 detached map SHA와 independent byte/result verifier로 공개 결과와 범위를 확인할 수 있다.
