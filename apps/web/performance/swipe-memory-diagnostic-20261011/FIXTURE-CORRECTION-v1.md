# 메모리 실험 응답 조건의 결함과 재측정

고정 v6 fixture는 origin_name·naver_name·google_name·road_address·jibun_address 등의 equality 조건을 무시했다. 합성 데이터에서 없는 별칭이나 다른 주소를 조회할 때 빈 결과가 아니라 735개를 반환했다. 한 후보 진단에서 해당 투영 640회/470,400행/111,886,720응답 바이트가 관측되었다. 이 수치는 잘못된 합성 응답의 비용이며 운영 서비스의 전송량·병목을 입증하지 않는다.

v6 A/A 4개 프로세스와 A/B 9쌍/18개 프로세스의 원자료·보고서·실패는 덮어쓰지 않았다. 기존 수치는 해당 응답 조건에서의 관측으로 보존하되 선언한 사용자 흐름의 비교 가능한 성능 근거로 승인하지 않는다. 기존 후보 admission 0과 20% 자연 종료/idle heap 및 15% 지연 회귀 guard를 유지한다.

v7은 알려진 이름·주소·NULL predicate를 반영하고 모르는 열·문법·중복 제어를 거부한다. 별칭이 없으면 0행이며 원래 이름·주소의 실제 일치만 반환한다. 열은 고정 DB Row 계약을 따른다. 테스트는 같은 이름/다른 주소·빈 결과·NULL·모르는 열과 projection·검색·범위·카테고리·정렬을 포함한다. 새 production 기능 smoke에서 발견한 publishedAt JSON 정렬도 실제 호출에 맞춰 명시적으로 지원하고, 기존 실패를 보존했다.

개념적으로 무시된 miss 조회 Q회는 잘못된 전체 N행 응답으로 O(QN)의 응답·객체 생성을 만들었다. 올바른 fixture에서도 로컬 필터 구현은 O(QN) 순회지만 실제 응답 크기는 O(Σ일치행)이다. 이는 실험용 adapter에 관한 분석이며 DB 인덱스·네트워크·UI 개선율의 실측이 아니다.

기준선 da4c9be의 기존 production build 1,762개 파일을 정확한 source worktree로 byte-identical 복사했다. Next 16.3.6 dependency tree는 읽기 전용 공유 링크로 재사용하고 원본과 다른 작업은 수정하지 않는다. 후보 21a86dca의 기존 production build와 Node 24.21.0을 유지한다. 새 계획은 A/A 4프로세스 및 A/B 9쌍/18프로세스, 프로세스당 128검색×2회, CPU4,390×844,캐시 off,실제 NaverSDK/합성 REST735/Auth401이다. SDK·buildID·lock·helper·fixture 해시가 다르면 실패한다.

새 primary 측정에는 forced GC·profiler·heap snapshot을 쓰지 않는다. 진단 snapshot은 idle 뒤 별도로 획득했으며 GC를 유발할 수 있고 raw snapshot은 RAM에서만 처리했다. 진단은 회귀 통과·픽셀·실기기·field 증거가 아니다. 계획 외 warm60/cold2000·실기기·운영·field는 별도 미완료다.
