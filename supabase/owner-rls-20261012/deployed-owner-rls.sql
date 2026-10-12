-- PROPOSAL ONLY. Root must inspect and explicitly execute this exact candidate.

-- Existing policies, grants, FORCE flags and rows are preserved.

BEGIN;

SET LOCAL lock_timeout = '5s';

SET LOCAL statement_timeout = '30s';

LOCK TABLE public.chat_sessions, public.chat_messages, public.messages, public.session_files, public.workflow_steps, public.shared_files IN SHARE ROW EXCLUSIVE MODE;

DO $preflight$
DECLARE actual jsonb;
BEGIN
  SELECT coalesce(jsonb_agg(jsonb_build_object('schema',schemaname,'table',tablename,'name',policyname,'permissive',permissive,'roles',roles,'command',cmd,'using',qual,'with_check',with_check) ORDER BY tablename,policyname),'[]'::jsonb) INTO actual
 FROM pg_catalog.pg_policies WHERE schemaname='public' AND tablename IN ('chat_sessions','chat_messages','messages','session_files','workflow_steps','shared_files');
  IF actual IS DISTINCT FROM '[{"command": "ALL", "name": "Allow all operations on chat_messages", "permissive": "PERMISSIVE", "roles": ["public"], "schema": "public", "table": "chat_messages", "using": "true", "with_check": "true"}, {"command": "DELETE", "name": "Allow anonymous delete to chat_messages", "permissive": "PERMISSIVE", "roles": ["anon"], "schema": "public", "table": "chat_messages", "using": "true", "with_check": null}, {"command": "INSERT", "name": "Allow anonymous insert to chat_messages", "permissive": "PERMISSIVE", "roles": ["anon"], "schema": "public", "table": "chat_messages", "using": null, "with_check": "true"}, {"command": "SELECT", "name": "Allow anonymous read access to chat_messages", "permissive": "PERMISSIVE", "roles": ["anon"], "schema": "public", "table": "chat_messages", "using": "true", "with_check": null}, {"command": "UPDATE", "name": "Allow anonymous update to chat_messages", "permissive": "PERMISSIVE", "roles": ["anon"], "schema": "public", "table": "chat_messages", "using": "true", "with_check": "true"}, {"command": "ALL", "name": "Allow all operations on chat_sessions", "permissive": "PERMISSIVE", "roles": ["public"], "schema": "public", "table": "chat_sessions", "using": "true", "with_check": "true"}, {"command": "DELETE", "name": "Allow anonymous delete to chat_sessions", "permissive": "PERMISSIVE", "roles": ["anon"], "schema": "public", "table": "chat_sessions", "using": "true", "with_check": null}, {"command": "INSERT", "name": "Allow anonymous insert to chat_sessions", "permissive": "PERMISSIVE", "roles": ["anon"], "schema": "public", "table": "chat_sessions", "using": null, "with_check": "true"}, {"command": "SELECT", "name": "Allow anonymous read access to chat_sessions", "permissive": "PERMISSIVE", "roles": ["anon"], "schema": "public", "table": "chat_sessions", "using": "true", "with_check": null}, {"command": "UPDATE", "name": "Allow anonymous update to chat_sessions", "permissive": "PERMISSIVE", "roles": ["anon"], "schema": "public", "table": "chat_sessions", "using": "true", "with_check": "true"}, {"command": "ALL", "name": "Enable all operations for service role", "permissive": "PERMISSIVE", "roles": ["public"], "schema": "public", "table": "messages", "using": "true", "with_check": "true"}, {"command": "INSERT", "name": "Enable insert for anon", "permissive": "PERMISSIVE", "roles": ["public"], "schema": "public", "table": "messages", "using": null, "with_check": "true"}, {"command": "SELECT", "name": "Enable read for anon", "permissive": "PERMISSIVE", "roles": ["public"], "schema": "public", "table": "messages", "using": "true", "with_check": null}, {"command": "ALL", "name": "Allow all operations on session_files", "permissive": "PERMISSIVE", "roles": ["public"], "schema": "public", "table": "session_files", "using": "true", "with_check": "true"}, {"command": "ALL", "name": "Allow all operations on shared_files", "permissive": "PERMISSIVE", "roles": ["public"], "schema": "public", "table": "shared_files", "using": "true", "with_check": "true"}, {"command": "ALL", "name": "Allow all operations on workflow_steps", "permissive": "PERMISSIVE", "roles": ["public"], "schema": "public", "table": "workflow_steps", "using": "true", "with_check": "true"}, {"command": "DELETE", "name": "Allow anonymous delete to workflow_steps", "permissive": "PERMISSIVE", "roles": ["anon"], "schema": "public", "table": "workflow_steps", "using": "true", "with_check": null}, {"command": "INSERT", "name": "Allow anonymous insert to workflow_steps", "permissive": "PERMISSIVE", "roles": ["anon"], "schema": "public", "table": "workflow_steps", "using": null, "with_check": "true"}, {"command": "SELECT", "name": "Allow anonymous read access to workflow_steps", "permissive": "PERMISSIVE", "roles": ["anon"], "schema": "public", "table": "workflow_steps", "using": "true", "with_check": null}, {"command": "UPDATE", "name": "Allow anonymous update to workflow_steps", "permissive": "PERMISSIVE", "roles": ["anon"], "schema": "public", "table": "workflow_steps", "using": "true", "with_check": "true"}]'::jsonb THEN
    RAISE EXCEPTION 'Policies changed since the saved snapshot; stop and re-inspect';
  END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('schema',n.nspname,'name',c.relname,'kind',c.relkind,'rls_enabled',c.relrowsecurity,'rls_forced',c.relforcerowsecurity,'owner',pg_catalog.pg_get_userbyid(c.relowner),'ACL',c.relacl::text,'options',c.reloptions) ORDER BY c.relname),'[]'::jsonb) INTO actual
 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relname IN ('chat_sessions','chat_messages','messages','session_files','workflow_steps','shared_files');
  IF actual IS DISTINCT FROM '[{"ACL": "{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}", "kind": "r", "name": "chat_messages", "options": null, "owner": "postgres", "rls_enabled": true, "rls_forced": false, "schema": "public"}, {"ACL": "{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}", "kind": "r", "name": "chat_sessions", "options": null, "owner": "postgres", "rls_enabled": true, "rls_forced": false, "schema": "public"}, {"ACL": "{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}", "kind": "r", "name": "messages", "options": null, "owner": "postgres", "rls_enabled": true, "rls_forced": false, "schema": "public"}, {"ACL": "{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}", "kind": "r", "name": "session_files", "options": null, "owner": "postgres", "rls_enabled": true, "rls_forced": false, "schema": "public"}, {"ACL": "{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}", "kind": "r", "name": "shared_files", "options": null, "owner": "postgres", "rls_enabled": true, "rls_forced": false, "schema": "public"}, {"ACL": "{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}", "kind": "r", "name": "workflow_steps", "options": null, "owner": "postgres", "rls_enabled": true, "rls_forced": false, "schema": "public"}]'::jsonb THEN
    RAISE EXCEPTION 'Table RLS/ACL/ownership changed; stop and re-inspect';
  END IF;
