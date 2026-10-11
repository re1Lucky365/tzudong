-- Synthetic rows only, exact-version owned schema clone, rolled back in full.
BEGIN;
SET LOCAL statement_timeout='5s';
INSERT INTO storage.buckets(id,name,public) VALUES ('review-photos','review-photos',true) ON CONFLICT DO NOTHING;
INSERT INTO auth.users(id,email,raw_user_meta_data,raw_app_meta_data)
VALUES ('11111111-1111-4111-8111-111111111111','media-probe@local.invalid','{}','{}');
INSERT INTO public.profiles(user_id,nickname,email)
VALUES ('11111111-1111-4111-8111-111111111111','Local media probe','media-probe@local.invalid') ON CONFLICT DO NOTHING;
INSERT INTO public.restaurants(id,approved_name,status)
VALUES ('44444444-4444-4444-8444-444444444444','LOCAL TEST ONLY','approved');
INSERT INTO storage.objects(bucket_id,name) VALUES
('review-photos','11111111-1111-4111-8111-111111111111/reviews/22222222-2222-4222-8222-222222222222/verification/old.webp'),
('review-verifications','11111111-1111-4111-8111-111111111111/reviews/22222222-2222-4222-8222-222222222222/verification/old.webp');
INSERT INTO public.reviews(id,user_id,restaurant_id,title,content,visited_at,verification_photo)
VALUES ('22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111',
'44444444-4444-4444-8444-444444444444','LOCAL TEST ONLY','Synthetic content for local verification only.',now(),
'11111111-1111-4111-8111-111111111111/reviews/22222222-2222-4222-8222-222222222222/verification/old.webp');
UPDATE public.reviews SET verification_photo=
'11111111-1111-4111-8111-111111111111/reviews/22222222-2222-4222-8222-222222222222/verification/new.webp'
WHERE id='22222222-2222-4222-8222-222222222222';
SET LOCAL ROLE anon;
DO $$ BEGIN
 BEGIN
  PERFORM public.admin_review_verification_cleanup('22222222-2222-4222-8222-222222222222','prepare');
  RAISE EXCEPTION 'PROBE_ANON_ADMITTED';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN
  PERFORM public.admin_review_verification_cleanup('22222222-2222-4222-8222-222222222222','prepare');
  RAISE EXCEPTION 'PROBE_OWNER_ADMITTED';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SET LOCAL ROLE service_role;
DO $$ DECLARE result jsonb; paths text[]:=ARRAY[
'11111111-1111-4111-8111-111111111111/reviews/22222222-2222-4222-8222-222222222222/verification/old.webp']; BEGIN
 result:=public.admin_review_verification_cleanup('22222222-2222-4222-8222-222222222222','prepare');
 IF result->>'status'<>'READY' OR jsonb_array_length(result->'items')<>1
  OR result->'items'->0->>'path'<>paths[1] THEN RAISE EXCEPTION 'PROBE_QUEUE_PREIMAGE_DENIED'; END IF;
 result:=public.admin_review_verification_cleanup('22222222-2222-4222-8222-222222222222','finish',paths);
 IF result->>'remaining'<>'1' THEN RAISE EXCEPTION 'PROBE_PRESENT_BOTH_COMPLETED'; END IF;
 BEGIN
  PERFORM public.admin_review_verification_cleanup('22222222-2222-4222-8222-222222222222',NULL);
  RAISE EXCEPTION 'PROBE_NULL_PHASE_ADMITTED';
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM<>'REVIEW_ADMIN_CLEANUP_INVALID' THEN RAISE; END IF;
 END;
END $$;
RESET ROLE;
-- Fixture metadata only: emulate the exact Storage service transaction flag.
-- This is not an HTTP Storage deletion or a public-cache denial receipt.
SET LOCAL storage.allow_delete_query='true';
DELETE FROM storage.objects WHERE bucket_id='review-photos';
SET LOCAL ROLE service_role;
DO $$ BEGIN
 IF public.admin_review_verification_cleanup('22222222-2222-4222-8222-222222222222','finish',ARRAY[
 '11111111-1111-4111-8111-111111111111/reviews/22222222-2222-4222-8222-222222222222/verification/old.webp'])->>'remaining'<>'1'
 THEN RAISE EXCEPTION 'PROBE_PRIVATE_SURVIVOR_COMPLETED'; END IF;
