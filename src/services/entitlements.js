import { LOCAL_USER_ID } from "../repositories/copilotRepository.js";
import { usageSummary } from "../repositories/usageMeterRepository.js";

const PLANS = {
    FREE: {
        id: "FREE",
        adapterFillsPerDay: 80,
        aiCallsPerDay: 0,
        documentGensPerDay: 0,
        requirePaidForAiAnswers: true
    }
};

export function currentPlan() {
    return { ...PLANS.FREE, userId: LOCAL_USER_ID, billingProvider: null };
}

export function entitlementSnapshot() {
    const plan = currentPlan();
    const usage = usageSummary({ days: 1 });
    return {
        plan: plan.id,
        billing: "local-unmetered-stub",
        note: "Razorpay/Supabase entitlements are not wired in the local MVP. Free candidate workflows use deterministic matching and autofill; candidate-specific AI generation requires Pro.",
        aiApplicationAnswers: {
            allowed: !plan.requirePaidForAiAnswers || plan.id !== "FREE",
            requirePaidForAiAnswers: Boolean(plan.requirePaidForAiAnswers)
        },
        platformCanonicalization: {
            allowed: true,
            billedToUser: false,
            note: "Shared field-structure resolution is a platform operation, separate from candidate-specific AI generation."
        },
        limits: {
            adapterFillsPerDay: plan.adapterFillsPerDay,
            aiCallsPerDay: plan.aiCallsPerDay,
            documentGensPerDay: plan.documentGensPerDay
        },
        usage: usage.meters
    };
}

export function allowMeteredAction() {
    return { allowed: true, plan: currentPlan().id };
}
