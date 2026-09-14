import { IdentityService, OidcJwtIdentityVerifier, type IdentityTokenVerifier } from "@job-hunter-v2/auth";
import { OperatorTokenVerifier } from "@job-hunter-v2/auth";
import { OperatorReviewRepository, SupportReviewRepository, ReviewedExportRepository, assertReviewDatabaseRole } from "@job-hunter-v2/database";
import { createConfiguredAi } from "@job-hunter-v2/ai";
import { fieldAiBridge, entityAiBridge, OrchestratedResumeCandidateExtractor } from "./ai-bridges.js";
import { CandidateDocumentGenerationContext, OrchestratedGeneratedDocumentPort } from "./document-generation-bridges.js";
import { CandidateTruthResolver, CandidateTruthService, HmacCandidateValueFingerprinter } from "@job-hunter-v2/candidate-truth";
import { FieldIntelligenceService, FieldSemanticResolver } from "@job-hunter-v2/field-intelligence";
import { ExecutionPlanningService } from "@job-hunter-v2/execution";
import { KyselyStrategyRepository, StrategyJobQueue } from "@job-hunter-v2/database";
import { StrategyWorker } from "./strategy-worker.js";
import { StrategyIntelligenceService } from "@job-hunter-v2/strategy-intelligence";
import { StrategyPlanningBridge, StrategyReceiptBridge } from "./strategy-bridges.js";
import { DeclarationPolicyEngine, DeclarationPolicyService } from "@job-hunter-v2/declaration-policy";
import {
  KyselyCandidateBootstrapRepository,
  KyselyCandidateConfirmationRepository,
  KyselyCandidateProfileRepository,
  KyselyCandidateSearchProfileRepository,
  KyselyCandidateTruthRepository,
  KyselyIdentityRepository,
  KyselyJobCatalogRepository,
  KyselyResumeRepository,
  KyselyVerifiedLearningRepository,
  learningCheckpointUnitOfWork,
  KyselyLearningRecovery,
  KyselyRepeatableEntityRepository,
  KyselyDeclarationEvidenceRepository,
  KyselyAiLedger,
  KyselyCanonicalReviewRepository,
  KyselyDocumentIntelligenceRepository,
  KyselyDocumentGenerationRepository,
  KyselyApplicationDocumentRepository,
  createDatabase
} from "@job-hunter-v2/database";
import {
  AesGcmCandidatePayloadCipher,
  CandidateConfirmationService,
  CandidateProfileService,
  CandidateSessionService,
  FileSystemObjectStorage,
  PdfJsResumeTextExtractor,
  ResumeOnboardingService,
  DocumentIntelligenceService,
  DocumentGenerationService,
  ApplicationDocumentService
} from "@job-hunter-v2/onboarding";
import {
  CandidateSearchProfileService,
  JobDiscoveryService,
  candidateJobFactsFromTruth
} from "@job-hunter-v2/job-intelligence";
import { VerifiedLearningService } from "@job-hunter-v2/verified-learning";
import { RepeatableEntityIntelligenceService } from "@job-hunter-v2/repeatable-entities";
import { createApi } from "./app.js";
import { allowedWebOrigins, readApiConfig } from "./config.js";
import { createDevelopmentIdentityVerifier } from "./development-auth.js";
import { assertSupportedNodeRuntime } from "./runtime.js";
import { AdminAuth } from "./admin-auth.js";
import { AdminWorkspace } from "./admin-workspace.js";
import { AdminRepresentationResolver } from "./admin-runtime.js";

assertSupportedNodeRuntime();
const config = readApiConfig();
const database = config.DATABASE_URL
  ? createDatabase({ connectionString: config.DATABASE_URL })
  : null;
