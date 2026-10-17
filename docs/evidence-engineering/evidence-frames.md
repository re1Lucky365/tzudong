# 증거 단계와 프레임

## 7단계 라벨

라벨은 품질 순위가 아니다. 더 큰 번호가 더 강한 증거가 아니다.

| 라벨 | 코드 | 의미 |
| --- | --- | --- |
| L1 | `SOURCE_OBSERVED` | 영상 프레임에 간판 또는 공식 자막 배너가 보인다. |
| L2 | `BOUNDARY_INTEGRATION_TESTED` | 외부 응답과 인허가 대사가 주소 일치를 확인한다. |
| L3 | `SYNTHETIC_MOCK_TESTED` | 텍스트 규칙이나 프롬프트 평가만 통과했다. 실존 증거가 아니다. |
| L4 | `HOST_TESTED` | 운영 DB와 웹 렌더에서 레이아웃이 깨지지 않게 읽힌다. |
| L5 | `PROPOSED` | 설계안이다. |
| L6 | `UNVERIFIED` | 자막 언급만 있거나 아직 확인하지 않았다. |
| L7 | `CONTRADICTED` | 폐업 또는 다른 매장임이 확인되었다. |

L1의 프레임 종류는 `storefront_sign`과 `publisher_location_caption`뿐이다. `on_site_scene`과 `menu_receipt`는 저장할 수 있는 프레임 종류이지만, 승인되고 `SOURCE_OBSERVED`여도 `isLevel1SourceObserved`가 참이 아니다. ADR-003이 네 종류 모두에 `SOURCE_OBSERVED`를 고정한 것은 이 정의와 충돌한다. 파서는 네 종류와 일곱 레벨의 조합을 지우지 않고, L1 판정만 분리한다.

수집된 프레임이 존재한다는 사실만으로 그 매장의 방문 증거가 아니다. `evidence_level`과 `moderation_status`는 다른 필드다. 수집 기본값을 `SOURCE_OBSERVED`로 강제하지 않는다. 검수 상태는 `pending | approved | rejected`다.

## 프레임 필드

```text
frame_id: 1자 이상 128자 이하 [A-Za-z0-9_-], 콘텐츠 해시와 같아도 되고 같지 않아도 된다
content_sha256: 소문자 hex 64자
video_id: 11자 유튜브 아이디. URL이면 거부
timestamp_ms: 0 이상의 안전 정수. SQL 열은 integer가 아니라 bigint
storage_object_key: {video_id}/{timestamp_ms}_{sha256의 앞 12자}.webp
youtube_seek_url: https://www.youtube.com/watch?v={video_id}&t={floor(timestamp_ms / 1000)}
frame_type: storefront_sign | publisher_location_caption | on_site_scene | menu_receipt
evidence_level: 위 7개
confidence_level: certain | probable | uncertain
moderation_status: pending | approved | rejected
detected_shop_name: null 또는 80자 이하 한 줄
detected_branch_name: null 또는 80자 이하 한 줄
image_url: null 또는 자격 증명이 없는 https URL, 최대 2048자
```

정본 위치는 `storage_object_key`다. `image_url`은 바뀔 수 있는 투영이다. 입력에 시크 URL이나 스토리지 키가 있으면 위 규칙과 글자 단위로 같아야 한다. 다르면 `seek_integrity_mismatch` 또는 `storage_key_mismatch`다. `https://youtu.be/{id}?t={sec}`는 마스터 플랜의 형태이지만 이 빌더의 출력이 아니다. 기존 `youtube_link` 정규화는 시청 URL이고 `t`를 신원 링크에서 떼어 낸다. 프레임 시크는 그 링크와 별도이며 `t`를 유지한다.

125000ms와 125500ms는 같은 초의 시크 `t=125`를 쓰지만 스토리지 키는 다르다. 초 단위 파일명으로 덮어쓰지 않는다.

상호명과 지점명은 앞뒤 공백을 제거한다. 빈 문자열은 `null`이다. 제어 문자, 줄바꿈, `@`, `숫자-숫자-숫자` 전화 형태는 `invalid_detected_name`이다. 원문 OCR 키는 `personal_data_forbidden`이다. 허용 키 밖의 필드는 `invalid_frame`이다.

대문자 SHA-256은 거부한다. 바이트를 해시하는 일은 이 계층 밖에 있다. 이 계층은 주어진 해시를 검증하고 키를 만든다.

## 승인 프레임 합집합

`unionApprovedEvidenceFrames`는 그룹들의 `frame_id` 합집합이다.

- 같은 아이디의 콘텐츠 해시, 영상, 시각, 키, 시크, 종류, 증거 레벨, 신뢰도, 상호명, 지점명이 하나라도 다르면 `duplicate_frame_conflict`다.
- 같은 아이디에 `approved`와 `rejected`가 함께 있으면 `moderation_conflict`다.
- `approved`가 하나도 없으면 결과에서 뺀다.
- 승인 사본들의 `image_url`이 서로 다르면 결과의 `image_url`은 `null`이다.
- 앞 12자가 같아 스토리지 키가 겹치면 `duplicate_frame_conflict`다.
- 정렬은 `timestamp_ms` 오름차순, 이어서 `frame_id` 사전순이다.

## 샘플링 계획

키프레임 탐색은 디코딩을 시작할 위치를 고르는 일이다. 2fps는 그 구간을 디코딩한 뒤의 시간 샘플링이다. I-frame만으로 2fps가 나온다는 보장은 없다. GOP가 60프레임인 30fps 영상은 키프레임만 고르면 약 0.5fps다. All-Intra에서는 I-frame 2fps가 가능할 수 있다. `iFrameOnlyFpsGuaranteed`는 `false`다.

계획 함수는 파일을 읽지 않는다.

```text
window_start_ms = max(0, target_timestamp_ms - 5000)
window_end_ms = target_timestamp_ms + 5000
sample_fps = 2
keyframe_role = decode_start_only
loads_full_video_in_node = false
```

Thesis의 장면 전환 임계값 0.35는 기록만 한다. 출력 fps를 보장하는 필터 설정이 아니다. 영상당 5장에서 10장도 Thesis의 목표 개수이지, 구간마다 강제하는 개수가 아니다.

기존 Step 04 `04-extract-frames-with-heatmap.js`와 Step 06 `06-frame-caption.py`의 `video_id`, `recollect_id`, `start_sec`, `end_sec`, `rank`, `file_names`, `frame_count` 계약을 깨지 않는다. `frame_count`는 파일 목록 길이와 같아야 한다.
