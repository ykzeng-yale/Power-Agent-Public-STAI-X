-- SELECT-only rollback transaction, clearing user claims and verifying unchanged service-role counts.

BEGIN READ ONLY;

SELECT pg_catalog.set_config('request.jwt.claim.sub','',true) IS NOT NULL AS cleared_sub;

SELECT pg_catalog.set_config('request.jwt.claims','{"role":"service_role"}',true) IS NOT NULL AS cleared_claims;

SET LOCAL ROLE service_role;

SELECT jsonb_build_object('current_user',current_user,'service_role_bypass_rls',(SELECT rolbypassrls FROM pg_catalog.pg_roles WHERE rolname=current_user),'retained_service_counts',jsonb_build_object('chat_sessions', (SELECT count(*) FROM public.chat_sessions),'chat_messages', (SELECT count(*) FROM public.chat_messages),'messages', (SELECT count(*) FROM public.messages),'session_files', (SELECT count(*) FROM public.session_files),'workflow_steps', (SELECT count(*) FROM public.workflow_steps),'shared_files', (SELECT count(*) FROM public.shared_files))) AS verification;

ROLLBACK;
