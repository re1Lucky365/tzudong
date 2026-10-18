# Tzudong 목표 · 2026-10-18 재개

현재 대화의 실제 목표를 등록하고 `active`를 확인했다. 이 목록은 기존 요청 전체의 완료 감사이며, 체크하지 않은 항목은 소스가 있더라도 전달 완료를 뜻하지 않는다. 기존 상세 증빙은 [요청 장부](project-request-todos-20261009.md), [기능 전달 상태](feature-completion-20261013.md), [taste 개선](admin-taste-20261015.md)에 보존한다.

## 즉시 진행

- [x] 실제 목표 등록·활성 상태 확인. 심층 메타인지, 수학적·점근적 접근, 정량 결과·불확실성 보고를 포함했다.
- [x] 격리 후보의 소스·dirty/untracked 작업 복구. 후보 HEAD `ea08db3ae0c1a8d2525da15e6026ca4556ec0260`이며 사용자 소유 `apps/web/supabase/.temp/`는 보존한다.
- [x] PR #3215 원격 상태 재확인. OPEN, 기존 head의 Swift 및 주요 CI 성공, develop과 병합 충돌 확인. 이후 head의 성공은 별도 확인한다.
- [x] taste-skill의 기존 dense-tiles 방향을 유지하며 맛집·제보·리뷰 CMS 테이블을 완성한다. 열 정렬·행 밀도·상태 의미·작업 버튼·빈 결과·로딩·키보드 상세 열기/닫기·포커스 복원을 확인한다.
- [x] 최종 1440·834·390px 브라우저에서 실제 viewport를 확인하고 overflow·행 높이·상세·검색·필터를 재검증한다. 과거 viewport 불일치 캡처를 최종 증빙으로 쓰지 않는다.
- [x] provider budget, OCR binding/4000자 경계, KG caption/receipt eligibility, runtime closure 및 SQL readiness 리뷰 수정을 검증한다.
- [x] 신규 forward migration의 102개 ledger·5단계 successor 계약과 PG17 실패·권한·idempotency/readback 검증을 마친다. 운영 적용과 구분한다.
- [ ] 관련 단위 검사·ESLint·고정 TypeScript parity·production build를 마친다. 변경이나 구체적 위험이 없으면 통과한 전체 검사를 반복하지 않는다.
- [ ] 검증된 작업만 커밋하고 develop 병합 충돌을 의미에 맞게 해결한다. 현재 확인한 충돌 파일은 platform-modernization reconciliation JSON이다.
- [ ] PR #3215 최신 head의 리뷰·Swift·필수 CI를 확인하고 보호된 `develop → data → main` 승격을 마친다.
- [ ] 현재 운영 rollback SHA와 정확한 Vercel 프로젝트를 확인하고 held/ready 계약에 따라 배포한다. 운영 SHA·도메인·hold 상태를 readback한다.
- [ ] 운영 SQL은 새 실행 증빙·현재 권한·writer fence·inflight 상태를 충족할 때 적용하고 readback한다. 과거 중지 확인을 현재 fence로 대체하지 않는다.
- [ ] 배포된 관리자 콘솔의 모든 메뉴·사이드바·목록·상세·주요 작업을 실제 관리자 세션으로 검증한다.

## 전체 요청의 완료 감사

