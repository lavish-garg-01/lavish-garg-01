-- Phase 0 local-to-Supabase isolation contract.
-- Apply only after the SQLite candidate_id columns are migrated to authenticated
-- Supabase user ids. Backend service-role credentials must never be shipped in
-- the browser extension; candidate traffic uses the authenticated client role.

alter table public.extension_launch_authorizations enable row level security;
alter table public.extension_launch_authorizations force row level security;
alter table public.extension_run_bindings enable row level security;
alter table public.extension_run_bindings force row level security;
alter table public.extension_idempotency_requests enable row level security;
alter table public.extension_idempotency_requests force row level security;
alter table public.extension_telemetry_events enable row level security;
alter table public.extension_telemetry_events force row level security;
alter table public.extension_backend_outbox enable row level security;
alter table public.extension_backend_outbox force row level security;
alter table public.extension_protocol_audit_events enable row level security;
alter table public.extension_protocol_audit_events force row level security;
alter table public.adaptive_evidence_shadow_events enable row level security;
alter table public.adaptive_evidence_shadow_events force row level security;
alter table public.adaptive_evidence_shadow_rollups enable row level security;
alter table public.adaptive_evidence_shadow_rollups force row level security;
alter table public.adaptive_evidence_shadow_recommendations enable row level security;
alter table public.adaptive_evidence_shadow_recommendations force row level security;

create policy extension_launch_select_own on public.extension_launch_authorizations
for select using (candidate_id = auth.uid()::text);
create policy extension_launch_insert_own on public.extension_launch_authorizations
for insert with check (candidate_id = auth.uid()::text);
create policy extension_launch_update_own on public.extension_launch_authorizations
for update using (candidate_id = auth.uid()::text) with check (candidate_id = auth.uid()::text);
create policy extension_launch_delete_own on public.extension_launch_authorizations
for delete using (candidate_id = auth.uid()::text);

create policy extension_binding_select_own on public.extension_run_bindings
for select using (candidate_id = auth.uid()::text);
create policy extension_binding_insert_own on public.extension_run_bindings
for insert with check (candidate_id = auth.uid()::text);
create policy extension_binding_update_own on public.extension_run_bindings
for update using (candidate_id = auth.uid()::text) with check (candidate_id = auth.uid()::text);
create policy extension_binding_delete_own on public.extension_run_bindings
for delete using (candidate_id = auth.uid()::text);

create policy extension_idempotency_select_own on public.extension_idempotency_requests
for select using (candidate_id = auth.uid()::text);
create policy extension_idempotency_insert_own on public.extension_idempotency_requests
for insert with check (candidate_id = auth.uid()::text);
create policy extension_idempotency_update_own on public.extension_idempotency_requests
for update using (candidate_id = auth.uid()::text) with check (candidate_id = auth.uid()::text);
create policy extension_idempotency_delete_own on public.extension_idempotency_requests
for delete using (candidate_id = auth.uid()::text);

create policy extension_telemetry_select_own on public.extension_telemetry_events
for select using (candidate_id = auth.uid()::text);
create policy extension_telemetry_insert_own on public.extension_telemetry_events
for insert with check (candidate_id = auth.uid()::text);
create policy extension_telemetry_update_own on public.extension_telemetry_events
for update using (candidate_id = auth.uid()::text) with check (candidate_id = auth.uid()::text);
create policy extension_telemetry_delete_own on public.extension_telemetry_events
for delete using (candidate_id = auth.uid()::text);

-- Backend outbox and audit mutations are service-only. Candidates may inspect
-- their own records but cannot insert/update/delete them directly.
create policy extension_outbox_select_own on public.extension_backend_outbox
for select using (candidate_id = auth.uid()::text);
create policy extension_audit_select_own on public.extension_protocol_audit_events
for select using (candidate_id = auth.uid()::text);

-- Raw SHADOW evidence remains candidate-private and append-only. Shared
-- rollups/recommendations are service-generated redacted aggregates, so no
-- candidate mutation policy is granted for those tables.
create policy adaptive_evidence_select_own on public.adaptive_evidence_shadow_events
for select using (candidate_id = auth.uid()::text);
create policy adaptive_evidence_insert_own on public.adaptive_evidence_shadow_events
for insert with check (candidate_id = auth.uid()::text);
create policy adaptive_evidence_delete_own on public.adaptive_evidence_shadow_events
for delete using (candidate_id = auth.uid()::text);

-- Private storage objects use the candidate id as the first path component.
create policy job_hunter_private_storage_select on storage.objects
for select using (bucket_id = 'job-hunter-private' and (storage.foldername(name))[1] = auth.uid()::text);
create policy job_hunter_private_storage_insert on storage.objects
for insert with check (bucket_id = 'job-hunter-private' and (storage.foldername(name))[1] = auth.uid()::text);
create policy job_hunter_private_storage_update on storage.objects
for update using (bucket_id = 'job-hunter-private' and (storage.foldername(name))[1] = auth.uid()::text)
with check (bucket_id = 'job-hunter-private' and (storage.foldername(name))[1] = auth.uid()::text);
create policy job_hunter_private_storage_delete on storage.objects
for delete using (bucket_id = 'job-hunter-private' and (storage.foldername(name))[1] = auth.uid()::text);