const operatorDatabase=config.ENABLE_OPERATOR_REVIEW&&config.OPERATOR_DATABASE_URL?createDatabase({connectionString:config.OPERATOR_DATABASE_URL}):null;
if(operatorDatabase) {
  try{await assertReviewDatabaseRole(operatorDatabase,"runtime");}
  catch(error){await operatorDatabase.destroy();await database?.destroy();throw error;}
}
const ai = createConfiguredAi(process.env, database ? new KyselyAiLedger(database) : undefined);
const fingerprinter = config.CANDIDATE_VALUE_HMAC_SECRET
  ? new HmacCandidateValueFingerprinter(config.CANDIDATE_VALUE_HMAC_SECRET, config.CANDIDATE_VALUE_HMAC_KEY_VERSION, config.CANDIDATE_VALUE_HMAC_PREVIOUS_KEYS)
  : null;
const candidateTruthRepository = database ? new KyselyCandidateTruthRepository(database) : null;
const truth = candidateTruthRepository && fingerprinter
  ? new CandidateTruthService(candidateTruthRepository, fingerprinter)
  : null;
const documentStorage = new FileSystemObjectStorage(config.RESUME_STORAGE_ROOT);
const resumes = database && fingerprinter && config.RESUME_PROPOSAL_ENCRYPTION_KEY
  ? new ResumeOnboardingService(
      new KyselyResumeRepository(database),
      documentStorage,
      new PdfJsResumeTextExtractor(),
      new OrchestratedResumeCandidateExtractor(ai, process.env.AI_RESUME_ENABLED === "true"),
      new AesGcmCandidatePayloadCipher(Buffer.from(config.RESUME_PROPOSAL_ENCRYPTION_KEY, "base64"), 1),
      fingerprinter
    )
  : null;
const documents = database
  ? new DocumentIntelligenceService(new KyselyDocumentIntelligenceRepository(database), documentStorage)
  : null;
const applicationDocuments = database
  ? new ApplicationDocumentService(new KyselyApplicationDocumentRepository(database), documentStorage)
  : null;
const identityVerifier: IdentityTokenVerifier | null = config.ENABLE_DEV_AUTH && config.DEV_AUTH_TOKEN
  ? createDevelopmentIdentityVerifier(config.DEV_AUTH_TOKEN, config.DEV_AUTH_EMAIL)
  : config.OIDC_PROVIDER && config.OIDC_ISSUER && config.OIDC_AUDIENCE && config.OIDC_JWKS_URL
    ? new OidcJwtIdentityVerifier({
        provider: config.OIDC_PROVIDER,
        issuer: config.OIDC_ISSUER,
        audience: config.OIDC_AUDIENCE,
        jwksUrl: new URL(config.OIDC_JWKS_URL)
      })
    : null;
const sessions = database && identityVerifier && config.CANDIDATE_VALUE_HMAC_SECRET && fingerprinter && truth
    ? new CandidateSessionService(
          identityVerifier,
          new IdentityService(new KyselyIdentityRepository(database)),
          truth,
          new KyselyCandidateBootstrapRepository(database)
        )
    : null;
const confirmations = database && resumes && truth && fingerprinter
  ? new CandidateConfirmationService(
          resumes,
          truth,
          new KyselyCandidateConfirmationRepository(database),
          fingerprinter
        )
  : null;
const profiles = database && truth
  ? new CandidateProfileService(
          new KyselyCandidateProfileRepository(database),
          truth,
          new KyselyCandidateConfirmationRepository(database)
        )
  : null;
const searchProfiles = database ? new CandidateSearchProfileService(new KyselyCandidateSearchProfileRepository(database)) : null;
const jobCatalog = database ? new KyselyJobCatalogRepository(database) : null;
const generation = database && profiles && jobCatalog
  ? new DocumentGenerationService(
      new KyselyDocumentGenerationRepository(database),
      new CandidateDocumentGenerationContext(profiles, new KyselyDocumentIntelligenceRepository(database), jobCatalog),
      new OrchestratedGeneratedDocumentPort(ai, process.env.AI_DOCUMENT_GENERATION_ENABLED === "true"),
      documentStorage
    )
  : null;