END
$preflight$;

ALTER TABLE public.chat_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY pa_owner_restrictive_20261012 ON public.chat_sessions AS RESTRICTIVE FOR ALL TO PUBLIC
  USING ((SELECT auth.uid()) IS NOT NULL AND user_id = (SELECT auth.uid())::text) WITH CHECK ((SELECT auth.uid()) IS NOT NULL AND user_id = (SELECT auth.uid())::text);

CREATE POLICY pa_owner_permissive_20261012 ON public.chat_sessions AS PERMISSIVE FOR ALL TO authenticated
  USING ((SELECT auth.uid()) IS NOT NULL AND user_id = (SELECT auth.uid())::text) WITH CHECK ((SELECT auth.uid()) IS NOT NULL AND user_id = (SELECT auth.uid())::text);

ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY pa_owner_restrictive_20261012 ON public.chat_messages AS RESTRICTIVE FOR ALL TO PUBLIC
  USING ((SELECT auth.uid()) IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.chat_sessions AS owner_session
    WHERE owner_session.session_id = chat_messages.session_id
      AND owner_session.user_id = (SELECT auth.uid())::text
  )) WITH CHECK ((SELECT auth.uid()) IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.chat_sessions AS owner_session
    WHERE owner_session.session_id = chat_messages.session_id
      AND owner_session.user_id = (SELECT auth.uid())::text
  ));

