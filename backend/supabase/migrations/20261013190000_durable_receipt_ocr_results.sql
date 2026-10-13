-- Durable, server-owned OCR result claims. The table stores normalized receipt
-- fields only; images, raw provider output and provider diagnostics stay out.
CREATE SCHEMA IF NOT EXISTS ocr_private;
REVOKE ALL ON SCHEMA ocr_private FROM PUBLIC, anon, authenticated;

CREATE TABLE ocr_private.receipt_results (
  id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  image_hash text NOT NULL CHECK (image_hash ~ '^[0-9a-f]{64}$'),
  input_context_hash text NOT NULL CHECK (input_context_hash ~ '^[0-9a-f]{64}$'),
  provider text NOT NULL CHECK (provider = 'gemini'),
  model text NOT NULL CHECK (length(model) BETWEEN 1 AND 160),
  prompt_version text NOT NULL CHECK (length(prompt_version) BETWEEN 1 AND 160),
  preprocess_version text NOT NULL CHECK (length(preprocess_version) BETWEEN 1 AND 160),
  normalization_version text NOT NULL CHECK (length(normalization_version) BETWEEN 1 AND 160),
  status text NOT NULL CHECK (status IN ('processing', 'succeeded', 'indeterminate')),
  dispatch_stage text NOT NULL CHECK (dispatch_stage IN ('reserved', 'possibly_dispatched', 'completed', 'uncertain')),
  claim_token uuid,
  result_payload jsonb,
  result_revision uuid,
  claimed_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT receipt_results_state_check CHECK (
    -- A forced refresh may retain the last verified payload while its replacement
    -- is in flight. It is never returned until that claim resolves.
    (status = 'processing' AND dispatch_stage IN ('reserved', 'possibly_dispatched') AND claim_token IS NOT NULL AND completed_at IS NULL
      AND ((result_payload IS NULL AND result_revision IS NULL) OR (result_payload IS NOT NULL AND result_revision IS NOT NULL)))
    OR (status = 'succeeded' AND dispatch_stage IN ('completed', 'uncertain') AND claim_token IS NULL
      AND result_payload IS NOT NULL AND result_revision IS NOT NULL AND completed_at IS NOT NULL)
    OR (status = 'indeterminate' AND dispatch_stage = 'uncertain' AND claim_token IS NULL
      AND result_payload IS NULL AND result_revision IS NULL AND completed_at IS NOT NULL)
  ),
  CONSTRAINT receipt_results_fingerprint_key UNIQUE (
    user_id,
    image_hash,
    input_context_hash,
    provider,
    model,
    prompt_version,
    preprocess_version,
    normalization_version
  )
);

COMMENT ON TABLE ocr_private.receipt_results IS
  'Owner-bound normalized receipt OCR results. Rows have no automatic TTL: account deletion cascades, version-bound fingerprints prevent stale reuse, undispatched reservations require explicit recovery, and possibly dispatched calls remain blocked from replay.';

