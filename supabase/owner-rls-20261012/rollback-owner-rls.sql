-- Restore the prior policy boundary; this reopens the known broad pre-repair access.

-- Root-reviewed emergency rollback only. No existing policy or data is removed.

BEGIN;

DROP POLICY IF EXISTS pa_owner_restrictive_20261012 ON public.chat_sessions;

DROP POLICY IF EXISTS pa_owner_permissive_20261012 ON public.chat_sessions;

DROP POLICY IF EXISTS pa_owner_restrictive_20261012 ON public.chat_messages;

DROP POLICY IF EXISTS pa_owner_permissive_20261012 ON public.chat_messages;

DROP POLICY IF EXISTS pa_owner_restrictive_20261012 ON public.messages;

DROP POLICY IF EXISTS pa_owner_permissive_20261012 ON public.messages;

DROP POLICY IF EXISTS pa_owner_restrictive_20261012 ON public.session_files;

DROP POLICY IF EXISTS pa_owner_permissive_20261012 ON public.session_files;

DROP POLICY IF EXISTS pa_owner_restrictive_20261012 ON public.workflow_steps;

DROP POLICY IF EXISTS pa_owner_permissive_20261012 ON public.workflow_steps;

DROP POLICY IF EXISTS pa_owner_restrictive_20261012 ON public.shared_files;

DROP POLICY IF EXISTS pa_owner_permissive_20261012 ON public.shared_files;

COMMIT;
