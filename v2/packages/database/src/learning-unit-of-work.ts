import { CandidateTruthService, type CandidateValueFingerprinter } from "@job-hunter-v2/candidate-truth";
import type { LearningCheckpointUnitOfWork } from "@job-hunter-v2/verified-learning";
import type { Kysely } from "kysely";
import { KyselyCandidateTruthRepository, type V2Database } from "./index.js";
import { KyselyVerifiedLearningRepository } from "./verified-learning-repository.js";
import { inTransaction } from "./transaction-scope.js";

export function learningCheckpointUnitOfWork(database: Kysely<V2Database>, fingerprinter: CandidateValueFingerprinter, strategyEvidenceEnabled = false): LearningCheckpointUnitOfWork {
  return (work) => inTransaction(database, (transaction) => work(
    new KyselyVerifiedLearningRepository(transaction, undefined, strategyEvidenceEnabled),
    new CandidateTruthService(new KyselyCandidateTruthRepository(transaction), fingerprinter)
  ));
}