CREATE POLICY pa_owner_permissive_20261012 ON public.chat_messages AS PERMISSIVE FOR ALL TO authenticated
  USING ((SELECT auth.uid()) IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.chat_sessions AS owner_session
    WHERE owner_session.session_id = chat_messages.session_id
      AND owner_session.user_id = (SELECT auth.uid())::text
  )) WITH CHECK ((SELECT auth.uid()) IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.chat_sessions AS owner_session
    WHERE owner_session.session_id = chat_messages.session_id
      AND owner_session.user_id = (SELECT auth.uid())::text
  ));

ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY pa_owner_restrictive_20261012 ON public.messages AS RESTRICTIVE FOR ALL TO PUBLIC
  USING ((SELECT auth.uid()) IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.chat_sessions AS owner_session
    WHERE owner_session.session_id = messages.session_id
      AND owner_session.user_id = (SELECT auth.uid())::text
  )) WITH CHECK ((SELECT auth.uid()) IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.chat_sessions AS owner_session
    WHERE owner_session.session_id = messages.session_id
      AND owner_session.user_id = (SELECT auth.uid())::text
  ));

CREATE POLICY pa_owner_permissive_20261012 ON public.messages AS PERMISSIVE FOR ALL TO authenticated
  USING ((SELECT auth.uid()) IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.chat_sessions AS owner_session
    WHERE owner_session.session_id = messages.session_id
      AND owner_session.user_id = (SELECT auth.uid())::text
  )) WITH CHECK ((SELECT auth.uid()) IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.chat_sessions AS owner_session
    WHERE owner_session.session_id = messages.session_id
      AND owner_session.user_id = (SELECT auth.uid())::text
  ));

ALTER TABLE public.session_files ENABLE ROW LEVEL SECURITY;

CREATE POLICY pa_owner_restrictive_20261012 ON public.session_files AS RESTRICTIVE FOR ALL TO PUBLIC
  USING ((SELECT auth.uid()) IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.chat_sessions AS owner_session
    WHERE owner_session.session_id = session_files.session_id
      AND owner_session.user_id = (SELECT auth.uid())::text
  )) WITH CHECK ((SELECT auth.uid()) IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.chat_sessions AS owner_session
    WHERE owner_session.session_id = session_files.session_id
      AND owner_session.user_id = (SELECT auth.uid())::text
  ));

CREATE POLICY pa_owner_permissive_20261012 ON public.session_files AS PERMISSIVE FOR ALL TO authenticated
  USING ((SELECT auth.uid()) IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.chat_sessions AS owner_session
    WHERE owner_session.session_id = session_files.session_id
      AND owner_session.user_id = (SELECT auth.uid())::text
  )) WITH CHECK ((SELECT auth.uid()) IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.chat_sessions AS owner_session
    WHERE owner_session.session_id = session_files.session_id
      AND owner_session.user_id = (SELECT auth.uid())::text
  ));

ALTER TABLE public.workflow_steps ENABLE ROW LEVEL SECURITY;

CREATE POLICY pa_owner_restrictive_20261012 ON public.workflow_steps AS RESTRICTIVE FOR ALL TO PUBLIC
  USING ((SELECT auth.uid()) IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.chat_sessions AS owner_session
    WHERE owner_session.session_id = workflow_steps.session_id
      AND owner_session.user_id = (SELECT auth.uid())::text
  )) WITH CHECK ((SELECT auth.uid()) IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.chat_sessions AS owner_session
    WHERE owner_session.session_id = workflow_steps.session_id
      AND owner_session.user_id = (SELECT auth.uid())::text
  ));

CREATE POLICY pa_owner_permissive_20261012 ON public.workflow_steps AS PERMISSIVE FOR ALL TO authenticated
  USING ((SELECT auth.uid()) IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.chat_sessions AS owner_session
    WHERE owner_session.session_id = workflow_steps.session_id
      AND owner_session.user_id = (SELECT auth.uid())::text
  )) WITH CHECK ((SELECT auth.uid()) IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.chat_sessions AS owner_session
    WHERE owner_session.session_id = workflow_steps.session_id
      AND owner_session.user_id = (SELECT auth.uid())::text
  ));

ALTER TABLE public.shared_files ENABLE ROW LEVEL SECURITY;

CREATE POLICY pa_owner_restrictive_20261012 ON public.shared_files AS RESTRICTIVE FOR ALL TO PUBLIC
  USING ((SELECT auth.uid()) IS NOT NULL AND created_by = (SELECT auth.uid())::text) WITH CHECK ((SELECT auth.uid()) IS NOT NULL AND created_by = (SELECT auth.uid())::text);

CREATE POLICY pa_owner_permissive_20261012 ON public.shared_files AS PERMISSIVE FOR ALL TO authenticated
  USING ((SELECT auth.uid()) IS NOT NULL AND created_by = (SELECT auth.uid())::text) WITH CHECK ((SELECT auth.uid()) IS NOT NULL AND created_by = (SELECT auth.uid())::text);

COMMIT;
