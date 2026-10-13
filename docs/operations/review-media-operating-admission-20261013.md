# Review-media 운영 입력 준비

`apps/web/scripts/review-media-operating-admission.mjs`는 별도 수집기가 제공한 근거 파일을 검증하고 기존 적용기의 private admission 형식으로 변환한다. GitHub·Vercel·DB를 조회하거나 SQL을 실행하지 않는다. 형식·해시 검증 성공은 입력에 적힌 외부 상태를 직접 확인했다는 뜻이 아니다.

이 도구는 호출자가 제공한 JSON의 관측 출처를 인증하지 않는다. 실제 관측을 수집하는 adapter의 출처 검증 없이 결과를 운영 승인으로 사용하지 않는다. 합성 단위 검사의 receipt·journal은 형식 검증용이며 운영 증빙으로 사용하지 않는다.

## 입력과 실행 순서

1. 보호된 `main`의 깨끗한 detached checkout, 현재 production rollback 대상, manifest의 writer fence 7개를 실제로 확인한다. 실행 창과 원래 `observedAt`을 포함한 canonical JSON 입력을 저장소 밖 private 디렉터리에 저장한다. 프로바이더 원문·인증 정보는 입력에 넣지 않는다.
2. `--mode rehearsal --input <absolute-input-path> --custody-dir <new-private-directory>`로 리허설 admission을 만든다. 입력은 schema, source revision/root, manifest hash, checkout readback, source/protected-main/rollback receipt와 writer-fence receipt 전체를 포함해야 한다.
3. 준비된 admission을 기존 `review-media-sql-rehearsal.mjs`에 전달한다. 기존 적용기는 source와 rollback을 다시 읽고 DB 대상·중지 조건을 확인한 뒤 rollback-only 리허설을 수행한다. 이 생성기만 실행해서는 리허설 receipt가 생기지 않는다.
4. 성공한 리허설의 admission·receipt·3행 journal SHA와 원래 만료 시각을 결속한 apply 입력을 준비한다. `--mode apply --input <absolute-input-path> --custody-dir <same-private-directory>`로 apply admission을 만든다. 적용 admission의 `rehearsalAdmissionSha256`는 저장된 `rehearsal-admission.json`의 실제 바이트이며 receipt·journal의 원래 실행과 source·rollback·writer fence가 같아야 한다.
5. 기존 적용기의 launch policy, 보호 source, 실제 rollback과 writer-fence 근거가 충족된 경우에만 `review-media-sql-successor.mjs`를 실행한다. 출력 존재·실패·응답 유실은 기존 산출물을 확인한 뒤 처리하며, 파일을 지워 같은 작업을 자동 재시도하지 않는다.

두 mode 모두 Node 24로 `apps/web/scripts/review-media-operating-admission.mjs`를 실행한다. 성공 출력은 준비한 경로·SHA·만료 시각이며, 운영 적용 완료 영수증이 아니다.

## 보존 조건

- 전체 창은 최대 15분이다. apply 준비는 rehearsal의 `createdAt`·`expiresAt`을 그대로 유지하며 창을 연장하지 않는다. 만료됐으면 실제 상태를 새로 확인하고 새로운 시도 전체를 준비해야 한다.
- 적용 admission의 stage states는 검증된 rehearsal receipt에서만 가져온다. 임의 기대값이나 로컬 fixture 값을 운영 결과로 승격하지 않는다.
- 파일은 배타적으로 생성한다. 기존 custody, admission, journal을 덮거나 삭제하지 않는다. private 경로와 파일·디렉터리 저장 검증 실패 시 준비 성공을 반환하지 않는다.
- 입력을 수집하는 운영 adapter와 live 인증은 별도다. 저장소에 Vercel 토큰이 없다는 사실만으로 새 토큰 생성·저장 권한을 추정하지 않는다. 현재 manifest의 `held` 상태를 이 도구가 변경하지 않는다.

현재 통과한 PG17.6 proof는 controller와 SQL의 격리 재생이다. 이 생성기의 검증은 별도 단위 검사로 기록하며 hosted DB 적용·Storage 물리 삭제·운영 성능 증거로 합산하지 않는다.

최신 단위 검사 기록은 `apps/web/performance/review-media-operating-admission-20261013/current-evidence.json`이 선택한다. 이전 `verification.json`과 `controller-reverification.json`은 해당 시점의 기록이며 현재 소스 증명으로 사용하지 않는다. 새 기록은 검사 로그와 source 바이트를 결속한다.

적용 전 state read는 lock 2초, statement 15초, transaction 최대 30초와 남은 admission 시간, client 최대 30초로 제한한다. 실패·만료는 apply journal 및 mutation 전에 거부한다. 다른 psql 작업도 유한 client 제한을 사용하지만 이 로컬 검사만으로 운영 timeout 동작을 입증하지 않는다.