const discovery = jobCatalog && profiles && searchProfiles
  ? new JobDiscoveryService(
      jobCatalog,
      {
        getCandidateJobProfile: async (accountId, candidateId) => {
          const [snapshot, search] = await Promise.all([
            profiles.get(accountId, candidateId),
            searchProfiles.get(accountId, candidateId)
          ]);
          return {
            preferences: search.preferences,
            facts: candidateJobFactsFromTruth(snapshot.answers.map((answer) => ({
              canonicalKey: answer.canonicalKey,
              normalizedValue: answer.normalizedValue,
              scope: answer.scope,
              trustState: answer.trustState
            })))
          };
        }
      }
    )
  : null;
const phaseG = sessions && resumes && confirmations && profiles && documents
  ? { sessions, resumes, confirmations, profiles, documents, ...(generation ? { generation } : {}) }
  : undefined;
const phaseH = sessions && discovery && searchProfiles
  ? { sessions, discovery, searchProfiles }
  : undefined;
const repeatableEntities = database ? new RepeatableEntityIntelligenceService(new KyselyRepeatableEntityRepository(database), entityAiBridge(ai)) : null;
const fieldIntelligence = candidateTruthRepository
  ? new FieldIntelligenceService(
      new FieldSemanticResolver(fieldAiBridge(ai)),
      new CandidateTruthResolver(candidateTruthRepository),
      jobCatalog ? {
        find: async (jobId: string) => {
          const job = await jobCatalog.findById(jobId);
          return job ? {
            jobId: job.jobId,
            companyId: job.companyId,
            countryCode: job.countryCodes[0] ?? job.remoteCountryCodes[0] ?? null,
            roleFamily: job.roleFamily,
            ats: job.ats
          } : null;
        }
      } : null,
      undefined,
      8,
      repeatableEntities
    )
  : null;
const phaseJ = sessions && fieldIntelligence ? { sessions, intelligence: fieldIntelligence, ...(database ? { canonicalReviews: new KyselyCanonicalReviewRepository(database) } : {}) } : undefined;
const declarations = database
  ? new DeclarationPolicyService(new DeclarationPolicyEngine(), new KyselyDeclarationEvidenceRepository(database))
  : null;
// Q observes by default; candidate exposure still requires offline validation and reviewer approval.
// Migrations must run before startup. Explicit false is the operational opt-out.
const strategyRepository = database && process.env.STRATEGY_INTELLIGENCE_ENABLED !== "false" ? new KyselyStrategyRepository(database) : null;
const strategyIntelligence = strategyRepository && process.env.CANDIDATE_VALUE_HMAC_SECRET
  ? new StrategyIntelligenceService(strategyRepository, process.env.CANDIDATE_VALUE_HMAC_SECRET, ai) : null;
if (strategyIntelligence) await strategyIntelligence.initialize();
const adminRuntime = new AdminRepresentationResolver();
const adminWorkspace = database && fingerprinter
  ? new AdminWorkspace(database,config.ADMIN_EMAIL??"runtime",fingerprinter,adminRuntime,strategyIntelligence) : null;
const adminRuntimeReady = adminWorkspace ? await adminWorkspace.runtimeAvailable() : false;
if (config.ADMIN_EMAIL && !adminRuntimeReady) throw new Error("Admin schema is missing. Run npm run db:migrate before starting the API.");
if (adminRuntimeReady) await adminWorkspace!.refresh();
const phaseK = sessions && fieldIntelligence && declarations
  ? { sessions, execution: strategyIntelligence && strategyRepository
      ? new StrategyPlanningBridge(new ExecutionPlanningService(fieldIntelligence, adminRuntime, declarations, applicationDocuments), strategyIntelligence, strategyRepository)
      : new ExecutionPlanningService(fieldIntelligence, adminRuntime, declarations, applicationDocuments),
      ...(applicationDocuments ? { documents: applicationDocuments } : {}) }
  : undefined;
