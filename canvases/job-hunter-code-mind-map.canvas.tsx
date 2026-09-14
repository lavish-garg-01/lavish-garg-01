import {
  Button, Callout, Card, CardBody, CardHeader, Code, Divider, Grid, H1, H2, H3,
  Pill, Row, Stack, Stat, Text, TextInput, useCanvasAction, useCanvasState, useHostTheme,
} from "cursor/canvas";

type Node = { layer: string; title: string; file: string; owns: string; anchors: string[]; state: string[]; risk: string };

const nodes: Node[] = [
  { layer: "Entry", title: "Dashboard + onboarding", file: "src/routes/dashboard.js", owns: "Job lists, onboarding, resume selection and Open with Extension.", anchors: ["/onboarding", "/jobs/:id/open-with-extension", "persistAssets"], state: ["candidate profile", "resume variant", "job status"], risk: "1,379 lines; transport and orchestration share one route module." },
  { layer: "Entry", title: "Job ingestion", file: "src/services/ingestion.js", owns: "Concurrent collection, canonical URLs, content fingerprints, freshness gates and dedupe.", anchors: ["runIngestion", "canonicalJobUrl", "jobContentFingerprint"], state: ["first/last seen", "discovery count", "ingestion run"], risk: "Collector transport still shares a large module with normalization and persistence." },
  { layer: "Semantics", title: "Source opportunity allocator", file: "src/services/ingestionScheduler.js", owns: "One-slot source exploration, Bayesian-smoothed quality weights, recency and daily-volume telemetry.", anchors: ["adaptiveSourceSelection", "sourceQualityEvidence", "dailyFetchRecommendation"], state: ["quota", "posterior yield", "allocation weight"], risk: "Outcome labels are sparse; keep the deterministic baseline until offline policy evaluation is credible." },
  { layer: "Browser", title: "Application session controller", file: "extension/background.js", owns: "Tab groups, one application tab, redirects, side-panel lifecycle and document tabs.", anchors: ["OPEN_WITH_EXTENSION", "REGISTER_TAB", "openSidePanel"], state: ["activeJob", "activeTabId", "activeApplication"], risk: "1,507 lines; Chrome event transitions require explicit state-machine tests." },
  { layer: "Browser", title: "Form runtime", file: "extension/content.js", owns: "DOM detection, stable identity, execution, validation, SPA rescans and launcher.", anchors: ["detectFields", "structuredSectionFor", "fillPage", "dynamicPageFingerprint"], state: ["fieldElementById", "userEditedFieldIds", "lastFill"], risk: "2,528 lines; highest regression surface and first extraction target." },
  { layer: "Browser", title: "Adapter registry + packs", file: "extension/adapters/registry.js", owns: "Hostname to portal kind and one versioned data pack.", anchors: ["resolve", "portalKind", "mapping stage"], state: ["adapter version", "kill switch", "overlays"], risk: "Strong boundary. Tenant differences must stay data, not company JavaScript." },
  { layer: "Browser", title: "Control primitives", file: "extension/adapters/common/uploads.js", owns: "File classification, DataTransfer, drag/drop, receipts and retry ledger.", anchors: ["attachDocumentOnce", "attachmentConfirmed", "installDocumentDropBridge"], state: ["attachmentLedger", "attachmentFlights"], risk: "Async receipts need a sanitized fixture per distinct widget family." },
  { layer: "API", title: "Extension API + planner", file: "src/routes/extension.js", owns: "Job context, resolution, evidence, sidecar state, learning and Attention bridge.", anchors: ["job-context", "RESOLVE_FIELDS", "profileColumnForSemantic"], state: ["application", "attempt", "plan", "attention"], risk: "1,455 lines; controllers and domain decisions are mixed." },
  { layer: "Semantics", title: "Field meaning registry", file: "src/services/fieldCanonicalizer.js", owns: "One value-free resolver over src/services/fieldOntology.js rules, src/repositories/fieldSemanticRepository.js mappings/examples, semantic retrieval and bounded AI. src/services/semanticMappingEvidenceService.js routes explicit confirmation/correction into SHADOW evidence without live promotion.", anchors: ["canonicalizeField", "toSharedFieldSemanticResult", "recordExplicitSemanticDecision"], state: ["semantic key", "mapping lifecycle", "SHADOW recommendation"], risk: "Global reuse requires TRUSTED status and administrator approval; candidate values never enter this plane." },
  { layer: "Semantics", title: "Question resolver", file: "src/services/questionResolver.js", owns: "Profile/resume/job answers, adaptations, memory and AI allow-list.", anchors: ["resolveQuestion", "profileAnswer", "resumeAnswer"], state: ["answer source", "confidence", "requiresUserInput"], risk: "Option matching is split across server and browser." },
  { layer: "Learning", title: "Legacy answer learning policy", file: "src/services/answerLearningPolicy.js", owns: "Compatibility decisions for auto-version, review-to-save, application-only, declaration authorization and never-learn categories while Part 2 parity is measured.", anchors: ["answerLearningPolicyFor", "LEARNING_CATEGORY_POLICIES", "ADR 0001"], state: ["global preference", "application opt-out", "parity baseline"], risk: "Production resolver still uses this compatibility path; automatic truth promotion, change-set Undo and revision-bound authorization remain intentionally disabled." },
  { layer: "Persistence", title: "Candidate-answer policy + truth", file: "src/services/answerPolicyRegistry.js", owns: "Part 2A policy coverage, exact contexts and ordered scope ranks live in src/services/answerContextNormalization.js, src/services/scopeRankPolicy.js, src/services/candidateAnswerFreshness.js and src/services/candidateAnswerAnomaly.js. src/repositories/candidateAnswerVersionRepository.js owns append-only private truth, optimistic writes and atomic dependency invalidation through src/database/migrations/0013_candidate_answer_intelligence.js and src/database/migrations/0014_employer_entity_exact_aliases.js.", anchors: ["ensureAnswerPolicyRegistry", "normalizeAnswerContext", "resolveCandidateTruth", "saveCandidateAnswerVersion"], state: ["active policy version", "controlled scope", "candidate truth version"], risk: "Unknown jurisdictions/entities and equal-rank disagreements fail closed. supabase/phase2_candidate_truth_rls.sql is a future service-only mutation boundary, not active hosting." },
  { layer: "Persistence", title: "Safe legacy truth bridge", file: "src/services/candidateAnswerLegacyMigrationService.js", owns: "Part 2B reads raw profile, verified resume, approved fact memory and candidate-entered answers without profile backfill side effects, then src/database/migrations/0015_candidate_answer_legacy_migration.js writes only normalized policy-safe non-conflicting values into SHADOW truth in one idempotent ACID run.", anchors: ["previewLegacyCandidateTruthMigration", "applyLegacyCandidateTruthMigration", "ensureSafeLegacyCandidateTruthMigration"], state: ["snapshot fingerprint", "reason-coded decision", "private migration audit"], risk: "Legal/entity/application/repeatable values, implicit defaults, unsafe provenance and conflicts never migrate. Audit retains hashes, not raw candidate values; production resolver is unchanged." },
  { layer: "Semantics", title: "Field-answer contract boundary", file: "src/services/fieldAnswerContractService.js", owns: "Part 2B batch-binds trusted field meaning, active policy, exact scoped candidate truth, provenance and a narrow packaged baseline representation into src/contracts/fieldAnswerContract.js.", anchors: ["buildFieldAnswerContracts", "resolveBaselineRepresentation", "FIELD_ANSWER_CONTRACT_MODE"], state: ["SHADOW", "contract id", "review reason"], risk: "It never replaces the production resolver. Unsupported money, phone, duration, multi-value and file representations fail closed until Part 2D." },
  { layer: "Contracts", title: "Shared contract registry", file: "src/contracts/sharedContracts.js", owns: "Named fail-closed parser registry; canonical JSON and hashing live in src/contracts/contractPrimitives.js.", anchors: ["parseSharedContract", "SHARED_CONTRACT_SCHEMAS", "schemaVersion"], state: ["version rejection", "size limit", "stable hash"], risk: "Contract v1 is frozen; additive or breaking changes require a new explicitly supported version." },
  { layer: "Contracts", title: "Field meaning + answer policy", file: "src/contracts/fieldSemanticResult.js", owns: "Value-free FieldSemanticResult; CanonicalAnswerPolicy and ScopeRank live in src/contracts/canonicalAnswerPolicy.js.", anchors: ["fieldSemanticResultSchema", "canonicalAnswerPolicySchema", "scopeRankSchema"], state: ["canonical key", "scope rank", "reuse decision"], risk: "Semantic results cannot carry candidate values; protected status fails closed." },
  { layer: "Contracts", title: "Normalized value + answer", file: "src/contracts/normalizedValue.js", owns: "Typed exact candidate values; src/contracts/fieldAnswerContract.js binds policy, provenance, representation and review.", anchors: ["normalizedValueSchema", "fieldAnswerContractSchema", "amountExact"], state: ["candidate truth", "representation", "review"], risk: "Protected values have no representable shared data class; money never uses floating-point truth." },
  { layer: "Contracts", title: "Logical identity + revisions", file: "src/contracts/logicalFieldIdentity.js", owns: "Stable browser identity; src/contracts/fieldRevisionContracts.js owns revisions, edit sessions and checkpoint receipts.", anchors: ["logicalFieldIdentitySchema", "fieldRevisionSchema", "checkpointReceiptSchema"], state: ["document lifecycle", "edit sequence", "checkpoint"], risk: "Contract v1 and durable Phase 0C capture are regression-locked; promotion remains SHADOW-only." },
  { layer: "Contracts", title: "Authorization + protocol", file: "src/contracts/applicationAuthorizationContracts.js", owns: "Application revision-bound gestures; src/contracts/extensionProtocolContracts.js owns transport and value-free telemetry envelopes.", anchors: ["applicationAuthorizationReceiptSchema", "extensionProtocolEnvelopeSchema", "telemetryEnvelopeSchema"], state: ["content revision", "authorization receipt", "protocol envelope"], risk: "Launch protocol is active; application declarations remain manual until their separate authorization UX ships." },
  { layer: "Learning", title: "Neutral correction observation", file: "src/contracts/fieldInteractionObservation.js", owns: "Versioned, value-free private browser evidence before any learning attribution.", anchors: ["buildFieldInteractionObservation", "FIELD_INTERACTION_OBSERVATION_VERSION"], state: ["observation", "value hashes", "checkpoint"], risk: "The browser still needs durable operation and edit-session identity before this can leave SHADOW mode." },
  { layer: "Learning", title: "Five-layer correction classifier", file: "src/services/fieldLearningClassifier.js", owns: "Independent semantic, answer, representation, strategy and acceptance decisions without ledger writes.", anchors: ["classifyFieldInteraction", "FIELD_LEARNING_CLASSIFICATION_VERSION", "SHADOW"], state: ["layer outcomes", "reason codes", "eligibility"], risk: "Classification is intentionally conservative; UNKNOWN and PENDING_COMMIT produce no answer learning." },
  { layer: "Learning", title: "Durable edit + checkpoint timeline", file: "src/services/fieldRevisionService.js", owns: "Append-only field revisions, edit-session snapshots, checkpoint receipts, neutral observations and checkpoint-triggered SHADOW replay.", anchors: ["recordFieldRevision", "recordNeutralObservation", "classifyAttemptAtCheckpoint"], state: ["field_revision_events", "application_checkpoint_receipts", "shadow classifications"], risk: "Migrations src/database/migrations/0007_field_revision_timeline.js and src/database/migrations/0008_checkpoint_reclassification.js are frozen; classifier writes remain disabled." },
  { layer: "Browser", title: "Authorized launch protocol", file: "src/services/extensionLaunchProtocol.js", owns: "Negotiation, single-use launch token hashes, exact origin/tab/document run binding, replay protection and delta generations via src/database/migrations/0009_extension_launch_protocol.js.", anchors: ["issueExtensionLaunch", "consumeExtensionLaunch", "updateRunGeneration"], state: ["launch authorization", "run binding", "field delta"], risk: "Cross-origin navigation pauses for a new exact-origin permission; tokens never appear in diagnostics." },
  { layer: "Browser", title: "Durable delivery + isolation", file: "extension/durable-outbox.js", owns: "Chrome-local ordered value-free queue; src/services/extensionDeliveryService.js owns backend idempotency, telemetry and transactional outbox through src/database/migrations/0010_extension_durable_delivery.js; src/database/migrations/0011_extension_field_cache_status.js adds retry-safe delta commit state. supabase/phase0_extension_rls.sql freezes future RLS.", anchors: ["enqueue", "runIdempotentExtensionMutation", "persistTelemetryBatch"], state: ["pending events", "ACK watermark", "candidate_id"], risk: "Queue intentionally refuses DOM actions and candidate raw values; Supabase SQL is an integration contract, not active hosting." },
  { layer: "Learning", title: "Adaptive evidence kernel", file: "src/services/evidenceRouter.js", owns: "Phase 0F routes src/contracts/evidenceUpdate.js into layer policies, integer weighting, src/services/evidenceAccumulator.js rollups, src/services/volatilityDetector.js regressions and src/services/promotionPolicy.js SHADOW recommendations. src/repositories/evidenceRollupRepository.js and src/database/migrations/0012_adaptive_evidence_shadow.js persist value-free history.", anchors: ["buildEvidenceUpdates", "accumulateShadowEvidence", "recommendShadowEvidenceState"], state: ["lifetime evidence", "recent evidence", "volatility epoch", "SHADOW recommendation"], risk: "Flagged off by default. It can recommend but cannot mutate candidate truth, mappings, representations or production strategies." },
  { layer: "Semantics", title: "Job requirement + match model", file: "src/services/jobRequirementModel.js", owns: "Required/preferred/negated/alternative skills feeding BM25F, capability, preference and hard eligibility.", anchors: ["extractJobRequirementModel", "evaluateJobRequirements", "evaluateHeuristicMatch"], state: ["weighted requirement", "transferable evidence", "AI escalation"], risk: "Weights need time-split calibration from candidate-confirmed outcomes before they become learned parameters." },
  { layer: "Documents", title: "Resume evidence parser", file: "src/services/candidateProfileBuilder.js", owns: "Layout-line sections, date ranges, field confidence, identity-safe verified fallback and review routing.", anchors: ["buildCandidateResumeProfile", "totalExperienceYears", "PARSER_VERSION"], state: ["section source", "parse confidence", "OCR_REQUIRED"], risk: "Scanned and highly visual PDFs still need a separately evaluated document-model/OCR worker." },
  { layer: "Documents", title: "Resume variants", file: "src/repositories/resumeVariantRepository.js", owns: "Reusable content deltas, categories, selection and cache invalidation.", anchors: ["listActiveResumeVariants", "assignResumeVariantToJob"], state: ["modifications_json", "selected variant", "PDF cache"], risk: "Good compact model; preserve deterministic renderer invalidation." },
  { layer: "Persistence", title: "SQLite + migration shim", file: "src/database/schema.sql", owns: "98 discovery, profile, application, evidence, learning and operations tables in the current local database.", anchors: ["candidate_profiles", "applications", "application_field_timeline"], state: ["WAL", "local-user", "append-only evidence"], risk: "The compatibility baseline and ordered migrations coexist; new changes must use immutable forward-only migration files." },
  { layer: "Learning", title: "Observe to promote", file: "src/services/learnProposer.js", owns: "Failure clusters, scoped proposals and SHADOW/CANARY/DEFAULT promotion.", anchors: ["propose", "mapping_proposals", "Form A gate"], state: ["fingerprint", "stage", "success/failure"], risk: "Mappings learn automatically; new widget behavior requires code plus a fixture." },
  { layer: "Quality", title: "Form A/B browser corpus", file: "test/extensionBrowserHarness.test.js", owns: "Realistic DOM fixtures, uploads, SPA, shadow roots, protected fields and tab flows.", anchors: ["PhonePe Greenhouse", "SmartRecruiters", "Phenom"], state: ["sanitized DOM", "expected operations", "protected fields"], risk: "810 lines; split by engine while retaining one full promote gate." },
];

