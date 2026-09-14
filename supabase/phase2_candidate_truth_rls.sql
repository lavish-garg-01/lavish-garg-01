-- Future Supabase boundary for Part 2 candidate truth.
-- Apply only after these SQLite tables have Postgres equivalents and user_id
-- is populated from authenticated Supabase users. All mutations remain behind
-- server functions/service-role code; never ship service credentials to clients.

alter table public.candidate_answer_versions enable row level security;
alter table public.candidate_answer_versions force row level security;
alter table public.candidate_answer_write_receipts enable row level security;
alter table public.candidate_answer_write_receipts force row level security;
alter table public.candidate_answer_dependency_events enable row level security;
alter table public.candidate_answer_dependency_events force row level security;
alter table public.candidate_answer_migration_runs enable row level security;
alter table public.candidate_answer_migration_runs force row level security;
alter table public.candidate_answer_migration_items enable row level security;
alter table public.candidate_answer_migration_items force row level security;
alter table public.candidate_answer_resolution_parity_events enable row level security;
alter table public.candidate_answer_resolution_parity_events force row level security;
alter table public.candidate_answer_resolver_mode_history enable row level security;
alter table public.candidate_answer_resolver_mode_history force row level security;
alter table public.candidate_answer_change_sets enable row level security;
alter table public.candidate_answer_change_sets force row level security;
alter table public.candidate_answer_change_set_items enable row level security;
alter table public.candidate_answer_change_set_items force row level security;
alter table public.candidate_answer_change_set_receipts enable row level security;
alter table public.candidate_answer_change_set_receipts force row level security;
alter table public.candidate_answer_reversal_sets enable row level security;
alter table public.candidate_answer_reversal_sets force row level security;
alter table public.candidate_answer_reversal_items enable row level security;
alter table public.candidate_answer_reversal_items force row level security;
alter table public.candidate_answer_reversal_receipts enable row level security;
alter table public.candidate_answer_reversal_receipts force row level security;
alter table public.candidate_answer_runtime_proposals enable row level security;
alter table public.candidate_answer_runtime_proposals force row level security;

create policy candidate_answer_versions_select_own on public.candidate_answer_versions
for select using (user_id = auth.uid()::text);
create policy candidate_answer_write_receipts_select_own on public.candidate_answer_write_receipts
for select using (user_id = auth.uid()::text);
create policy candidate_answer_dependency_events_select_own on public.candidate_answer_dependency_events
for select using (user_id = auth.uid()::text);
create policy candidate_answer_migration_runs_select_own on public.candidate_answer_migration_runs
for select using (user_id = auth.uid()::text);
create policy candidate_answer_migration_items_select_own on public.candidate_answer_migration_items
for select using (user_id = auth.uid()::text);
create policy candidate_answer_resolution_parity_select_own on public.candidate_answer_resolution_parity_events
for select using (user_id = auth.uid()::text);
create policy candidate_answer_change_sets_select_own on public.candidate_answer_change_sets
for select using (user_id = auth.uid()::text);
create policy candidate_answer_change_set_items_select_own on public.candidate_answer_change_set_items
for select using (exists (
    select 1 from public.candidate_answer_change_sets change_set
    where change_set.id = candidate_answer_change_set_items.change_set_id
      and change_set.user_id = auth.uid()::text
));
create policy candidate_answer_change_set_receipts_select_own on public.candidate_answer_change_set_receipts
for select using (user_id = auth.uid()::text);
create policy candidate_answer_reversal_sets_select_own on public.candidate_answer_reversal_sets
for select using (user_id = auth.uid()::text);
create policy candidate_answer_reversal_items_select_own on public.candidate_answer_reversal_items
for select using (exists (
    select 1 from public.candidate_answer_reversal_sets reversal_set
    where reversal_set.id = candidate_answer_reversal_items.reversal_set_id
      and reversal_set.user_id = auth.uid()::text
));
create policy candidate_answer_reversal_receipts_select_own on public.candidate_answer_reversal_receipts
for select using (user_id = auth.uid()::text);
create policy candidate_answer_runtime_proposals_select_own on public.candidate_answer_runtime_proposals
for select using (user_id = auth.uid()::text);

-- Resolver mode history is operational configuration. It intentionally has no
-- client policy; only server/service-role and role-verified admin code may read
-- or mutate it.

-- Policy and controlled-context registries contain configuration only. They
-- carry no candidate values and are readable by authenticated users; all
-- inserts, updates and deletes remain service/admin-only.
alter table public.canonical_answer_policies enable row level security;
alter table public.canonical_answer_policies force row level security;
alter table public.canonical_answer_policy_active enable row level security;
alter table public.canonical_answer_policy_active force row level security;
alter table public.answer_context_registry enable row level security;
alter table public.answer_context_registry force row level security;
alter table public.employer_entity_groups enable row level security;
alter table public.employer_entity_groups force row level security;
alter table public.employer_entities enable row level security;
alter table public.employer_entities force row level security;

create policy canonical_answer_policies_read_authenticated on public.canonical_answer_policies
for select to authenticated using (true);
create policy canonical_answer_policy_active_read_authenticated on public.canonical_answer_policy_active
for select to authenticated using (true);
create policy answer_context_registry_read_authenticated on public.answer_context_registry
for select to authenticated using (true);
create policy employer_entity_groups_read_authenticated on public.employer_entity_groups
for select to authenticated using (true);
create policy employer_entities_read_authenticated on public.employer_entities
for select to authenticated using (true);
