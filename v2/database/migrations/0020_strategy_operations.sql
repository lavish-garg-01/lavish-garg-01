-- Coalesce pending evaluation, not running work: evidence arriving during a lease gets a new job.
CREATE UNIQUE INDEX q_pending_evaluation ON worker_jobs ((payload_reference->>'cluster'))
 WHERE job_type='Q_STRATEGY' AND payload_reference->>'kind'='EVALUATE' AND status='PENDING';
CREATE INDEX q_jobs_poll ON worker_jobs(job_type,status,available_at);
