const submission = { type: "SUBMISSION", status: "VERIFIED" };

export const fieldLearningReplays = [
    {
        name: "correct autofill kept through verified submission",
        field: {
            fillOutcome: "FILLED", intendedValue: "Razorpay", value: "Razorpay",
            normalizedEquivalent: true, representationRuleId: "TEXT_V1",
            strategyId: "NATIVE_INPUT_V1", strategyAttempted: true, readback: "MATCH", valid: true
        },
        checkpoint: submission,
        expected: { semantic: "NO_EVIDENCE", answer: "CONFIRMED_UNCHANGED", representation: "CONFIRMED", strategy: "SUCCESS", acceptance: "VERIFIED" }
    },
    {
        name: "candidate corrects a wrong saved answer",
        field: {
            fillOutcome: "USER_CORRECTED", intendedValue: "Yes", value: "No",
            normalizedEquivalent: false, representationRuleId: "BOOLEAN_LABEL_V1",
            strategyId: "RADIO_BY_LABEL_V1", strategyAttempted: true, readback: "MATCH", valid: true
        },
        checkpoint: submission,
        expected: { semantic: "NO_EVIDENCE", answer: "CORRECTED", representation: "UNKNOWN", strategy: "SUCCESS", acceptance: "VERIFIED" }
    },
    {
        name: "candidate uses an accepted equivalent representation",
        field: {
            fillOutcome: "USER_CORRECTED", intendedValue: "5", value: "4",
            normalizedEquivalent: true, equivalentTruth: true,
            representationRuleId: "ROUND_YEARS_V1", representationChanged: true,
            originalRepresentationRejected: true, strategyId: "NUMBER_INPUT_V1",
            strategyAttempted: true, readback: "MATCH", valid: true
        },
        checkpoint: submission,
        expected: { semantic: "NO_EVIDENCE", answer: "CONFIRMED_UNCHANGED", representation: "CORRECTED", strategy: "SUCCESS", acceptance: "VERIFIED" }
    },
    {
        name: "strategy value reverts before a durable checkpoint",
        field: {
            fillOutcome: "FILL_FAILED", intendedValue: "India", value: null,
            representationRuleId: "TEXT_V1", strategyId: "REACT_INPUT_V1",
            strategyAttempted: true, readback: "REVERTED"
        },
        checkpoint: { type: "PAGE_ADVANCE", status: "NOT_OBSERVED" },
        expected: { semantic: "NO_EVIDENCE", answer: "UNKNOWN", representation: "NO_EVIDENCE", strategy: "FAILURE", acceptance: "UNKNOWN" }
    },
    {
        name: "user takeover succeeds after strategy mismatch",
        field: {
            fillOutcome: "USER_CORRECTED", intendedValue: "India", value: "India",
            normalizedEquivalent: true, completedByUser: true,
            representationRuleId: "ENUM_EXACT_V1", strategyId: "COMBOBOX_V1",
            strategyAttempted: true, readback: "MISMATCH", valid: true
        },
        checkpoint: submission,
        expected: { semantic: "NO_EVIDENCE", answer: "CONFIRMED_UNCHANGED", representation: "NO_EVIDENCE", strategy: "FAILURE", acceptance: "VERIFIED" }
    },
    {
        name: "multi-edit session returns and commits a new truth",
        field: {
            fillOutcome: "USER_CORRECTED", intendedValue: "30", value: "60",
            source: "USER_EDIT_SESSION", normalizedEquivalent: false,
            strategyId: "NUMBER_INPUT_V1", strategyAttempted: true, readback: "MATCH", valid: true
        },
        checkpoint: submission,
        expected: { semantic: "NO_EVIDENCE", answer: "CORRECTED", representation: "NO_EVIDENCE", strategy: "SUCCESS", acceptance: "VERIFIED" }
    },
    {
        name: "page advance is runtime acceptance only",
        field: {
            fillOutcome: "FILLED", intendedValue: "Bengaluru", value: "Bengaluru",
            normalizedEquivalent: true, representationRuleId: "TEXT_V1",
            strategyId: "NATIVE_INPUT_V1", strategyAttempted: true, readback: "MATCH", valid: true
        },
        checkpoint: { type: "PAGE_ADVANCE", status: "VERIFIED" },
        expected: { semantic: "NO_EVIDENCE", answer: "UNKNOWN", representation: "UNKNOWN", strategy: "SUCCESS", acceptance: "RUNTIME_ACCEPTED" }
    },
    {
        name: "review reached then application abandoned",
        field: {
            fillOutcome: "USER_CORRECTED", intendedValue: "30", value: "60",
            normalizedEquivalent: false, strategyAttempted: true, readback: "MATCH"
        },
        checkpoint: { type: "REVIEW", status: "ABANDONED" },
        expected: { semantic: "NO_EVIDENCE", answer: "NO_EVIDENCE", representation: "NO_EVIDENCE", strategy: "SUCCESS", acceptance: "ABANDONED" }
    },
    {
        name: "user restores the original answer before submission",
        field: {
            fillOutcome: "USER_CORRECTED", intendedValue: "Yes", value: "Yes",
            source: "USER_EDIT_SESSION", normalizedEquivalent: true,
            strategyId: "RADIO_BY_LABEL_V1", strategyAttempted: true, readback: "MATCH", valid: true
        },
        checkpoint: submission,
        expected: { semantic: "NO_EVIDENCE", answer: "CONFIRMED_UNCHANGED", representation: "NO_EVIDENCE", strategy: "SUCCESS", acceptance: "VERIFIED" }
    },
    {
        name: "page script changes a previously filled value",
        field: {
            fillOutcome: "FILL_FAILED", intendedValue: "Yes", value: "No",
            source: "ATS_SCRIPT", normalizedEquivalent: false,
            representationRuleId: "BOOLEAN_LABEL_V1", strategyId: "RADIO_BY_LABEL_V1",
            strategyAttempted: true, readback: "REVERTED"
        },
        checkpoint: { type: "PAGE_ADVANCE", status: "VERIFIED" },
        expected: { semantic: "NO_EVIDENCE", answer: "UNKNOWN", representation: "NO_EVIDENCE", strategy: "FAILURE", acceptance: "RUNTIME_ACCEPTED" }
    },
    {
        name: "password manager or ATS prefill is not candidate confirmation",
        field: {
            fillOutcome: "DETECTED", value: "Synthetic Candidate",
            source: "PASSWORD_MANAGER", strategyAttempted: false
        },
        checkpoint: { type: "LOCAL_VALIDITY", status: "VERIFIED" },
        expected: { semantic: "NO_EVIDENCE", answer: "UNKNOWN", representation: "NO_EVIDENCE", strategy: "NO_EVIDENCE", acceptance: "RUNTIME_ACCEPTED" }
    },
    {
        name: "service-worker interruption remains unknown",
        field: {
            fillOutcome: "FILL_ATTEMPTED", intendedValue: "Synthetic Candidate",
            strategyId: "NATIVE_INPUT_V1", strategyAttempted: true, readback: "NOT_OBSERVED"
        },
        checkpoint: { type: "NONE", status: "UNKNOWN" },
        expected: { semantic: "NO_EVIDENCE", answer: "UNKNOWN", representation: "NO_EVIDENCE", strategy: "UNKNOWN", acceptance: "UNKNOWN" }
    }
];
