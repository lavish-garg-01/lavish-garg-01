import { readFile } from "node:fs/promises";
import { z } from "zod";
import { createDatabase, KyselyStrategyRepository, KyselyAiLedger } from "@job-hunter-v2/database";
import { createConfiguredAi } from "@job-hunter-v2/ai";
import { StrategyIntelligenceService, LifecycleCommandSchema, metrics, opportunity } from "@job-hunter-v2/strategy-intelligence";
import { validateStrategyOffline } from "./strategy-offline.js";

// Operator-only CLI. No candidate-facing admin endpoint; OS/database access is required.
const inputSchema = z.object({ action: z.enum(["INSPECT", "DISCOVER", "VALIDATE", "CANARY", "EVALUATE", "DISABLE", "REJECT", "ROLLBACK", "RETIRE"]),
  cluster: z.string().regex(/^[a-f0-9]{64}$/), key: z.string().optional(), command: LifecycleCommandSchema,
  accountId: z.uuid().optional(), candidateId: z.uuid().optional() }).strict();
const inputPath = process.argv[2];
if (!inputPath) throw new Error("Provide an operator command JSON file; see STRATEGY_INTELLIGENCE.md");
const input = inputSchema.parse(JSON.parse(await readFile(inputPath, "utf8")));
const database = createDatabase({ connectionString: process.env.DATABASE_URL! });
try {
  const repository = new KyselyStrategyRepository(database);
  const service = new StrategyIntelligenceService(repository, process.env.CANDIDATE_VALUE_HMAC_SECRET ?? "",
    createConfiguredAi(process.env, new KyselyAiLedger(database)));
  const state = await repository.read(input.cluster);
  if (!state) throw new Error("Q_CLUSTER_NOT_FOUND");
  let result: unknown;
  if (input.action === "INSPECT") {
    const evidence = await repository.evidence(input.cluster, new Date(Date.now() - 30 * 86400_000).toISOString());
    result = { state, definitions: (await repository.definitions()).filter((d) => Boolean(state.states[d.key])),
      metrics: Object.keys(state.states).map((key) => ({ key, ...metrics(evidence, key), opportunity: opportunity(evidence, key) })) };
  } else if (input.action === "DISCOVER") {
    if (!input.accountId || !input.candidateId) throw new Error("Q_ANALYSIS_SCOPE_REQUIRED");
    result = await service.discover(input.cluster, { accountId: input.accountId, candidateId: input.candidateId }, input.command);
  } else if (input.action === "EVALUATE") result = await service.evaluate(input.cluster, input.command);
  else {
    if (!input.key) throw new Error("Q_STRATEGY_KEY_REQUIRED");
    if (input.action === "VALIDATE") {
      const definition = (await repository.definitions()).find((d) => d.key === input.key);
      if (!definition) throw new Error("Q_STRATEGY_NOT_FOUND");
      // Never import a caller's proof: rerun K + independent browser fixtures for this definition.
      const proof = await validateStrategyOffline(definition, input.command.actorId, service);
      result = await service.approveOffline(input.cluster, input.key, proof, input.command);
    } else if (input.action === "CANARY") result = await service.startCanary(input.cluster, input.key, input.command);
    else result = await service.control(input.cluster, input.key, input.action, input.command);
  }
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
} catch {
  process.stderr.write("Q operator action failed; no private details emitted. Inspect command revision, eligibility and worker status.\n");
  process.exitCode = 1;
} finally { await database.destroy(); }