const tables = [
  ["Discovery", "companies, jobs, outreach, ingestion_runs, ingestion_source_runs, ingestion_source_state, job_score_events, career_test_targets, career_test_runs"],
  ["Candidate", "candidate_profiles, candidate_answers, candidate_fact_memory, candidate_fact_correction_proposals, candidate_answer_versions, candidate_answer_write_receipts, candidate_answer_dependency_events, candidate_answer_migration_runs, candidate_answer_migration_items, writing_style_profiles"],
  ["Documents", "resume_versions, resume_variants"],
  ["Application", "applications, application_events, application_attempts, application_outcome_events, application_plans, agent_sessions, agent_tasks, agent_questions"],
  ["Evidence", "application_field_evidence, application_operation_events, application_page_snapshots, application_field_snapshots, application_field_timeline, field_revision_events, field_edit_session_snapshots, application_checkpoint_receipts, field_interaction_observations, field_learning_shadow_classifications, adaptive_evidence_shadow_events, adaptive_evidence_shadow_rollups, adaptive_evidence_shadow_recommendations, field_resolutions, application_questions, adapter_runs"],
  ["Extension protocol", "extension_launch_authorizations, extension_run_bindings, extension_protocol_replays, extension_run_field_cache, extension_idempotency_requests, extension_telemetry_events, extension_backend_outbox, extension_protocol_audit_events"],
  ["Learning", "field_mappings, portal_field_patterns, learning_events, mapping_packs, mapping_promotions, mapping_proposals, adapter_incidents"],
  ["Recovery + policy", "attention_items, canonical_answer_policies, canonical_answer_policy_active, canonical_answer_freshness_profiles, canonical_answer_anomaly_profiles, answer_context_registry, employer_entity_groups, employer_entities, settings, auto_apply_settings, autofill_category_policies, feature_flags, usage_events, ai_call_metrics"],
];