const learning = database && fingerprinter && config.RESUME_PROPOSAL_ENCRYPTION_KEY
  ? new VerifiedLearningService(
      new KyselyVerifiedLearningRepository(database, undefined, Boolean(strategyIntelligence)),
      fingerprinter,
      new AesGcmCandidatePayloadCipher(Buffer.from(config.RESUME_PROPOSAL_ENCRYPTION_KEY, "base64"), 1),
      undefined,
      undefined,
      truth,
      learningCheckpointUnitOfWork(database, fingerprinter, Boolean(strategyIntelligence))
    )
  : null;
const recovery = database && fingerprinter && config.RESUME_PROPOSAL_ENCRYPTION_KEY
  ? new KyselyLearningRecovery(database, new AesGcmCandidatePayloadCipher(Buffer.from(config.RESUME_PROPOSAL_ENCRYPTION_KEY, "base64"), 1), fingerprinter) : null;
const phaseL = sessions && learning ? { sessions, learning, ...(recovery ? { recovery } : {}) } : undefined;
const phaseM = sessions && repeatableEntities ? { sessions, entities: repeatableEntities } : undefined;
const phaseO = sessions && declarations ? { sessions, declarations } : undefined;
const app = await createApi({
  ...(adminRuntimeReady ? {refreshAdminRuntime:()=>adminWorkspace!.refresh()} : {}),
  ...(adminWorkspace && config.ADMIN_EMAIL && config.ADMIN_PASSWORD ? {admin:{auth:new AdminAuth(config.ADMIN_EMAIL,config.ADMIN_PASSWORD),workspace:adminWorkspace}} : {}),
  ...(operatorDatabase && config.OIDC_ISSUER && config.OIDC_AUDIENCE && config.OIDC_JWKS_URL ? { operators: {
    verifier: new OperatorTokenVerifier({ issuer: config.OIDC_ISSUER, audience: config.OIDC_AUDIENCE, jwksUrl: new URL(config.OIDC_JWKS_URL) }), repository: new OperatorReviewRepository(operatorDatabase),
    ...(config.ENABLE_REVIEWED_EXPORTS?{reviewedExports:new ReviewedExportRepository(operatorDatabase)}:{}),
    ...(config.ENABLE_OPERATOR_PRIVATE_REVIEW && sessions && config.RESUME_PROPOSAL_ENCRYPTION_KEY ? {support:{sessions,repository:new SupportReviewRepository(operatorDatabase,new AesGcmCandidatePayloadCipher(Buffer.from(config.RESUME_PROPOSAL_ENCRYPTION_KEY,"base64"),1))}} : {})
  } } : {}),
  logger: { level: config.LOG_LEVEL },
  exposeDocumentation: config.NODE_ENV !== "production",
  corsOrigin: allowedWebOrigins(config),
  ...(phaseG ? { phaseG } : {}),
  ...(phaseH ? { phaseH } : {}),
  ...(phaseJ ? { phaseJ } : {}),
  ...(phaseK ? { phaseK } : {}),
  ...(phaseL ? { phaseL } : {}),
  ...(phaseM ? { phaseM } : {}),
  ...(phaseO ? { phaseO } : {})
});

const workerAbort = new AbortController();
const worker = database && strategyRepository && strategyIntelligence
  ? new StrategyWorker(new StrategyJobQueue(database), new StrategyReceiptBridge(strategyRepository), strategyIntelligence, strategyRepository) : null;
let workerRun: Promise<void> | null = null;
app.addHook("onClose", async () => { workerAbort.abort(); await workerRun; await operatorDatabase?.destroy(); });
const shutdown = async (signal: string) => {
  app.log.info({ signal }, "shutting down");
  await app.close();
  await database?.destroy();
};

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

await app.listen({ host: config.HOST, port: config.PORT });
workerRun = worker?.run(workerAbort.signal) ?? null;
