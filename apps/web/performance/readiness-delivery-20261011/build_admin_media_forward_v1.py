"""Bind a new forward migration to the owned schema-only PG17 clone.

No hosted connection, role widening, existing SQL edits, or assertion rewrites.
The CLI-created empty target is filled once. Data and original clones stay put.
"""
from pathlib import Path
import hashlib
import json
import subprocess

ROOT = Path(__file__).resolve().parents[4]
TARGET = ROOT / 'backend/supabase/migrations/20261011072824_admin_review_media_completion.sql'
PREFIX = ['docker', '--context', 'colima-tzudong-catalog-20261007', 'exec', '-i', '-e',
          'PGPASSWORD=fixture-only', 'tzudong-ranking-clone-20261008', 'psql', '-XAtq',
          '-v', 'ON_ERROR_STOP=1', '-h', '127.0.0.1', '-U', 'supabase_admin',
          '-d', 'readiness_integrated_nine_v4_20261010']
ADMIN = 'public.admin_record_action(uuid,text,uuid,text,uuid[],jsonb,text)'
OWNER = 'public.mutate_review_with_media(uuid,uuid,text,timestamp with time zone,text,text[],text[])'


def sha(value):
    return hashlib.sha256(value.encode()).hexdigest()


def read_body(signature):
    result = subprocess.run(PREFIX, input=f"SELECT prosrc FROM pg_proc WHERE oid='{signature}'::regprocedure;",
                            capture_output=True, text=True, check=True)
    # psql preserves the stored body's trailing newline, plus its row terminator.
    return result.stdout[:-1]


def one(source, before, after):
    if source.count(before) != 1:
        raise ValueError('FORWARD_ANCHOR_DENIED')
    return source.replace(before, after)


NEW_BODY = """
DECLARE items jsonb;
BEGIN
  IF p_review_id IS NULL OR p_phase IS NULL OR p_phase NOT IN ('prepare','finish')
     OR current_setting('transaction_isolation') <> 'read committed'
     OR (p_phase = 'prepare' AND p_paths IS NOT NULL)
     OR (p_phase = 'finish' AND (p_paths IS NULL OR cardinality(p_paths) > 20
       OR EXISTS (SELECT 1 FROM unnest(p_paths) x WHERE x IS NULL OR octet_length(x) > 8192)
       OR cardinality(p_paths) <> (SELECT count(DISTINCT x) FROM unnest(p_paths) x))) THEN
    RAISE EXCEPTION 'REVIEW_ADMIN_CLEANUP_INVALID';
  END IF;
  PERFORM pg_advisory_xact_lock(741093, 1);
  IF p_phase = 'prepare' THEN
    UPDATE review_media_private.cleanup c SET retired = true
      WHERE c.review_id = p_review_id AND c.purpose = 'verification'
        AND NOT c.retired AND NOT c.complete AND NOT review_media_private.referenced(c.path);
    SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.path),'[]'::jsonb) INTO items
      FROM (SELECT c.path,c.owner_id,c.review_id,c.purpose FROM review_media_private.cleanup c
        WHERE c.review_id = p_review_id AND c.purpose = 'verification' AND c.retired AND NOT c.complete
          AND NOT review_media_private.referenced(c.path)
          AND (review_media_private.canonical(c.path,c.owner_id,c.review_id,c.purpose)
            OR review_media_private.owned_legacy(c.path,c.owner_id,c.purpose))
        ORDER BY c.path LIMIT 20) x;
    RETURN jsonb_build_object('status','READY','items',items);
  END IF;
  UPDATE review_media_private.cleanup c SET complete = true
    WHERE c.review_id = p_review_id AND c.purpose = 'verification' AND c.retired AND NOT c.complete
      AND c.path = ANY(p_paths)
      AND (review_media_private.canonical(c.path,c.owner_id,c.review_id,c.purpose)
        OR review_media_private.owned_legacy(c.path,c.owner_id,c.purpose))
      AND NOT review_media_private.referenced(c.path)
      AND NOT EXISTS (SELECT 1 FROM storage.objects o
        WHERE o.bucket_id IN ('review-photos','review-verifications') AND o.name = c.path);
  RETURN jsonb_build_object('remaining',(SELECT count(*) FROM review_media_private.cleanup c
    WHERE c.review_id = p_review_id AND c.purpose = 'verification' AND NOT c.complete));
END
"""