const flow = [
  ["1", "Discover", "Parallel collectors → canonical URL/content fingerprint → freshness gate → fair source quota", "jobs + source allocation evidence"],
  ["2", "Match", "Career family → weighted requirements → BM25F/skill graph → hard eligibility → optional AI", "score event + evidence breakdown"],
  ["3", "Prepare", "Choose reusable resume delta and render files on demand", "variant + job PDF cache"],
  ["4", "Launch", "Negotiate website/extension version → consume one-use URL/origin token → bind grouped tab/document → request exact employer permission", "authorized run session"],
  ["5", "Detect", "Resolve one adapter; scan bounded controls; assign stable semantics", "field plan"],
  ["6", "Resolve truth", "One-time safe legacy bridge → canonical policy → exact controlled context → one batched best-scope lookup → freshness/hash gate → SHADOW FieldAnswerContract; ambiguity asks the candidate", "migration audit + policy version + candidate answer version + contract id"],
  ["7", "Fill", "Verified identity/files first; resolve structured leftovers; protect legal", "DOM + operation events"],
  ["8", "Recover", "Unknowns, conflicts, invalid results and exits become Attention", "candidate action"],
  ["9", "Deliver", "Value-free revision/checkpoint → Chrome outbox → idempotency key → backend receipt/outbox; never replay a DOM click", "ACK watermark + audit"],
  ["10", "Attribute", "Neutral observation + durable edit timeline + later checkpoint → five independent classifier decisions; USER_CORRECTED is never a verdict", "append-only SHADOW reason codes"],
  ["11", "Weigh", "Classified value-free evidence → layer policy → lifetime/recent rollup → volatility → SHADOW recommendation", "reproducible decision + reason codes"],
  ["12", "Learn", "Admin-approved eligible evidence → cluster → fixture → SHADOW → CANARY → DEFAULT", "versioned mapping pack"],
];

