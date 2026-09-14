import { getDb, getSetting, setSetting } from "../database/connection.js";
import { currentExtensionVersion } from "./buildIdentity.js";

const DAY_MS = 24 * 60 * 60 * 1000;

function validDate(value) {
    const timestamp = Date.parse(String(value || ""));
    return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function laterDate(left, right) {
    const a = validDate(left);
    const b = validDate(right);
    if (!a) return b;
    if (!b) return a;
    return Date.parse(a) >= Date.parse(b) ? a : b;
}

export function resolveReliabilityScope({ days = 30, extensionVersion, adapterVersion, allVersions = false, since, portalKind, includeSynthetic = false } = {}) {
    const boundedDays = Math.max(1, Math.min(365, Number(days) || 30));
    const version = String(extensionVersion || currentExtensionVersion());
    const windowStartedAt = new Date(Date.now() - boundedDays * DAY_MS).toISOString();
    let baselineStartedAt = validDate(since);
    if (!allVersions && !baselineStartedAt) {
        baselineStartedAt = validDate(getSetting(`reliability.baseline.${version}`, ""));
        if (!baselineStartedAt) {
            const first = getDb().prepare(`SELECT MIN(created_at) AS startedAt
                FROM application_field_evidence WHERE extension_version = ?`).get(version)?.startedAt;
            baselineStartedAt = validDate(first) || new Date().toISOString();
        }
    }
    return {
        days: boundedDays,
        mode: allVersions ? "HISTORICAL" : "CURRENT_BUILD",
        extensionVersion: allVersions ? null : version,
        adapterVersion: adapterVersion ? String(adapterVersion).slice(0, 80) : null,
        portalKind: portalKind ? String(portalKind).toLowerCase().slice(0, 80) : null,
        includeSynthetic: includeSynthetic === true,
        baselineStartedAt: laterDate(windowStartedAt, baselineStartedAt || windowStartedAt),
        requestedBaselineStartedAt: baselineStartedAt,
        windowStartedAt
    };
}

export function scopedSql(scope, {
    alias = "e", timeColumn = "updated_at", versionColumn = "extension_version", portalColumn = "portal_kind",
    adapterVersionColumn = "adapter_version", urlColumn = "page_url"
} = {}) {
    const clauses = [`${alias}.${timeColumn} >= datetime(?)`];
    const params = [scope.baselineStartedAt];
    if (scope.extensionVersion && versionColumn) {
        clauses.push(`${alias}.${versionColumn} = ?`);
        params.push(scope.extensionVersion);
    }
    if (scope.portalKind && portalColumn) {
        clauses.push(`${alias}.${portalColumn} = ?`);
        params.push(scope.portalKind);
    }
    if (scope.adapterVersion && adapterVersionColumn) {
        clauses.push(`${alias}.${adapterVersionColumn} = ?`);
        params.push(scope.adapterVersion);
    }
    if (!scope.includeSynthetic && urlColumn) {
        clauses.push(`LOWER(${alias}.${urlColumn}) NOT LIKE 'http://localhost:%'`);
        clauses.push(`LOWER(${alias}.${urlColumn}) NOT LIKE 'https://localhost:%'`);
        clauses.push(`LOWER(${alias}.${urlColumn}) NOT LIKE 'http://127.0.0.1:%'`);
        clauses.push(`LOWER(${alias}.${urlColumn}) NOT LIKE 'https://127.0.0.1:%'`);
        clauses.push(`LOWER(${alias}.${urlColumn}) NOT LIKE '%.invalid%'`);
    }
    return { clause: clauses.join(" AND "), params };
}

export function resetCurrentReliabilityBaseline({ extensionVersion = currentExtensionVersion(), at = new Date().toISOString() } = {}) {
    const timestamp = validDate(at);
    if (!timestamp) throw new Error("A valid reliability baseline timestamp is required.");
    setSetting(`reliability.baseline.${extensionVersion}`, timestamp);
    return resolveReliabilityScope({ extensionVersion, since: timestamp });
}
