# taste-skill 관리자 콘솔 개선

공식 `Leonxlnx/taste-skill` commit `f624f37a8c650b9cc550253104925efe4c8de246`을 설치하고, `dense-tiles / The well-kept board` 방향과 seed `331628995`를 선택했다. 사용자 요청에 따라 이후 디자인 판단에 `frontend-design`과 `redesign-skill`을 사용하지 않았다. 설치·원본 스킬 파일 해시는 증빙 디렉터리의 `skill-installation.json`에 있다.

운영자가 목록을 찾고, 근거를 확인하고, 작업 결과를 구분하는 CMS로 정리했다. 상단 제목·건수·주요 작업, 목록/상세 구획, 검색·필터, 선택·위험·보류 상태를 공통 스타일로 맞췄다. 사이드바 15개 목적지를 포함하며 파이프라인과 지식 그래프는 시각화가 주 화면이다. Pretendard와 브랜드 빨강은 유지했다. 불필요한 그라디언트·그림자·장식선과 이모지를 정리하고 의미 있는 표·폼 경계, 데이터 색상, 포커스, 보류 상태는 보존했다. 모듈 진입 효과는 160ms/4px이며 reduced motion 설정을 존중한다.

스킬 원문은 마케팅 페이지용이다. 사용자가 지정한 CMS 범위에 맞춰 이미지·히어로·애니메이션 개수를 검사 통과용으로 추가하지 않았다. 공식 source lint는 여전히 exit 1, 73 findings(57 FAIL/16 WARN)이다. 독립 검토에서 CMS에 필요한 65개 패턴과 정규식 오탐 8개로 분류했으며, 실제 지적 2개는 수정했다. 이는 스킬 검사 전체 통과나 정량적 사용성 점수가 아니다.

## 측정

| 항목 | 변경 전 → 후 | 절대 차이 | 변화율 | 표본·환경 | 95% CI |
| --- | --- | --- | --- | --- | --- |
| 공통 페이지 제목 | 16 → 18px | +2px | +12.5% | 15개 메뉴 × 1440/834/390px | 해당 없음: 결정적 기하 검사 |
| 밝은 녹색 트리맵 글자 대비 | 2.11897 → 7.71792:1 | +5.59895 | +264.23% | 배경 `#30cc5a`, 흰색 → `#17202f` | 해당 없음: 상대 휘도 계산 |
| 다크 검사기의 저대비 표본 | 12 → 0 | −12 | −100% | 같은 6개 메뉴 × 2개 폭 | 해당 없음: 검사기 표본 전수 |

변화율은 `(후−전)/전 × 100`이다. 대비는 sRGB 선형화 후 상대 휘도의 `(Lmax+0.05)/(Lmin+0.05)`로 계산했다. 저대비 표본은 전체 텍스트나 독립 고유 요소의 개수가 아니다. 초기 before 캡처에는 로딩 화면이 있어 제목·기하만 비교하며, 행 밀도·작업 시간·사용성·성능·금액 절감의 전후 주장을 하지 않는다.

## 최종 로컬 검증

- Canonical unit: **3,815 pass / 0 fail / 11 skip**, 466파일(일반 445 + 격리 21), 22/22 프로세스. Node24.21.0/Bun1.4.0, 실행 중 test/product/runner drift 0. 이전 실패 두 실행과 런타임·inventory 정정은 별도 영수증에 보존했다. 영향 검사와 겹치므로 수를 합산하지 않는다.
- 변경한 TS/TSX/JS/MJS의 ESLint 52파일과 후속 테스트 1파일 통과. TypeScript native7.0.2/compat6.0.2 비교는 당시 3,324 입력·진단 0이다.
- Next16.3.8 production build, route CSS boundary 통과. 앱 manifest 1,593파일의 실행 전후 drift 0, 생성 설정 복구 오류 0. 이후 변경은 빌드 대상에서 제외된 unit 테스트 1개와 performance 전용 검사 스크립트뿐이며 제품 소스는 같다. 이 manifest를 저장소 전체 전이 입력의 완전성으로 확대하지 않는다.
- 같은 로컬 production 번들에서 밝은 화면 45개, 실제 dark class를 확인한 화면 12개, 합성 성공 화면 9개를 확인했다. 저장한 각 화면의 주요 헤더·main은 1개, 문서 가로 넘침·브라우저 pageerror·검사기 저대비 표본은 0이다.
- 첫 밝은 실행은 32개 뒤 모바일에서 중단됐다. production CSP가 로컬 mock Supabase 주소를 차단한 것을 확인했다. 남은 13개는 합성 세션, 두 읽기 RPC의 브라우저 내 응답, 해당 브라우저 문서 응답의 고정 mock 주소 1개 허용으로 검사했다. 제품 CSP·운영 설정은 수정하지 않았다. 원래 timeout과 root error 화면을 보존했다.
- 합친 밝은 화면에는 console error 53개·request failure 232개가 있다. 차단·취소·오류 상태가 포함되므로 깨끗한 네트워크 실행, 실제 인증·CSP·업무 성공으로 해석하지 않는다. pageerror 0은 React 오류 경계가 없다는 뜻도 아니다. 최종 채택 화면에 한정한 지표다.
- 사이드바 15개 이동, 접힌 메뉴/focus, 모바일 메뉴, 파이프라인 키보드/상세, 그래프 필터/근거, 사용자·제보·리뷰 필터/상세와 스토리보드 held 상태는 별도 합성 상호작용에서 확인했다. 첫 22/25와 후속 4/4(인증 전제 포함)는 다른 실행이다. 과거 console/network 오류와 잘못된 screenshot 경로는 reconciliation sidecar에 공개했다.

## OCR 후속과 남은 운영 경계

관리자 OCR은 server-only 공통 처리기를 HTTP 경계와 신뢰된 Actions worker에서 재사용한다. 기존 모델·thinking 정책을 그대로 전달하고 최대 50건 직렬 배치, 데이터 소유권/저장 readback, snapshot CAS를 검증한다. 동시 초기화는 한 요청만 성공하며 후속 행 충돌은 부분 초기화를 명시하고 dispatch하지 않는다. 대기 중인 결과의 재시도는 같은 generation을 유지한다. 요청 접수와 실행 완료를 구분하도록 안내를 수정했다.

GitHub 204는 접수 증거이며 응답의 `workflowDeliveryVerified`는 false다. 전역 concurrency는 실행 1개와 대기 1개를 유지하므로 새 요청이 기존 대기 run을 대체할 수 있다. 행은 pending으로 남아 명시적 재시도로 복구한다. durable outbox·자동 연속 배치·완료 후의 늦은 재시도와 새 작업 구분은 구현하지 않았으며 exactly-once 전달을 주장하지 않는다.

이 디자인 작업에서 hosted DB·Storage·공급자 쓰기와 실제 생성/승인/삭제는 수행하지 않았다. 보호 브랜치 승격, held/ready 배포, 새 운영 적용 관측·fence, 운영 SQL과 실제 OCR/자동 승인/스토리보드/Storage readback은 장기 목표의 미완료 항목이다. 롱폼 전체 분석과 독립 검증도 이 화면 검사로 완료되지 않는다.

증빙: [최종 검증 요약](../../apps/web/performance/admin-taste-20261015/verification-summary-final.json), [최종 화면 요약](../../apps/web/performance/admin-taste-20261015/view-summary-final.json), [전체 테스트](../../apps/web/performance/admin-taste-20261015/canonical-unit-final2.json), [production build](../../apps/web/performance/admin-taste-20261015/build-report-final.json), [스킬 검사 분류](../../apps/web/performance/admin-taste-20261015/taste-source-lint-classification.json).