const changes = [
  ["Wrong field meaning", "src/services/fieldCanonicalizer.js + src/repositories/fieldSemanticRepository.js + src/services/semanticMappingEvidenceService.js", "Sanitized fixture + semantic evidence isolation + admin approval test"],
  ["Wrong known answer", "questionResolver.js + candidate profile", "Resolver test + exact option fixture"],
  ["User corrects autofill", "src/contracts/fieldInteractionObservation.js + src/services/fieldLearningClassifier.js", "Five-layer replay matrix; no direct ledger write"],
  ["Change answer-learning policy", "src/services/answerLearningPolicy.js + ADR 0001 + learningRepository.js", "Category coverage + checkpoint + opt-out tests"],
  ["Change canonical answer policy or scope", "src/services/answerPolicyRegistry.js + src/services/answerContextNormalization.js + src/services/scopeRankPolicy.js", "All-canonical coverage + jurisdiction/entity fail-closed + equal-rank tests"],
  ["Change persistent candidate truth", "src/repositories/candidateAnswerVersionRepository.js + migrations 0013/0014", "Append-only history + idempotency + optimistic conflict + atomic invalidation + RLS contract tests"],
  ["Change legacy truth migration", "src/services/candidateAnswerLegacyMigrationService.js + migration 0015", "Source conflict + policy skip + exact units + no overwrite + redacted audit + idempotent replay tests"],
  ["Change field-answer contract", "src/services/fieldAnswerContractService.js + src/contracts/fieldAnswerContract.js", "Batch scope/freshness + exact-option ambiguity + hash/provenance + SHADOW-no-cutover tests"],
  ["Change edit/checkpoint attribution", "src/services/fieldRevisionService.js + extension/content.js", "Value-free timeline + retry + checkpoint replay tests"],
  ["Change launch or transport", "src/services/extensionLaunchProtocol.js + extension/background.js + extension/durable-outbox.js", "Replay/origin/version + restart/order/idempotency tests"],
  ["Change adaptive evidence", "src/contracts/evidenceUpdate.js + src/services/adaptiveEvidencePolicy.js + src/services/evidenceAccumulator.js", "Deterministic replay + privacy + volatility + no-production-mutation tests"],
  ["Unsupported widget", "adapters/common + portal pack", "Browser fixture for control kind"],
  ["Broken tabs or panel", "background.js + sidepanel.js", "Persistent extension browser test"],
  ["React clears a value", "content.js fingerprint + verification", "Controlled Form A"],
  ["Add candidate fact", "schema + migration + repository + onboarding + resolver", "Persistence, privacy and validation tests"],
  ["Add ATS engine", "registry + JSON pack + Form A/B", "No support claim until gate passes"],
];