def build():
    if TARGET.read_bytes():
        raise ValueError('FORWARD_TARGET_NOT_EMPTY')
    admin, owner = read_body(ADMIN), read_body(OWNER)
    if sha(admin) != 'a18fad1f748d736371a9ab549a1ca483a5b2f321674fabe71b2411b7e58b3fc9' or sha(owner) != '50bfad7bc4fc7ddbc9d9379e8eb13facd938a15f66553576cc69fbcf69aa98b1':
        raise ValueError('FORWARD_SOURCE_DENIED')
    table_before = 'LOCK TABLE public.restaurants,public.restaurant_submissions,public.restaurant_submission_items,public.reviews,public.restaurant_requests IN SHARE ROW EXCLUSIVE MODE;'
    table_after = 'LOCK TABLE public.reviews,public.restaurants,public.restaurant_submissions,public.restaurant_submission_items,public.restaurant_requests IN SHARE ROW EXCLUSIVE MODE;'
    cleanup_before = "IF p_phase LIKE 'cleanup_%' THEN"
    cleanup_after = cleanup_before + '\n  PERFORM pg_advisory_xact_lock(741093, 1);'
    media_before = "IF p_action='review.delete' THEN\n  FOR media"
    media_after = "IF p_action='review.delete' THEN\n  PERFORM pg_advisory_xact_lock(741093, 1);\n  FOR media"
    owner_before = 'PERFORM pg_advisory_xact_lock(741093, 1);'
    owner_after = 'LOCK TABLE public.reviews IN ROW EXCLUSIVE MODE;\n  ' + owner_before
    patched_admin = one(one(one(admin, table_before, table_after), cleanup_before, cleanup_after), media_before, media_after)
    patched_owner = one(owner, owner_before, owner_after)
    transformations = [(ADMIN, admin, patched_admin, [(table_before, table_after), (cleanup_before, cleanup_after), (media_before, media_after)]),
                       (OWNER, owner, patched_owner, [(owner_before, owner_after)])]
    patches = []
    for signature, original, changed, replacements in transformations:
        commands = []
        for before, after in replacements:
            commands.append(f"  IF (length(patched)-length(replace(patched,$old${before}$old$,'')))/length($old${before}$old$)<>1 THEN RAISE EXCEPTION 'REVIEW_MEDIA_LOCK_ANCHOR_DRIFT'; END IF;\n  patched:=replace(patched,$old${before}$old$,$new${after}$new$);")
        patches.append(f"""
  target:='{signature}'::regprocedure;
  SELECT pg_get_functiondef(p.oid),p.prosrc,to_jsonb(p)-ARRAY['prosrc','proargdefaults'],pg_get_expr(p.proargdefaults,0)
    INTO definition,source,metadata,defaults FROM pg_proc p WHERE p.oid=target;
  IF encode(sha256(convert_to(source,'UTF8')),'hex')<>'{sha(original)}' THEN RAISE EXCEPTION 'REVIEW_MEDIA_LOCK_SOURCE_DRIFT'; END IF;
  patched:=source;
{chr(10).join(commands)}
  EXECUTE replace(definition,source,patched);
  IF (SELECT to_jsonb(p)-ARRAY['prosrc','proargdefaults'] FROM pg_proc p WHERE p.oid=target) IS DISTINCT FROM metadata
    OR (SELECT pg_get_expr(p.proargdefaults,0) FROM pg_proc p WHERE p.oid=target) IS DISTINCT FROM defaults
    OR (SELECT encode(sha256(convert_to(p.prosrc,'UTF8')),'hex') FROM pg_proc p WHERE p.oid=target)<>'{sha(changed)}'
    THEN RAISE EXCEPTION 'REVIEW_MEDIA_LOCK_POST_DRIFT'; END IF;
""")
    sql = f"""-- Forward-only correction. Immutable applied SQL and G014 assertions stay intact.
-- Relation locks precede the media global lock; global precedes object locks.
-- Admin locks reviews before restaurants, matching review-trigger counter work.
BEGIN;
SET LOCAL lock_timeout='2s';
SELECT pg_advisory_xact_lock(hashtextextended('tzudong:review-media-catalog:v2',0));
DO $forward$
DECLARE target oid; definition text; source text; patched text; metadata jsonb; defaults text;
  before_members jsonb; before_assertions jsonb; before_manifest jsonb; self_membership jsonb;
  workflow_owner oid:='privacy_workflow_owner'::regrole; runner oid:='postgres'::regrole;
  major integer:=current_setting('server_version_num')::integer/10000; pg15_lease boolean:=false;
BEGIN
  IF current_user<>'postgres' OR session_user<>'postgres' OR major NOT IN (15,17)
    OR current_setting('transaction_read_only')<>'off' OR NOT EXISTS(SELECT 1 FROM pg_roles
      WHERE oid=workflow_owner AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcanlogin AND NOT rolinherit)
    OR to_regprocedure('public.admin_review_verification_cleanup(uuid,text,text[])') IS NOT NULL
    THEN RAISE EXCEPTION 'REVIEW_MEDIA_FORWARD_EXECUTOR_DENIED'; END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY roleid,member,grantor),'[]') INTO before_members FROM pg_auth_members m;
  SELECT jsonb_agg(to_jsonb(p) ORDER BY oid) INTO before_assertions FROM pg_proc p WHERE pronamespace='privacy_retention'::regnamespace;
{patches[0]}
  SELECT to_jsonb(m) INTO self_membership FROM pg_auth_members m WHERE roleid=workflow_owner AND member=runner AND grantor=runner;
  IF self_membership IS NOT NULL AND (self_membership->>'admin_option')::boolean THEN RAISE EXCEPTION 'REVIEW_MEDIA_FORWARD_MEMBERSHIP_DENIED'; END IF;
  IF major=17 THEN
    IF NOT EXISTS(SELECT 1 FROM pg_auth_members WHERE roleid=workflow_owner AND member=runner AND admin_option AND grantor<>runner)
      THEN RAISE EXCEPTION 'REVIEW_MEDIA_FORWARD_OWNER_AUTHORITY_MISSING'; END IF;
    EXECUTE 'GRANT privacy_workflow_owner TO postgres WITH ADMIN FALSE,INHERIT FALSE,SET TRUE GRANTED BY postgres';
  ELSE
    pg15_lease:=NOT pg_has_role(runner,workflow_owner,'MEMBER');
    IF pg15_lease THEN GRANT privacy_workflow_owner TO postgres; END IF;
  END IF;
  SET LOCAL ROLE privacy_workflow_owner;
  SELECT jsonb_agg(to_jsonb(m) ORDER BY manifest_kind,manifest_key) INTO before_manifest FROM privacy_retention.g014_catalog_contract_manifest m;
{patches[1]}
  EXECUTE $rpc$CREATE FUNCTION public.admin_review_verification_cleanup(p_review_id uuid,p_phase text,p_paths text[] DEFAULT NULL)
    RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $cleanup${NEW_BODY}$cleanup$;$rpc$;
  REVOKE ALL ON FUNCTION public.admin_review_verification_cleanup(uuid,text,text[]) FROM PUBLIC,anon,authenticated,service_role;
  GRANT EXECUTE ON FUNCTION public.admin_review_verification_cleanup(uuid,text,text[]) TO service_role;
  INSERT INTO privacy_retention.g014_public_rpc_allowlist(function_schema,function_name,identity_arguments,grantee,source_signature)
    SELECT 'public',p.proname,p.proargtypes::text,'service_role','public.admin_review_verification_cleanup(uuid,text,text[])'
    FROM pg_proc p WHERE p.oid='public.admin_review_verification_cleanup(uuid,text,text[])'::regprocedure;
  IF to_regprocedure('pg_temp.admin_media_forward_assert()') IS NOT NULL THEN RAISE EXCEPTION 'REVIEW_MEDIA_FORWARD_BRIDGE_EXISTS'; END IF;
  CREATE FUNCTION pg_temp.admin_media_forward_assert() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $bridge$
  BEGIN
    PERFORM privacy_retention.assert_g014_public_rpc_allowlist();
    PERFORM privacy_retention.assert_g014_definer_contract();
    PERFORM privacy_retention.assert_g014_catalog_contract();
    DROP FUNCTION pg_temp.admin_media_forward_assert();
  END $bridge$;
  REVOKE ALL ON FUNCTION pg_temp.admin_media_forward_assert() FROM PUBLIC,anon,authenticated,service_role;
  GRANT EXECUTE ON FUNCTION pg_temp.admin_media_forward_assert() TO postgres;
  IF (SELECT jsonb_agg(to_jsonb(m) ORDER BY manifest_kind,manifest_key) FROM privacy_retention.g014_catalog_contract_manifest m) IS DISTINCT FROM before_manifest THEN RAISE EXCEPTION 'REVIEW_MEDIA_FORWARD_MANIFEST_DRIFT'; END IF;
  RESET ROLE;
  IF major=15 THEN
    IF pg15_lease THEN REVOKE privacy_workflow_owner FROM postgres; END IF;
  ELSIF self_membership IS NULL THEN
    REVOKE privacy_workflow_owner FROM postgres GRANTED BY postgres;
  ELSE
    EXECUTE format('GRANT privacy_workflow_owner TO postgres WITH ADMIN FALSE,INHERIT %s,SET %s GRANTED BY postgres',
      upper(self_membership->>'inherit_option'),upper(self_membership->>'set_option'));
  END IF;
  IF (SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY roleid,member,grantor),'[]') FROM pg_auth_members m) IS DISTINCT FROM before_members
    OR (SELECT jsonb_agg(to_jsonb(p) ORDER BY oid) FROM pg_proc p WHERE pronamespace='privacy_retention'::regnamespace) IS DISTINCT FROM before_assertions
    THEN RAISE EXCEPTION 'REVIEW_MEDIA_FORWARD_PRESERVATION_DRIFT'; END IF;
  PERFORM pg_temp.admin_media_forward_assert();
  IF to_regprocedure('pg_temp.admin_media_forward_assert()') IS NOT NULL THEN RAISE EXCEPTION 'REVIEW_MEDIA_FORWARD_BRIDGE_REMAINING'; END IF;
END $forward$;
-- ADMIN_REVIEW_MEDIA_READBACK_BEGIN
DO $readback$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid='public.admin_review_verification_cleanup(uuid,text,text[])'::regprocedure
    AND p.proowner='privacy_workflow_owner'::regrole AND p.prosecdef AND p.proconfig=ARRAY['search_path=""']::text[]
    AND p.pronargs=3 AND p.pronargdefaults=1 AND p.prorettype='jsonb'::regtype AND NOT p.proretset
    AND p.provolatile='v' AND p.prokind='f' AND NOT p.proisstrict
    AND p.proargnames=ARRAY['p_review_id','p_phase','p_paths']::text[]
    AND pg_get_expr(p.proargdefaults,0)='NULL::text[]'
    AND p.prolang=(SELECT oid FROM pg_language WHERE lanname='plpgsql')
    AND NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
      WHERE a.is_grantable OR a.privilege_type<>'EXECUTE'
        OR a.grantee NOT IN ('privacy_workflow_owner'::regrole,'service_role'::regrole))
    AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='{sha(NEW_BODY)}'
    AND NOT has_function_privilege('anon',p.oid,'EXECUTE') AND NOT has_function_privilege('authenticated',p.oid,'EXECUTE')
    AND has_function_privilege('service_role',p.oid,'EXECUTE'))
    OR (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc WHERE oid='{ADMIN}'::regprocedure)<>'{sha(patched_admin)}'
    OR (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc WHERE oid='{OWNER}'::regprocedure)<>'{sha(patched_owner)}'
    THEN RAISE EXCEPTION 'REVIEW_MEDIA_FORWARD_READBACK_DRIFT'; END IF;
END $readback$;
-- ADMIN_REVIEW_MEDIA_READBACK_END
NOTIFY pgrst,'reload schema';
COMMIT;
"""
    TARGET.write_text(sql, encoding='utf8')
    print(json.dumps({'target':str(TARGET.relative_to(ROOT)), 'migrationSha256':sha(sql),
                      'adminAfter':sha(patched_admin),'ownerAfter':sha(patched_owner),'rpcBody':sha(NEW_BODY),
                      'hostedWrites':0,'existingSourcesChanged':False}))


if __name__ == '__main__':
    build()
