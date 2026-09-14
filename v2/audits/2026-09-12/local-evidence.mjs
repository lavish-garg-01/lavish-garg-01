// Only aggregate metadata is read. No decrypted answers, credentials, or page dumps.
import pg from 'pg';
const connection = new URL(process.env.DATABASE_URL);
if (!['127.0.0.1', 'localhost', '[::1]'].includes(connection.hostname)) throw new Error('Audit requires loopback database');
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
try {
  await client.connect();
  await client.query('BEGIN READ ONLY');
  const queries = {
    ai: `SELECT task_type,provider,model_profile,accepted,failure_code,count(*)::int AS events,round(avg(latency_ms)) AS mean_latency_ms,min(created_at) AS first_event,max(created_at) AS last_event FROM ai_usage_events GROUP BY 1,2,3,4,5 ORDER BY events DESC`,
    executions: `SELECT cf.canonical_key,e.execution_status,e.verification_status,e.failure_class,e.representation_id,count(*)::int AS events FROM application_execution_evidence e JOIN canonical_fields cf ON cf.id=e.canonical_id GROUP BY 1,2,3,4,5 ORDER BY events DESC LIMIT 60`,
    observations: `SELECT cf.canonical_key,o.status,o.attribution,count(*)::int AS events FROM candidate_learning_observations o JOIN canonical_fields cf ON cf.id=o.canonical_id GROUP BY 1,2,3 ORDER BY events DESC`,
    checkpoints: `SELECT checkpoint_status,count(*)::int AS receipts,sum(saved_count)::int AS saved,sum(ask_again_count)::int AS ask_again,sum(skipped_count)::int AS skipped,sum(conflict_count)::int AS conflicts,count(*) FILTER(WHERE finalized_at IS NULL)::int AS unfinalized FROM candidate_learning_checkpoint_receipts GROUP BY 1`,
    proposals: `SELECT reason,status,count(*)::int AS pending_descriptors FROM canonical_review_queue GROUP BY 1,2`,
    strategy: `SELECT evidence->>'evidenceKind' AS kind,evidence->>'attribution' AS attribution,evidence->>'feedback' AS feedback,count(*)::int AS events FROM strategy_performance_evidence GROUP BY 1,2,3 ORDER BY events DESC`,
    counts: `SELECT (SELECT count(*)::int FROM applications) AS applications,(SELECT count(*)::int FROM application_runs) AS runs,(SELECT count(*)::int FROM candidate_learning_submit_attempts) AS submit_attempts,(SELECT count(*)::int FROM strategy_execution_bindings) AS bound_operations`
  };
  for (const [name,query] of Object.entries(queries)) {
    const result=await client.query(query); console.log(JSON.stringify({name,rows:result.rows}));
  }
  await client.query('ROLLBACK');
} catch (error) { console.error(JSON.stringify({errorCode:error.code??'AUDIT_READ_FAILED'})); process.exitCode=1; }
finally { await client.end(); }