ALTER TABLE ocr_private.receipt_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE ocr_private.receipt_results FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE ocr_private.receipt_results FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION ocr_private.valid_result_payload(p_payload jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  v_normalized jsonb;
  v_entry jsonb;
  v_item jsonb;
  v_review_field text;
BEGIN
  IF p_payload IS NULL
    OR pg_catalog.jsonb_typeof(p_payload) <> 'object'
    OR pg_catalog.octet_length(pg_catalog.convert_to(p_payload::text, 'UTF8')) > 32768
    OR NOT (p_payload ?& ARRAY[
      'schema_version', 'provider', 'model', 'normalized', 'field_trust',
      'confidence', 'needs_review', 'normalization_version'
    ])
    OR EXISTS (
      SELECT 1
      FROM pg_catalog.jsonb_object_keys(p_payload) AS key(value)
      WHERE value <> ALL (ARRAY[
        'schema_version', 'provider', 'model', 'normalized', 'failure_code',
        'field_trust', 'confidence', 'needs_review', 'normalization_version'
      ])
    )
    OR pg_catalog.jsonb_typeof(p_payload->'schema_version') <> 'string'
    OR pg_catalog.jsonb_typeof(p_payload->'provider') <> 'string'
    OR pg_catalog.jsonb_typeof(p_payload->'model') <> 'string'
    OR pg_catalog.jsonb_typeof(p_payload->'normalization_version') <> 'string'
    OR p_payload->>'schema_version' <> 'receipt-public-ocr-v1'
    OR p_payload->>'provider' <> 'gemini'
    OR pg_catalog.length(pg_catalog.btrim(p_payload->>'model')) NOT BETWEEN 1 AND 160
    OR pg_catalog.btrim(p_payload->>'model') <> p_payload->>'model'
    OR pg_catalog.length(p_payload->>'normalization_version') NOT BETWEEN 1 AND 160
    OR pg_catalog.btrim(p_payload->>'normalization_version') <> p_payload->>'normalization_version'
    OR (p_payload ? 'failure_code' AND (
      pg_catalog.jsonb_typeof(p_payload->'failure_code') <> 'string'
      OR p_payload->>'failure_code' NOT IN ('not_receipt', 'unreadable', 'low_quality', 'ocr_failed')
    ))
  THEN
    RETURN false;
  END IF;

  IF pg_catalog.jsonb_typeof(p_payload->'confidence') <> 'number'
    OR (p_payload->>'confidence')::numeric NOT BETWEEN 0 AND 1
  THEN
    RETURN false;
  END IF;

  v_normalized := p_payload->'normalized';
  IF pg_catalog.jsonb_typeof(v_normalized) <> 'object'
    OR EXISTS (
      SELECT 1
      FROM pg_catalog.jsonb_object_keys(v_normalized) AS key(value)
      WHERE value <> ALL (ARRAY[
        'store_name', 'date', 'time', 'total_amount', 'category',
        'review_draft', 'items', 'confidence'
      ])
    )
  THEN
    RETURN false;
  END IF;

  IF v_normalized ? 'store_name'
    AND (pg_catalog.jsonb_typeof(v_normalized->'store_name') <> 'string'
      OR pg_catalog.length(v_normalized->>'store_name') NOT BETWEEN 1 AND 160
      OR pg_catalog.btrim(v_normalized->>'store_name') <> v_normalized->>'store_name')
  THEN RETURN false; END IF;

  IF v_normalized ? 'date'
    AND (pg_catalog.jsonb_typeof(v_normalized->'date') <> 'string'
      OR (v_normalized->>'date') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$')
  THEN RETURN false; END IF;

  IF v_normalized ? 'time'
    AND (pg_catalog.jsonb_typeof(v_normalized->'time') <> 'string'
      OR (v_normalized->>'time') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
  THEN RETURN false; END IF;

  IF v_normalized ? 'total_amount' THEN
    IF pg_catalog.jsonb_typeof(v_normalized->'total_amount') <> 'number'
      OR (v_normalized->>'total_amount')::numeric NOT BETWEEN 0 AND 1000000000
    THEN RETURN false; END IF;
  END IF;

  IF v_normalized ? 'category'
    AND (pg_catalog.jsonb_typeof(v_normalized->'category') <> 'string'
      OR pg_catalog.length(v_normalized->>'category') NOT BETWEEN 1 AND 32
      OR pg_catalog.btrim(v_normalized->>'category') <> v_normalized->>'category')
  THEN RETURN false; END IF;

  IF v_normalized ? 'review_draft'
    AND (pg_catalog.jsonb_typeof(v_normalized->'review_draft') <> 'string'
      OR pg_catalog.length(v_normalized->>'review_draft') NOT BETWEEN 1 AND 4000
      OR pg_catalog.btrim(v_normalized->>'review_draft') <> v_normalized->>'review_draft')
  THEN RETURN false; END IF;

  IF v_normalized ? 'confidence' THEN
    IF pg_catalog.jsonb_typeof(v_normalized->'confidence') <> 'number'
      OR (v_normalized->>'confidence')::numeric NOT BETWEEN 0 AND 1
    THEN RETURN false; END IF;
  END IF;

  IF v_normalized ? 'items' THEN
    IF pg_catalog.jsonb_typeof(v_normalized->'items') <> 'array'
      OR pg_catalog.jsonb_array_length(v_normalized->'items') > 50
    THEN RETURN false; END IF;
    FOR v_item IN SELECT value FROM pg_catalog.jsonb_array_elements(v_normalized->'items') LOOP
      IF pg_catalog.jsonb_typeof(v_item) <> 'object'
        OR NOT (v_item ?& ARRAY['name', 'price'])
        OR EXISTS (
          SELECT 1
          FROM pg_catalog.jsonb_object_keys(v_item) AS key(value)
          WHERE value <> ALL (ARRAY['name', 'price'])
        )
        OR pg_catalog.jsonb_typeof(v_item->'name') <> 'string'
        OR pg_catalog.length(v_item->>'name') NOT BETWEEN 1 AND 160
        OR pg_catalog.btrim(v_item->>'name') <> v_item->>'name'
      THEN RETURN false; END IF;
      IF pg_catalog.jsonb_typeof(v_item->'price') NOT IN ('number', 'null') THEN RETURN false; END IF;
      IF pg_catalog.jsonb_typeof(v_item->'price') = 'number'
        AND (v_item->>'price')::numeric NOT BETWEEN 0 AND 1000000000
      THEN RETURN false; END IF;
    END LOOP;
  END IF;

  IF pg_catalog.jsonb_typeof(p_payload->'field_trust') <> 'array'
    OR pg_catalog.jsonb_array_length(p_payload->'field_trust') > 16
  THEN RETURN false; END IF;
  FOR v_entry IN SELECT value FROM pg_catalog.jsonb_array_elements(p_payload->'field_trust') LOOP
    IF pg_catalog.jsonb_typeof(v_entry) <> 'object'
      OR NOT (v_entry ?& ARRAY['field', 'level', 'source', 'reason', 'needsReview'])
      OR EXISTS (
        SELECT 1
        FROM pg_catalog.jsonb_object_keys(v_entry) AS key(value)
        WHERE value <> ALL (ARRAY['field', 'level', 'source', 'reason', 'needsReview'])
      )
      OR v_entry->>'field' NOT IN ('store_name', 'restaurant_id', 'date', 'time', 'total_amount', 'items', 'category', 'review_draft')
      OR v_entry->>'level' NOT IN ('high', 'medium', 'low')
      OR v_entry->>'source' NOT IN ('model_raw', 'model_candidate', 'selected_restaurant', 'db_exact', 'db_fuzzy', 'rule_validation', 'user_required')
      OR pg_catalog.jsonb_typeof(v_entry->'reason') <> 'string'
      OR pg_catalog.length(v_entry->>'reason') NOT BETWEEN 1 AND 240
      OR pg_catalog.jsonb_typeof(v_entry->'needsReview') <> 'boolean'
    THEN RETURN false; END IF;
  END LOOP;

  IF pg_catalog.jsonb_typeof(p_payload->'needs_review') <> 'array'
    OR pg_catalog.jsonb_array_length(p_payload->'needs_review') > 8
  THEN RETURN false; END IF;
  FOR v_review_field IN SELECT value #>> '{}' FROM pg_catalog.jsonb_array_elements(p_payload->'needs_review') LOOP
    IF v_review_field NOT IN ('store_name', 'restaurant_id', 'date', 'time', 'total_amount', 'items', 'category', 'review_draft')
    THEN RETURN false; END IF;
  END LOOP;
  IF (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_array_elements_text(p_payload->'needs_review'))
    <> (SELECT pg_catalog.count(DISTINCT value) FROM pg_catalog.jsonb_array_elements_text(p_payload->'needs_review') AS field(value))
  THEN RETURN false; END IF;

  RETURN true;
EXCEPTION WHEN OTHERS THEN
  RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION ocr_private.valid_result_payload(jsonb) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.claim_receipt_ocr_result(
  p_user_id uuid,
  p_image_hash text,
  p_input_context_hash text,
  p_provider text,
  p_model text,
  p_prompt_version text,
  p_preprocess_version text,
  p_normalization_version text,
  p_operation_id uuid,
  p_force_refresh boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_result ocr_private.receipt_results%ROWTYPE;
BEGIN
  IF p_user_id IS NULL
    OR p_operation_id IS NULL
    OR p_image_hash IS NULL
    OR p_input_context_hash IS NULL
    OR p_provider IS NULL
    OR p_model IS NULL
    OR p_prompt_version IS NULL
    OR p_preprocess_version IS NULL
    OR p_normalization_version IS NULL
    OR p_image_hash !~ '^[0-9a-f]{64}$'
    OR p_input_context_hash !~ '^[0-9a-f]{64}$'
    OR p_provider <> 'gemini'
    OR length(p_model) NOT BETWEEN 1 AND 160
    OR length(p_prompt_version) NOT BETWEEN 1 AND 160
    OR length(p_preprocess_version) NOT BETWEEN 1 AND 160
    OR length(p_normalization_version) NOT BETWEEN 1 AND 160
  THEN
    RAISE EXCEPTION 'invalid_receipt_ocr_claim' USING ERRCODE = '22023';
  END IF;

  INSERT INTO ocr_private.receipt_results (
    user_id, image_hash, input_context_hash, provider, model,
    prompt_version, preprocess_version, normalization_version,
    status, dispatch_stage, claim_token
  ) VALUES (
    p_user_id, p_image_hash, p_input_context_hash, p_provider, p_model,
    p_prompt_version, p_preprocess_version, p_normalization_version,
    'processing', 'reserved', p_operation_id
  )
  ON CONFLICT (
    user_id, image_hash, input_context_hash, provider, model,
    prompt_version, preprocess_version, normalization_version
  ) DO NOTHING
  RETURNING * INTO v_result;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'status', 'claimed',
      'result_ref', v_result.id,
      'claim_token', v_result.claim_token
    );
  END IF;

  SELECT * INTO v_result
  FROM ocr_private.receipt_results
  WHERE user_id = p_user_id
    AND image_hash = p_image_hash
    AND input_context_hash = p_input_context_hash
    AND provider = p_provider
    AND model = p_model
    AND prompt_version = p_prompt_version
    AND preprocess_version = p_preprocess_version
    AND normalization_version = p_normalization_version
  FOR UPDATE;

  IF v_result.status = 'succeeded' AND (NOT p_force_refresh OR v_result.dispatch_stage = 'uncertain') THEN
    RETURN jsonb_build_object(
      'status', 'cached',
      'result_ref', v_result.id,
      'result_revision', v_result.result_revision,
      'result_payload', v_result.result_payload,
      'retry_blocked', v_result.dispatch_stage = 'uncertain'
    );
  END IF;

  IF v_result.status = 'processing' THEN
    IF p_force_refresh AND v_result.dispatch_stage = 'reserved' THEN
      UPDATE ocr_private.receipt_results
      SET claim_token = p_operation_id,
          claimed_at = now(),
          updated_at = now()
      WHERE id = v_result.id
        AND status = 'processing'
        AND dispatch_stage = 'reserved'
        AND claim_token = v_result.claim_token
      RETURNING * INTO v_result;
      IF FOUND THEN
        RETURN jsonb_build_object(
          'status', 'claimed',
          'result_ref', v_result.id,
          'claim_token', v_result.claim_token,
          'recovered_reservation', true
        );
      END IF;
    ELSIF p_force_refresh AND v_result.dispatch_stage = 'possibly_dispatched' THEN
      UPDATE ocr_private.receipt_results
      SET status = CASE WHEN result_payload IS NULL THEN 'indeterminate' ELSE 'succeeded' END,
          dispatch_stage = 'uncertain',
          claim_token = NULL,
          completed_at = now(),
          updated_at = now()
      WHERE id = v_result.id
        AND status = 'processing'
        AND dispatch_stage = 'possibly_dispatched'
        AND claim_token = v_result.claim_token
      RETURNING * INTO v_result;
      IF FOUND AND v_result.result_payload IS NOT NULL THEN
        RETURN jsonb_build_object(
          'status', 'cached',
          'result_ref', v_result.id,
          'result_revision', v_result.result_revision,
          'result_payload', v_result.result_payload,
          'retry_blocked', true
        );
      ELSIF FOUND THEN
        RETURN jsonb_build_object('status', 'indeterminate', 'result_ref', v_result.id);
      END IF;
    END IF;
    RETURN jsonb_build_object('status', 'processing', 'result_ref', v_result.id);
  END IF;

  -- An uncertain provider dispatch is never replayed by force refresh. Any
  -- future retry needs a separate reviewed server operation, not this route.
  IF v_result.status = 'indeterminate' OR NOT p_force_refresh THEN
    RETURN jsonb_build_object('status', 'indeterminate', 'result_ref', v_result.id);
  END IF;

  UPDATE ocr_private.receipt_results
  SET status = 'processing',
      dispatch_stage = 'reserved',
      claim_token = p_operation_id,
      claimed_at = now(),
      completed_at = NULL,
      updated_at = now()
  WHERE id = v_result.id
  RETURNING * INTO v_result;

  RETURN jsonb_build_object(
    'status', 'claimed',
    'result_ref', v_result.id,
    'claim_token', v_result.claim_token
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_receipt_ocr_dispatched(
  p_result_id uuid,
  p_claim_token uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_result ocr_private.receipt_results%ROWTYPE;
BEGIN
  UPDATE ocr_private.receipt_results
  SET dispatch_stage = 'possibly_dispatched',
      updated_at = now()
  WHERE id = p_result_id
    AND status = 'processing'
    AND dispatch_stage = 'reserved'
    AND claim_token = p_claim_token
  RETURNING * INTO v_result;

  IF FOUND THEN
    RETURN jsonb_build_object('status', 'dispatched', 'result_ref', v_result.id);
  END IF;
  SELECT * INTO v_result FROM ocr_private.receipt_results WHERE id = p_result_id;
  IF v_result.status = 'processing'
    AND v_result.dispatch_stage = 'possibly_dispatched'
    AND v_result.claim_token = p_claim_token
  THEN
    RETURN jsonb_build_object('status', 'dispatched', 'result_ref', v_result.id);
  END IF;
  RAISE EXCEPTION 'receipt_ocr_claim_mismatch' USING ERRCODE = '42501';
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_receipt_ocr_result(
  p_result_id uuid,
  p_claim_token uuid,
  p_result_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_result ocr_private.receipt_results%ROWTYPE;
BEGIN
  IF NOT ocr_private.valid_result_payload(p_result_payload) THEN
    RAISE EXCEPTION 'invalid_receipt_ocr_result' USING ERRCODE = '22023';
  END IF;

  UPDATE ocr_private.receipt_results
  SET status = 'succeeded',
      dispatch_stage = 'completed',
      claim_token = NULL,
      result_payload = p_result_payload,
      result_revision = extensions.gen_random_uuid(),
      completed_at = now(),
      updated_at = now()
  WHERE id = p_result_id
    AND status = 'processing'
    AND dispatch_stage = 'possibly_dispatched'
    AND claim_token = p_claim_token
    AND provider = p_result_payload->>'provider'
    AND model = p_result_payload->>'model'
    AND normalization_version = p_result_payload->>'normalization_version'
  RETURNING * INTO v_result;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'status', 'succeeded',
      'result_ref', v_result.id,
      'result_revision', v_result.result_revision
    );
  END IF;

  SELECT * INTO v_result FROM ocr_private.receipt_results WHERE id = p_result_id;
  IF v_result.status = 'succeeded' AND v_result.result_payload = p_result_payload THEN
    RETURN jsonb_build_object(
      'status', 'succeeded',
      'result_ref', v_result.id,
      'result_revision', v_result.result_revision
    );
  END IF;
  RAISE EXCEPTION 'receipt_ocr_claim_mismatch' USING ERRCODE = '42501';
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_receipt_ocr_result_indeterminate(
  p_result_id uuid,
  p_claim_token uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_result ocr_private.receipt_results%ROWTYPE;
BEGIN
  UPDATE ocr_private.receipt_results
  SET status = CASE WHEN result_payload IS NULL THEN 'indeterminate' ELSE 'succeeded' END,
      dispatch_stage = 'uncertain',
      claim_token = NULL,
      completed_at = now(),
      updated_at = now()
  WHERE id = p_result_id
    AND status = 'processing'
    AND dispatch_stage = 'possibly_dispatched'
    AND claim_token = p_claim_token
  RETURNING * INTO v_result;

  IF FOUND THEN
    RETURN jsonb_build_object('status', v_result.status, 'result_ref', v_result.id);
  END IF;
  SELECT * INTO v_result FROM ocr_private.receipt_results WHERE id = p_result_id;
  IF v_result.status = 'succeeded' THEN
    RETURN jsonb_build_object('status', 'succeeded', 'result_ref', v_result.id);
  END IF;
  RAISE EXCEPTION 'receipt_ocr_claim_mismatch' USING ERRCODE = '42501';
END;
$$;

CREATE OR REPLACE FUNCTION public.release_receipt_ocr_claim(
  p_result_id uuid,
  p_claim_token uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_restored boolean := false;
BEGIN
  UPDATE ocr_private.receipt_results
  SET status = 'succeeded',
      dispatch_stage = 'completed',
      claim_token = NULL,
      completed_at = now(),
      updated_at = now()
  WHERE id = p_result_id
    AND status = 'processing'
    AND dispatch_stage = 'reserved'
    AND claim_token = p_claim_token
    AND result_payload IS NOT NULL;
  v_restored := FOUND;

  DELETE FROM ocr_private.receipt_results
  WHERE id = p_result_id
    AND status = 'processing'
    AND dispatch_stage = 'reserved'
    AND claim_token = p_claim_token
    AND result_payload IS NULL;
  IF NOT FOUND AND NOT v_restored THEN
    RAISE EXCEPTION 'receipt_ocr_claim_mismatch' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object('status', 'released', 'result_ref', p_result_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_owned_review_storage_objects(
  p_user_id uuid,
  p_review_id uuid,
  p_purpose text,
  p_names text[]
)
RETURNS TABLE (
  id uuid,
  bucket_id text,
  name text,
  owner_id text,
  version text,
  updated_at timestamptz,
  metadata jsonb,
  archived_at timestamptz,
  is_delete_marker boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_bucket text;
  v_prefix text;
BEGIN
  v_bucket := CASE p_purpose
    WHEN 'verification' THEN 'review-verifications'
    WHEN 'food' THEN 'review-photos'
    ELSE NULL
  END;
  v_prefix := p_user_id::text || '/reviews/' || p_review_id::text || '/' || p_purpose || '/';
  IF p_user_id IS NULL OR p_review_id IS NULL OR v_bucket IS NULL
    OR p_names IS NULL OR cardinality(p_names) NOT BETWEEN 1 AND 20
    OR (SELECT count(*) FROM unnest(p_names)) <> (SELECT count(DISTINCT object_name) FROM unnest(p_names) AS object_name)
    OR EXISTS (
      SELECT 1 FROM unnest(p_names) AS object_name
      WHERE object_name NOT LIKE v_prefix || '%'
        OR substring(object_name FROM length(v_prefix) + 1) LIKE '%/%'
    )
  THEN
    RAISE EXCEPTION 'invalid_review_storage_lookup' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT object_row.id, object_row.bucket_id, object_row.name, object_row.owner_id,
         object_row.version, object_row.updated_at, object_row.metadata,
         object_row.archived_at, object_row.is_delete_marker
  FROM storage.objects AS object_row
  WHERE object_row.bucket_id = v_bucket
    AND object_row.name = ANY(p_names)
    AND object_row.owner_id = p_user_id::text
    AND object_row.archived_at IS NULL
    AND object_row.is_delete_marker = false
  ORDER BY object_row.name;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_review_with_receipt_ocr(
  p_review_id uuid,
  p_user_id uuid,
  p_restaurant_id uuid,
  p_title text,
  p_content text,
  p_visited_at timestamptz,
  p_verification_photo text,
  p_food_photos text[],
  p_categories text[],
  p_ocr_result_id uuid,
  p_ocr_result_revision uuid,
  p_verification_object_id uuid,
  p_verification_object_version text,
  p_verification_object_updated_at timestamptz,
  p_verification_photo_sha256 text,
  p_user_corrections jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_result ocr_private.receipt_results%ROWTYPE;
  v_normalized jsonb;
  v_receipt_data jsonb;
  v_receipt_hash text;
  v_duplicate_of uuid;
  v_owner_prefix text := p_user_id::text || '/reviews/' || p_review_id::text || '/';
  v_verification_object storage.objects%ROWTYPE;
  v_food_object storage.objects%ROWTYPE;
  v_food_photo text;
BEGIN
  IF p_review_id IS NULL OR p_user_id IS NULL OR p_restaurant_id IS NULL
    OR p_ocr_result_id IS NULL OR p_ocr_result_revision IS NULL
    OR p_verification_object_id IS NULL OR p_verification_object_updated_at IS NULL
    OR p_verification_photo_sha256 IS NULL OR p_verification_photo_sha256 !~ '^[0-9a-f]{64}$'
    OR p_verification_photo IS NULL OR p_verification_photo NOT LIKE v_owner_prefix || 'verification/%'
    OR substring(p_verification_photo FROM length(v_owner_prefix || 'verification/') + 1) LIKE '%/%'
    OR p_food_photos IS NULL OR cardinality(p_food_photos) = 0
    OR EXISTS (SELECT 1 FROM unnest(p_food_photos) AS photo WHERE photo NOT LIKE v_owner_prefix || 'food/%')
    OR EXISTS (SELECT 1 FROM unnest(p_food_photos) AS photo WHERE substring(photo FROM length(v_owner_prefix || 'food/') + 1) LIKE '%/%')
    OR (SELECT count(*) FROM unnest(p_food_photos)) <> (SELECT count(DISTINCT photo) FROM unnest(p_food_photos) AS photo)
    OR p_user_corrections IS NULL OR jsonb_typeof(p_user_corrections) <> 'object'
    OR p_user_corrections ?| ARRAY['receipt_hash', 'ocr_result_id', 'ocr_result_revision', 'source', 'schema_version', 'status']
  THEN
    RAISE EXCEPTION 'invalid_review_receipt_input' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_result
  FROM ocr_private.receipt_results
  WHERE id = p_ocr_result_id AND user_id = p_user_id AND status = 'succeeded'
  FOR SHARE;
  IF NOT FOUND OR NOT ocr_private.valid_result_payload(v_result.result_payload) THEN
    RAISE EXCEPTION 'receipt_ocr_result_not_available' USING ERRCODE = '42501';
  END IF;
  IF v_result.result_revision IS DISTINCT FROM p_ocr_result_revision THEN
    RAISE EXCEPTION 'receipt_ocr_result_stale' USING ERRCODE = '42501';
  END IF;
  IF v_result.image_hash <> p_verification_photo_sha256 THEN
    RAISE EXCEPTION 'receipt_ocr_image_mismatch' USING ERRCODE = '42501';
  END IF;

  -- This row lock protects only Storage metadata. Correct byte binding requires
  -- the Storage service to update version/updated_at atomically with content,
  -- immutable verification keys (browser upsert:false and no authenticated
  -- UPDATE policy), and no out-of-band direct S3 overwrite.
  SELECT * INTO v_verification_object
  FROM storage.objects
  WHERE id = p_verification_object_id
    AND bucket_id = 'review-verifications'
    AND name = p_verification_photo
    AND owner_id = p_user_id::text
    AND archived_at IS NULL
    AND is_delete_marker = false
  FOR SHARE;
  IF NOT FOUND
    OR v_verification_object.version IS DISTINCT FROM p_verification_object_version
    OR v_verification_object.updated_at IS DISTINCT FROM p_verification_object_updated_at
  THEN
    RAISE EXCEPTION 'receipt_verification_object_not_available' USING ERRCODE = '42501';
  END IF;

  FOREACH v_food_photo IN ARRAY p_food_photos LOOP
    SELECT * INTO v_food_object
    FROM storage.objects
    WHERE bucket_id = 'review-photos'
      AND name = v_food_photo
      AND owner_id = p_user_id::text
      AND archived_at IS NULL
      AND is_delete_marker = false
    FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'review_food_object_not_available' USING ERRCODE = '42501';
    END IF;
  END LOOP;

  v_normalized := v_result.result_payload->'normalized';
  IF v_result.result_payload ? 'failure_code' THEN
    v_receipt_data := jsonb_build_object(
      'schema_version', 'receipt_summary_v1',
      'status', 'failed',
      'failure_code', v_result.result_payload->>'failure_code',
      'source', 'public_ocr',
      'ocr_result_id', v_result.id,
      'ocr_result_revision', v_result.result_revision
    );
  ELSE
    v_receipt_data := jsonb_strip_nulls(jsonb_build_object(
      'schema_version', 'receipt_summary_v1',
      'status', 'processed',
      'source', 'public_ocr',
      'ocr_result_id', v_result.id,
      'ocr_result_revision', v_result.result_revision,
      'store_name', v_normalized->'store_name',
      'date', v_normalized->'date',
      'time', v_normalized->'time',
      'total_amount', v_normalized->'total_amount',
      'items', v_normalized->'items',
      'item_count', COALESCE(jsonb_array_length(CASE WHEN jsonb_typeof(v_normalized->'items') = 'array' THEN v_normalized->'items' ELSE '[]'::jsonb END), 0),
      'confidence', v_result.result_payload->'confidence',
      'user_corrections', p_user_corrections
    ));

    IF NULLIF(v_normalized->>'store_name', '') IS NOT NULL
      AND (v_normalized->>'date') ~ '^\d{4}-\d{2}-\d{2}$'
      AND (v_normalized->>'time') ~ '^\d{2}:\d{2}$'
      AND jsonb_typeof(v_normalized->'total_amount') = 'number'
    THEN
      v_receipt_hash := encode(extensions.digest(
        (v_normalized->>'store_name') || '|' || (v_normalized->>'date') || '|'
        || (v_normalized->>'time') || '|' || (v_normalized->>'total_amount'),
        'sha256'
      ), 'hex');
      PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_receipt_hash, 0));
      SELECT id INTO v_duplicate_of
      FROM public.reviews
      WHERE receipt_hash = v_receipt_hash
      ORDER BY created_at, id
      LIMIT 1;
      IF v_duplicate_of IS NOT NULL THEN
        v_receipt_data := v_receipt_data || jsonb_build_object('duplicate_of', v_duplicate_of);
      END IF;
    END IF;
  END IF;

  INSERT INTO public.reviews (
    id, user_id, restaurant_id, title, content, visited_at,
    verification_photo, food_photos, categories, is_verified,
    receipt_hash, receipt_data, is_duplicate, ocr_processed_at
  ) VALUES (
    p_review_id, p_user_id, p_restaurant_id, p_title, p_content, p_visited_at,
    p_verification_photo, p_food_photos, p_categories, false,
    CASE WHEN v_duplicate_of IS NULL THEN v_receipt_hash ELSE NULL END,
    v_receipt_data,
    v_duplicate_of IS NOT NULL,
    now()
  );

  RETURN p_review_id;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_receipt_ocr_result(uuid,text,text,text,text,text,text,text,uuid,boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_receipt_ocr_dispatched(uuid,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_receipt_ocr_result(uuid,uuid,jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_receipt_ocr_result_indeterminate(uuid,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_receipt_ocr_claim(uuid,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_owned_review_storage_objects(uuid,uuid,text,text[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_review_with_receipt_ocr(uuid,uuid,uuid,text,text,timestamptz,text,text[],text[],uuid,uuid,uuid,text,timestamptz,text,jsonb) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.claim_receipt_ocr_result(uuid,text,text,text,text,text,text,text,uuid,boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_receipt_ocr_dispatched(uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_receipt_ocr_result(uuid,uuid,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_receipt_ocr_result_indeterminate(uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_receipt_ocr_claim(uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_owned_review_storage_objects(uuid,uuid,text,text[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_review_with_receipt_ocr(uuid,uuid,uuid,text,text,timestamptz,text,text[],text[],uuid,uuid,uuid,text,timestamptz,text,jsonb) TO service_role;
