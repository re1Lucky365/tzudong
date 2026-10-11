# 최종 검증 경로

최종 독립 검증 명령은 `python3 backend/bin/verify_readiness_ocr_20261011_v3.py`다. JSON 결과와 validator SHA는 `readiness-ocr-validation-v3.json`에 있다. 50개 파일, 현재21개 source binding, 과거592의101개 Git-source binding이 통과했다.

동결 OCR 패킷의 초기 재현 문서는 v1 verifier를 가리킨다. v1은 존재하지 않는 MY 경로, v2는 build가 실제로 해시한 layout content 대신 entry page를 지정하여 실패했다. 두 버전과 동결 map/source manifest는 보존했다. v3는 build script에 명시된 `apps/web/app/mypage/mypage-layout-content.tsx`를 검사한다. 문서·최종 자동 실행에서 v3를 사용하며 v1/v2 성공을 주장하지 않는다.

운영 SQL·배포·실제 Storage HTTP·OCR provider·SDK·휴대폰·field 검증은 이 결과로 통과 처리하지 않는다. 이전 operating Apply 시도1/commit확인0도 유지한다.