END $$;
RESET ROLE;
DELETE FROM storage.objects WHERE bucket_id='review-verifications';
SET LOCAL ROLE service_role;
DO $$ DECLARE result jsonb; paths text[]:=ARRAY[
'11111111-1111-4111-8111-111111111111/reviews/22222222-2222-4222-8222-222222222222/verification/old.webp']; BEGIN
 result:=public.admin_review_verification_cleanup('22222222-2222-4222-8222-222222222222','finish',paths);
 IF result->>'remaining'<>'0' OR public.admin_review_verification_cleanup(
 '22222222-2222-4222-8222-222222222222','finish',paths)<>result THEN RAISE EXCEPTION 'PROBE_FINISH_IDEMPOTENCY'; END IF;
END $$;
RESET ROLE;
DO $$ BEGIN
 BEGIN
  UPDATE public.reviews SET verification_photo=
  '11111111-1111-4111-8111-111111111111/reviews/22222222-2222-4222-8222-222222222222/verification/old.webp'
  WHERE id='22222222-2222-4222-8222-222222222222';
  RAISE EXCEPTION 'PROBE_REATTACH_ADMITTED';
 EXCEPTION WHEN check_violation THEN
  IF SQLERRM<>'REVIEW_MEDIA_RETIRED' THEN RAISE; END IF;
 END;
END $$;
-- A live reference stays protected, even with a stale unretired queue record.
INSERT INTO review_media_private.cleanup(path,owner_id,review_id,purpose) VALUES (
'11111111-1111-4111-8111-111111111111/reviews/22222222-2222-4222-8222-222222222222/verification/new.webp',
'11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','verification');
SET LOCAL ROLE service_role;
DO $$ DECLARE result jsonb; BEGIN
 result:=public.admin_review_verification_cleanup('22222222-2222-4222-8222-222222222222','prepare');
 IF jsonb_array_length(result->'items')<>0 THEN RAISE EXCEPTION 'PROBE_LIVE_REFERENCE_EXPOSED'; END IF;
 IF public.admin_review_verification_cleanup('22222222-2222-4222-8222-222222222222','finish',ARRAY[]::text[])->>'remaining'<>'1'
 THEN RAISE EXCEPTION 'PROBE_LIVE_REFERENCE_COMPLETED'; END IF;
END $$;
RESET ROLE;
-- Separate review queue: 21 absent metadata keys need TWO public-checked batches.
INSERT INTO review_media_private.cleanup(path,owner_id,review_id,purpose,retired)
SELECT '11111111-1111-4111-8111-111111111111/reviews/55555555-5555-4555-8555-555555555555/verification/p'||lpad(n::text,2,'0')||'.webp',
'11111111-1111-4111-8111-111111111111','55555555-5555-4555-8555-555555555555','verification',true FROM generate_series(1,21) n;
SET LOCAL ROLE service_role;
DO $$ DECLARE result jsonb; paths text[]; BEGIN
 result:=public.admin_review_verification_cleanup('55555555-5555-4555-8555-555555555555','prepare');
 IF jsonb_array_length(result->'items')<>20 THEN RAISE EXCEPTION 'PROBE_CAPACITY_DRIFT'; END IF;
 SELECT array_agg(x->>'path') INTO paths FROM jsonb_array_elements(result->'items') x;
 IF public.admin_review_verification_cleanup('55555555-5555-4555-8555-555555555555','finish',paths)->>'remaining'<>'1'
 THEN RAISE EXCEPTION 'PROBE_UNCHECKED_21ST_COMPLETED'; END IF;
 result:=public.admin_review_verification_cleanup('55555555-5555-4555-8555-555555555555','prepare');
 IF jsonb_array_length(result->'items')<>1 THEN RAISE EXCEPTION 'PROBE_SECOND_BATCH_DRIFT'; END IF;
 paths:=ARRAY[result->'items'->0->>'path'];
 IF public.admin_review_verification_cleanup('55555555-5555-4555-8555-555555555555','finish',paths)->>'remaining'<>'0'
 THEN RAISE EXCEPTION 'PROBE_SECOND_BATCH_UNFINISHED'; END IF;
 BEGIN
  PERFORM public.admin_review_verification_cleanup('55555555-5555-4555-8555-555555555555','finish',ARRAY[NULL]::text[]);
  RAISE EXCEPTION 'PROBE_NULL_KEY_ADMITTED';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'REVIEW_ADMIN_CLEANUP_INVALID' THEN RAISE; END IF; END;
END $$;
SELECT jsonb_build_object('cleanupPermissionAndFailureCases',10,'synthetic',true,'operatingWrites',0);
RESET ROLE;
ROLLBACK;
