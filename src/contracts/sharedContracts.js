import { parseVersionedContract } from "./contractPrimitives.js";
import { fieldSemanticResultSchema } from "./fieldSemanticResult.js";
import { canonicalAnswerPolicySchema, scopeRankSchema } from "./canonicalAnswerPolicy.js";
import { normalizedValueSchema } from "./normalizedValue.js";
import { fieldAnswerContractSchema } from "./fieldAnswerContract.js";
import { logicalFieldIdentitySchema } from "./logicalFieldIdentity.js";
import { checkpointReceiptSchema, editSessionSchema, fieldRevisionSchema } from "./fieldRevisionContracts.js";
import { applicationAuthorizationReceiptSchema, applicationContentRevisionSchema } from "./applicationAuthorizationContracts.js";
import { extensionProtocolEnvelopeSchema, telemetryEnvelopeSchema } from "./extensionProtocolContracts.js";
import { evidenceUpdateSchema } from "./evidenceUpdate.js";

export const SHARED_CONTRACT_SCHEMAS = Object.freeze({
    FieldSemanticResult: fieldSemanticResultSchema,
    CanonicalAnswerPolicy: canonicalAnswerPolicySchema,
    ScopeRank: scopeRankSchema,
    NormalizedValue: normalizedValueSchema,
    FieldAnswerContract: fieldAnswerContractSchema,
    LogicalFieldIdentity: logicalFieldIdentitySchema,
    FieldRevision: fieldRevisionSchema,
    EditSession: editSessionSchema,
    CheckpointReceipt: checkpointReceiptSchema,
    ApplicationContentRevision: applicationContentRevisionSchema,
    ApplicationAuthorizationReceipt: applicationAuthorizationReceiptSchema,
    ExtensionProtocolEnvelope: extensionProtocolEnvelopeSchema,
    TelemetryEnvelope: telemetryEnvelopeSchema,
    EvidenceUpdate: evidenceUpdateSchema
});

export function parseSharedContract(contractName, input) {
    const schema = SHARED_CONTRACT_SCHEMAS[contractName];
    if (!schema) return { success: false, contractName, reasonCode: "UNKNOWN_CONTRACT" };
    return parseVersionedContract(contractName, schema, input);
}
