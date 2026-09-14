import type { StrategyIntelligenceService } from "@job-hunter-v2/strategy-intelligence";
import type { StrategyJobQueue, StrategyJobSchema } from "@job-hunter-v2/database";
import type { z } from "zod";
import type { StrategyReceiptBridge } from "./strategy-bridges.js";
import type { KyselyStrategyRepository } from "@job-hunter-v2/database";

const workerActor = "00000000-0000-4000-8000-000000000051";
export class StrategyWorker {
  constructor(private readonly queue: StrategyJobQueue, private readonly receipts: StrategyReceiptBridge,
    private readonly intelligence: StrategyIntelligenceService, private readonly repository: KyselyStrategyRepository) {}
  async runOne() { return this.queue.runOne((job, id) => this.handle(job, id)); }
  async handle(job: z.infer<typeof StrategyJobSchema>, id: string) {
    if (job.kind === "INGEST") return this.receipts.record({ accountId: job.accountId, candidateId: job.candidateId }, job.receipt);
    if (job.kind === "FEEDBACK") return this.repository.recordFeedback(job);
    const state = await this.intelligence.repository.read(job.cluster);
    if (!state) throw new Error("Q_CLUSTER_NOT_FOUND");
    // OCC conflicts retry through the durable lease; never unobserved background promises.
    const updated = await this.intelligence.evaluate(job.cluster, { idempotencyKey: `job:${id}:${state.revision}`,
      expectedRevision: state.revision, actorId: workerActor, reason: "EVIDENCE_EVALUATION" });
    // One open proposal at a time, no AI on the autofill path, and no automatic review approval.
    if (!Object.values(updated.states).some((s) => s === "CANDIDATE" || s === "CANARY")) {
      const events = await this.intelligence.repository.evidence(job.cluster, new Date(Date.now() - 7 * 86400_000).toISOString());
      const scope = events[0];
      if (scope) await this.intelligence.discover(job.cluster, { accountId: scope.accountId, candidateId: scope.candidateId }, { idempotencyKey: `discover:${id}:${updated.revision}`,
        expectedRevision: updated.revision, actorId: workerActor, reason: "EVIDENCE_EVALUATION" });
    }
  }
  async run(signal: AbortSignal) {
    while (!signal.aborted) {
      let processed = false;
      try { processed = await this.runOne(); } catch { /* Database outage: retry polling, durable jobs remain. */ }
      if (!processed) await new Promise<void>((resolve) => {
        const done = () => { clearTimeout(timer); signal.removeEventListener("abort", done); resolve(); };
        const timer = setTimeout(done, 1000); signal.addEventListener("abort", done, { once: true });
        if (signal.aborted) done();
      });
    }
  }
}
