# Power Agent owner RLS operations package

This package records the owner-policy repair applied to the Power Agent database on 2026-10-12. It contains the exact deployed SQL, a narrow rollback, metadata inspection and read-only verification queries. It contains no credentials, user identifiers, file contents or private analysis histories. It is a manual operations record, outside the automatic migration directory.

## Exact deployment and scope

`deployed-owner-rls.sql` has SHA-256 `0c4500a8e5c0fe2beb7ffa3365ee9c063806fa0ad82538641effd7647db7aee3`. The original proposal-only comment is retained to preserve the exact applied bytes; the deployment state is recorded in `audit.json`.

The six scoped tables are `chat_sessions`, `chat_messages`, `messages`, `session_files`, `workflow_steps` and `shared_files`. The migration preserves the prior 20 policies, table grants, owners and FORCE flags. It adds a restrictive owner policy for `PUBLIC` and a permissive owner policy for `authenticated` on each table, using the same predicate for `USING` and `WITH CHECK`. The restrictive predicate constrains the existing permissive policies rather than relying on a client filter.

`chat_sessions.user_id` and `shared_files.created_by` are text owner fields compared with `auth.uid()::text`. Each child table is restricted through its `session_id` and an owned `chat_sessions` parent. The actual `messages` table has a `session_id` column without a declared foreign key; unmatched parents are denied by the predicate. `session_files.file_id` and `shared_files.shared_file_id` are the distinct canonical IDs. The Library repair uses `session_files`, not a new `shared_files` write.

The migration is bound to a saved policy/table snapshot. Its preflight rejects changed policies, ACLs, RLS flags or ownership. It is deliberately not idempotent after application and is not an installer for an arbitrary database. Inspect a target's actual schema and policy boundary before adapting it. This document does not authorize applying or rolling back SQL.

## Read-only verification

An authorized database administrator can run the following queries with a connection that may set the relevant local role. Keep results private; the owner/service queries return aggregate production counts. They return no row identifiers or content. The role probes use `BEGIN READ ONLY` and end with `ROLLBACK`; their local role and request-claim settings expire with the transaction.

1. `inspect-owner-rls-readonly.sql` returns only catalog schema/policy metadata for the six tables. Save and compare the policy/table snapshots before and after a repair.
2. `verify-service-counts-readonly.sql` reports all six counts and the active role's BYPASSRLS flag. Compare a pre-change and post-change observation; the flag alone does not prove data retention.
3. `verify-anon-readonly.sql` clears user claims, assumes `anon` and returns all six visible counts. Require `current_user = 'anon'` and `all_private_counts_zero = true`.
4. `verify-owner-outside-owner-readonly.sql` chooses an existing UUID owner with files internally, records admin-visible owned/outside baselines, then assumes `authenticated`. Require the expected role and all four booleans: `owned_baseline_nonzero`, `outside_owner_baseline_nonzero`, `all_owned_counts_retained`, and `all_outside_owner_counts_zero`. Inspect per-table baselines to identify empty-table limitations. This is a role/claim simulation, not proof of JWT authentication or browser behavior.

Each role probe produces one final verification JSON containing all six tables. The Management query endpoint returns the last SELECT result, so use that final JSON rather than separate per-table SELECT statements. No credential loader or Management API helper is included; use the administrator's existing approved tooling without placing secrets in source files or logs.

Also verify a real authenticated session in the web UI. Supabase anonymous-auth users have a UID and use the authenticated role; a request using only the unauthenticated anon key has no user UID. Verify owner history and Library save, reload and reuse separately. Client owner checks and a public scientific transport ticket do not replace database row policies.

## Rollback and qualifications

`rollback-owner-rls.sql` drops only the 12 added named policies. It preserves prior policies and data, but reopens the broad pre-repair row-access boundary. Use it only after an explicit operations decision, inspect the current policies first and verify the resulting boundary. The exact deployed migration was rehearsed in a rollback transaction before application; the saved policy snapshot was unchanged after that rehearsal.

Observed SELECT gates and their attribution are in `audit.json`. The shared-files table was empty, so its zero result is not a nonvacuous cross-owner test. The observed native gate is owner history restoration; a new Library save/reload/reuse gate is recorded separately if performed. No INSERT, UPDATE or DELETE isolation experiment is claimed here.

This repair concerns row DML/Data API isolation on the six named tables. It does not certify TRUNCATE/REFERENCES privileges, RPC/functions, storage buckets, service-role authority, superusers or the security of the entire database. Existing grants and BYPASSRLS behavior were preserved. See the official [Supabase RLS documentation](https://supabase.com/docs/guides/database/postgres/row-level-security) and [PostgreSQL policy documentation](https://www.postgresql.org/docs/current/sql-createpolicy.html) for these policy semantics.

## Offline source checks

`source-manifest.json` lists the exact positive payload allowlist and SHA-256 hashes. Run the package checks from the repository root:

```sh
python3 -m unittest discover -s supabase/owner-rls-20261012 -p 'test_*.py'
```

These checks verify package integrity and bounded source contracts. They perform no database request and do not independently establish live isolation. APP and Public package files must remain byte-identical.