function NodeCard({ node }: { node: Node }) {
  const theme = useHostTheme();
  const dispatch = useCanvasAction();
  return <Card style={{ borderLeft: `4px solid ${theme.accent.primary}` }}>
    <CardHeader trailing={<Pill size="sm">{node.layer}</Pill>}>{node.title}</CardHeader>
    <CardBody><Stack gap={8}>
      <Text>{node.owns}</Text>
      <Text size="small" tone="secondary"><Code>{node.anchors.join(" · ")}</Code></Text>
      <Row gap={6} wrap>{node.state.map((item) => <Pill key={item} size="sm">{item}</Pill>)}</Row>
      <Text size="small" tone="tertiary">Audit: {node.risk}</Text>
      <Button onClick={() => dispatch({ type: "openFile", path: node.file })}>Open {node.file}</Button>
    </Stack></CardBody>
  </Card>;
}

export default function JobHunterCodeMindMap() {
  const theme = useHostTheme();
  const [view, setView] = useCanvasState("architecture-view", "system");
  const [query, setQuery] = useCanvasState("architecture-query", "");
  const term = query.trim().toLowerCase();
  const filtered = nodes.filter((node) => !term || JSON.stringify(node).toLowerCase().includes(term));
  const layerOrder = ["Entry", "Browser", "API", "Contracts", "Semantics", "Documents", "Persistence", "Learning", "Quality"];
  return <Stack gap={22} style={{ padding: 28, maxWidth: 1280, margin: "0 auto", background: theme.bg.editor }}>
    <Stack gap={8}>
      <Row gap={8} wrap><Pill active tone="info">Maintained architecture index</Pill><Pill tone="success">Part 2B contract + safe migration in SHADOW</Pill><Pill>v1.15.9</Pill></Row>
      <H1>Job Hunter code, state and learning mind map</H1>
      <Text tone="secondary">Search a function, state variable, table, ATS issue or file, then open its owner directly.</Text>
    </Stack>
    <Grid columns={5} gap={12}><Stat value="50k+" label="source/test lines" /><Stat value="100" label="SQLite tables" /><Stat value="14" label="adapter packs" /><Stat value="78" label="test modules" /><Stat value="41" label="fixtures" /></Grid>
    <TextInput value={query} onChange={setQuery} placeholder="Search upload, Greenhouse, mapping_promotions, fillPage…" />
    <Row gap={8} wrap>{[["system", "System layers"], ["flow", "Data flow"], ["database", "Database"], ["change", "Where to change"], ["audit", "Audit"]].map(([id, label]) => <Pill key={id} active={view === id} onClick={() => setView(id)}>{label}</Pill>)}</Row>

    {view === "system" && <Stack gap={16} style={{ transform: "perspective(1400px) rotateX(0.7deg)", transformOrigin: "top center" }}>
      {layerOrder.map((layer, depth) => {
        const group = filtered.filter((node) => node.layer === layer);
        if (!group.length) return null;
        return <Stack key={layer} gap={8} style={{ paddingLeft: `${Math.min(42, depth * 6)}px` }}>
          <Row gap={8} align="center"><H2>{layer}</H2><Text size="small" tone="tertiary">{group.length} owner{group.length === 1 ? "" : "s"}</Text></Row>
          <Grid columns={Math.min(3, group.length)} gap={12}>{group.map((node) => <NodeCard key={node.file + node.title} node={node} />)}</Grid>
        </Stack>;
      })}
      {!filtered.length && <Callout tone="warning" title="No owner found">Try a file, semantic key, table or runtime function.</Callout>}
    </Stack>}

    {view === "flow" && <Stack gap={14}>
      <Callout tone="info" title="Hot path boundary">Identity and documents fill locally. Evidence writes are asynchronous. AI is allowed only for explicit leftover writing.</Callout>
      {flow.map(([step, title, description, state], index) => <Row key={step} gap={14} align="start" style={{ marginLeft: `${index * 12}px`, borderLeft: `3px solid ${theme.stroke.secondary}`, paddingLeft: 14 }}><Pill active tone="info">{step}</Pill><Stack gap={3}><H3>{title}</H3><Text>{description}</Text><Text size="small" tone="tertiary">State: {state}</Text></Stack></Row>)}
    </Stack>}

    {view === "database" && <Stack gap={14}><H2>SQLite ownership by purpose</H2><Text tone="secondary">Local WAL database. Sensitive values must never enter evidence, operations, learning or embeddings.</Text><Grid columns={2} gap={12}>{tables.filter((row) => !term || row.join(" ").toLowerCase().includes(term)).map(([group, list]) => <Card key={group}><CardHeader>{group}</CardHeader><CardBody><Text size="small"><Code>{list}</Code></Text></CardBody></Card>)}</Grid></Stack>}

    {view === "change" && <Stack gap={12}><H2>Fast routing guide</H2>{changes.filter((row) => !term || row.join(" ").toLowerCase().includes(term)).map(([symptom, owner, lock]) => <Card key={symptom}><CardBody><Grid columns={3} gap={12}><Text weight="semibold">{symptom}</Text><Text><Code>{owner}</Code></Text><Text size="small" tone="secondary">Required lock: {lock}</Text></Grid></CardBody></Card>)}</Stack>}

    {view === "audit" && <Stack gap={14}>
      <Grid columns={2} gap={14}><Callout tone="success" title="Strong foundations">Versioned adapters, finite ontology, review-only submit, compact variants, append-only timeline, gated promotion and broad fixtures.</Callout><Callout tone="warning" title="Maintainability debt">Four orchestration hubs are oversized; semantics/options are duplicated; migrations are duplicated.</Callout></Grid>
      <Card><CardHeader>Recommended extraction order</CardHeader><CardBody><Stack gap={8}><Text><Code>content.js</Code> → detection, execution, evidence and SPA bridge.</Text><Text><Code>routes/extension.js</Code> → thin controllers over resolution/session/evidence services.</Text><Text>Generate one shared semantic/option contract for browser and server.</Text><Text>Adopt ordered, recorded migrations before multi-user/cloud.</Text><Text>Split browser tests by engine but retain one promote-gate command.</Text></Stack></CardBody></Card>
      <Callout tone="info" title="Change policy">Company wording is data. New widget behavior is a common primitive. A new ATS DOM family is an adapter. Logs never rewrite the global runtime directly.</Callout>
    </Stack>}
    <Divider /><Text size="small" tone="tertiary">Maintenance: update docs/ARCHITECTURE_INDEX.md and this canvas whenever an owner, table family, adapter layer or core flow changes.</Text>
  </Stack>;
}
