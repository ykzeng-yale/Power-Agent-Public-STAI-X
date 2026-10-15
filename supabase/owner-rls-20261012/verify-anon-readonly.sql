-- SELECT-only verification in a rollback-only transaction; no row content or IDs.

BEGIN READ ONLY;

SELECT pg_catalog.set_config('request.jwt.claim.sub','',true) IS NOT NULL AS cleared_sub;

SELECT pg_catalog.set_config('request.jwt.claims','{"role":"anon"}',true) IS NOT NULL AS cleared_claims;

SET LOCAL ROLE anon;

WITH counts AS (SELECT jsonb_build_object('chat_sessions', (SELECT count(*) FROM public.chat_sessions),'chat_messages', (SELECT count(*) FROM public.chat_messages),'messages', (SELECT count(*) FROM public.messages),'session_files', (SELECT count(*) FROM public.session_files),'workflow_steps', (SELECT count(*) FROM public.workflow_steps),'shared_files', (SELECT count(*) FROM public.shared_files)) AS observed_counts) SELECT jsonb_build_object('current_user',current_user,'visible_counts',observed_counts,'all_private_counts_zero',NOT EXISTS (SELECT 1 FROM jsonb_each_text(observed_counts) item WHERE item.value::bigint <> 0)) AS verification FROM counts;

ROLLBACK;
