-- Historical legacy rows are seeded with only the reference guard suspended,
-- then that guard is restored before every action/permission observation.
-- No deployed data, real accounts or HTTP Storage objects are used.
BEGIN;
SET LOCAL statement_timeout='5s';
INSERT INTO storage.buckets(id,name,public) VALUES ('review-photos','review-photos',true) ON CONFLICT DO NOTHING;
INSERT INTO auth.users(id,email,raw_user_meta_data,raw_app_meta_data)
VALUES ('11111111-1111-4111-8111-111111111111','shared-probe@local.invalid','{}','{}');
INSERT INTO public.profiles(user_id,nickname,email)
VALUES ('11111111-1111-4111-8111-111111111111','Synthetic shared probe','shared-probe@local.invalid') ON CONFLICT DO NOTHING;
INSERT INTO public.restaurants(id,approved_name,status) VALUES
('44444444-4444-4444-8444-444444444444','SYNTHETIC FIRST','approved'),
('55555555-5555-4555-8555-555555555555','SYNTHETIC SECOND','approved');
INSERT INTO storage.objects(bucket_id,name) VALUES
('review-photos','11111111-1111-4111-8111-111111111111/1700000000000_verification_shared.webp'),
('review-verifications','11111111-1111-4111-8111-111111111111/1700000000000_verification_shared.webp');
ALTER TABLE public.reviews DISABLE TRIGGER review_media_reference_guard;
INSERT INTO public.reviews(id,user_id,restaurant_id,title,content,visited_at,verification_photo) VALUES
('22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111',
'44444444-4444-4444-8444-444444444444','SYNTHETIC FIRST','Historical synthetic first.',now(),
'11111111-1111-4111-8111-111111111111/1700000000000_verification_shared.webp'),
('33333333-3333-4333-8333-333333333333','11111111-1111-4111-8111-111111111111',
'55555555-5555-4555-8555-555555555555','SYNTHETIC SECOND','Historical synthetic second.',now(),
'11111111-1111-4111-8111-111111111111/1700000000000_verification_shared.webp');
ALTER TABLE public.reviews ENABLE TRIGGER review_media_reference_guard;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.reviews'::regclass
   AND tgname='review_media_reference_guard' AND tgenabled='O') THEN RAISE EXCEPTION 'SHARED_FIXTURE_GUARD_NOT_RESTORED'; END IF;
END $$;
UPDATE public.reviews SET verification_photo=
'11111111-1111-4111-8111-111111111111/reviews/22222222-2222-4222-8222-222222222222/verification/replacement.webp'
WHERE id='22222222-2222-4222-8222-222222222222';
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM review_media_private.cleanup WHERE review_id='22222222-2222-4222-8222-222222222222'
  AND NOT retired AND NOT complete AND review_media_private.referenced(path)) THEN RAISE EXCEPTION 'SHARED_FIRST_REFERENCE_NOT_PROTECTED'; END IF;
END $$;
UPDATE public.reviews SET verification_photo=
'11111111-1111-4111-8111-111111111111/reviews/33333333-3333-4333-8333-333333333333/verification/replacement.webp'
WHERE id='33333333-3333-4333-8333-333333333333';
SET LOCAL ROLE service_role;
DO $$ DECLARE ready jsonb; expected integer:=__EXPECTED_READY__; BEGIN
 ready:=public.admin_review_verification_cleanup('33333333-3333-4333-8333-333333333333','prepare');
 IF jsonb_array_length(ready->'items')<>expected THEN RAISE EXCEPTION 'SHARED_LAST_REVIEW_READY_DRIFT'; END IF;
 IF expected=1 AND public.admin_review_verification_cleanup('33333333-3333-4333-8333-333333333333','finish',ARRAY[
  '11111111-1111-4111-8111-111111111111/1700000000000_verification_shared.webp'])->>'remaining'<>'1'
 THEN RAISE EXCEPTION 'SHARED_PRESENT_BYTES_COMPLETED'; END IF;
END $$;
RESET ROLE;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM review_media_private.cleanup WHERE NOT complete AND NOT review_media_private.referenced(path))
 THEN RAISE EXCEPTION 'SHARED_LOST_PENDING_QUEUE'; END IF;
END $$;
SET LOCAL storage.allow_delete_query='true';
DELETE FROM storage.objects WHERE bucket_id='review-photos';
SET LOCAL ROLE service_role;
DO $$ BEGIN
 IF __EXPECTED_READY__=1 AND public.admin_review_verification_cleanup('33333333-3333-4333-8333-333333333333','finish',ARRAY[
  '11111111-1111-4111-8111-111111111111/1700000000000_verification_shared.webp'])->>'remaining'<>'1'
 THEN RAISE EXCEPTION 'SHARED_PRIVATE_SURVIVOR_COMPLETED'; END IF;
END $$;
RESET ROLE;
DELETE FROM storage.objects WHERE bucket_id='review-verifications';
SET LOCAL ROLE service_role;
DO $$ BEGIN
 IF __EXPECTED_READY__=1 AND public.admin_review_verification_cleanup('33333333-3333-4333-8333-333333333333','finish',ARRAY[
  '11111111-1111-4111-8111-111111111111/1700000000000_verification_shared.webp'])->>'remaining'<>'0'
 THEN RAISE EXCEPTION 'SHARED_ABSENCE_NOT_COMPLETED'; END IF;
END $$;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub='11111111-1111-4111-8111-111111111111';
SET LOCAL request.jwt.claims='{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
DO $$ DECLARE key text:='11111111-1111-4111-8111-111111111111/reviews/33333333-3333-4333-8333-333333333333/food/77777777-7777-4777-8777-777777777777_0.webp'; BEGIN
 IF public.queue_review_upload_cleanup('33333333-3333-4333-8333-333333333333',ARRAY[key])<>'REVIEW_CLEANUP_QUEUED'
 THEN RAISE EXCEPTION 'STAGED_CANCEL_NOT_DURABLE'; END IF;
 PERFORM public.finish_review_media_cleanup();
 IF public.review_media_upload_allowed('review-photos',key) THEN RAISE EXCEPTION 'STAGED_LATE_UPLOAD_ALLOWED'; END IF;
 BEGIN
  INSERT INTO storage.objects(bucket_id,name) VALUES('review-photos',key);
  RAISE EXCEPTION 'STAGED_LATE_STORAGE_INSERT_ALLOWED';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SELECT jsonb_build_object('lastReviewReadyItems',__EXPECTED_READY__,'firstReferenceProtected',true,
 'fixtureGuardRestored',true,'lateStorageInsertDenied',true,'publicHttpDeletionVerified',false);
ROLLBACK;