- [ ] 전체 웹의 브랜드·로그인 로고/불꽃 대체·공통 헤더·타이포·여백·모바일·dark mode·접근성·reduced motion을 확인한다.
- [ ] 대시보드 KPI/차트 제목·도구를 가능한 폭에서 한 행으로 정렬하고 작은 화면에서는 겹침 없이 제공한다.
- [ ] 맛집 최신화·이력을 맛집 관리에 통합하고 중복 헤더·불필요한 설명을 제거한다.
- [ ] 맛집 자동 운영의 Gemini 판단·자동 분류·재검수·자동 승인·보호된 적용·readback·감사를 실제 경계까지 확인한다.
- [ ] 제보·리뷰·사용자·배너 관리를 일관된 검색/필터/목록/상세/작업 CMS 구조로 완성한다.
- [ ] 영상 성과 분석 명칭·구조, 크롤러 데이터 흐름 중심 화면, 지식 그래프 중심 화면을 확인한다.
- [ ] 오류 모니터링의 Sentry 연결과 관리자 메뉴, 감사 로그, 운영 보조 및 동선 추천을 확인한다.
- [ ] 영수증 OCR에서 승인된 Gemini 프로젝트·크레딧 경로·중복 방지·quota·저장 binding·실패 복구를 실제 요청으로 확인한다.
- [ ] 썸네일·스토리보드의 실제 지원되는 승인 모델 쌍과 Gemini-only 실행을 확인한다. 과거 비Gemini 기록은 보존하고 신규 비Gemini 실행은 막는다.
- [ ] 쯔양 롱폼 전체 분석의 대상 수·처리 수·미완료 수를 최신 입력으로 확인한다. claude-video 근거·OSK 출처·시각·미검증 상태를 유지하며 전체 완료를 표본으로 대신하지 않는다.
- [ ] 크롤링→영상/자막→추출→평가→저장→검수의 정확도·관리자 수정 보존과 전후 비용/시간/자원 성과를 감사한다.
- [ ] Gmail에서 지정한 메일에 대한 코드 조치, Gemini 리딤 잔액·결제 연결·1만원 충전 및 롯데카드 삭제의 실제 영수증을 확인한다. 불확실한 결제를 재실행하지 않는다.
- [ ] GitHub CI 중복 benchmark/report·I/O 병목을 동일 조건으로 측정하고 필요한 검증·scorer·표본을 유지하며 개선한다. 감시는 별도 읽기 전용 계약을 유지한다.
- [ ] 사용한 스킬의 가변 소프트웨어 정보는 공식 문서·설치된 인터페이스로 확인한다. 프로젝트 pin·로컬 패치는 보존한다.
- [ ] 최종 정량 보고에서 절대차·변화율·가능한 95% 구간·표본·측정 환경·회귀·불확실성을 함께 제시한다. 소스/로컬/운영 증거를 구분한다.

## 실행 원칙

서로 독립적인 CMS 포커스, SQL successor, provider/KG/runtime 감사를 병렬 처리한다. 공유 CSS·통합 검증·커밋·승격·외부 쓰기는 직렬 처리한다. Astra는 필요한 복잡한 판단에만 사용하며 모델·유료 한도·전역 설정을 임의로 바꾸지 않는다. 개인정보·자격증명·raw OCR·원시 관리자 payload는 증빙에 저장하지 않는다.

## 2026-10-18 로컬 증빙

[CMS 측정](../../apps/web/performance/admin-tables-20261018/README.md), [실제 PG17.6 재생](../../apps/web/performance/feature-sql-integration-20261013/pg17-existing-catalog-replay-review-verification-readiness-20261018.json), [외부 감사 준비](../../apps/web/performance/cross-audit-20261018/master-plan.md)를 보존했다. 외부 감사는 공통 대기열이며 업로드·전송은 0회다. 최신 develop 통합·새 head CI·운영 배포·전체 메뉴 실제 검증은 남아 있다.

## 웹 심층 리서치 왕복 검증

- [ ] GPT-6 Pro + 심층 리서치의 실제 시작·완료, 전문·원래 URL·SHA를 보존한다.
- [ ] Gemini 4 Argon 최고가 + Deep Research로 앞선 보고서와 소스에 반대 감사를 수행한다.
- [ ] 모든 지적에 안정적인 ID를 부여하고 ACCEPT/CONDITIONAL/REJECT/DEFER를 근거와 함께 판정한다.
- [ ] 수용 지적을 실제 수정·경계/회귀 검사와 연결한다.
- [ ] 최종 수정 소스로 GPT-6 Pro + 심층 리서치 역검증을 수행하고 새 결함도 조치한다.
- [ ] completion-manifest.json의 세 보고서·조치·필수 검증이 충족될 때만 교차 감사 complete로 판정한다. 운영 배포와 전체 목표 완료는 별도다.

공통 coordinator의 기존 job·FIFO·서비스당 한 건·소유자 해제 계약을 보존한다. 현재 manifest는 incomplete_queued이며 빈 파일이나 로컬 리뷰를 웹 연구 완료로 대체하지 않는다.

## SQL 승격 경계

review-media feature successor와 PG17.6 receipt는 정확한 97→102 다섯 migration 증빙이다. `20261017`의 evidence/popularity migration 세 개는 별도 102→105 승격이며, 기존 102 receipt를 105 증빙으로 표시하거나 재사용하지 않는다.
