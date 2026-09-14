import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getDb } from "../database/connection.js";
import { hostFor, portalKindFor, resolvePortal } from "../adapters/registry.js";
import { boardSlugFromUrl, isPortalLevelHost, mergePacks, overlayKeysForUrl } from "../adapters/overlayKey.js";

const STAGES = new Set(["LOCAL_DRAFT", "SHADOW", "CANARY", "DEFAULT", "KILLED"]);
const PROMOTIONS = {
    LOCAL_DRAFT: "SHADOW",
    SHADOW: "CANARY",
    CANARY: "DEFAULT"
};
const PACK_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "adapters", "packs");

function text(value, max = 200) {
    return String(value == null ? "" : value).trim().slice(0, max);
}

function parsePack(value) {
    try { return JSON.parse(value || "{}"); } catch { return {}; }
}

function packId(portalKind, siteHost, version, stage) {
    return crypto.createHash("sha256").update(`${portalKind}|${siteHost}|${version}|${stage}`).digest("hex").slice(0, 32);
}

function publicPack(row) {
    if (!row) return null;
    return {
        id: row.id,
        portalKind: row.portal_kind,
        siteHost: row.site_host,
        version: Number(row.version),
        stage: row.stage,
        pack: parsePack(row.pack_json),
        parentVersion: row.parent_version == null ? null : Number(row.parent_version),
        promotedAt: row.promoted_at,
        killedAt: row.killed_at,
        killReason: row.kill_reason,
        createdAt: row.created_at
    };
}

export function seedDefaultMappingPacks() {
    const db = getDb();
    const files = fs.existsSync(PACK_DIR) ? fs.readdirSync(PACK_DIR).filter((name) => name.endsWith(".json")) : [];
    for (const file of files) {
        const pack = JSON.parse(fs.readFileSync(path.join(PACK_DIR, file), "utf8"));
        const portalKind = text(pack.portalKind || path.basename(file, ".json"), 80).toLowerCase() || "generic";
        const version = Number(pack.version) || 1;
        const stage = STAGES.has(String(pack.stage || "").toUpperCase()) ? String(pack.stage).toUpperCase() : "DEFAULT";
        const siteHost = portalKind === "generic" ? "*" : portalKind;
        const id = packId(portalKind, siteHost, version, stage);
        db.prepare(`
            INSERT INTO mapping_packs (id, portal_kind, site_host, version, stage, pack_json)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET pack_json = excluded.pack_json
        `).run(id, portalKind, siteHost, version, stage, JSON.stringify(pack));
    }
}

export function listMappingPacks({ portalKind = null } = {}) {
    const db = getDb();
    const rows = portalKind
        ? db.prepare("SELECT * FROM mapping_packs WHERE portal_kind = ? ORDER BY version DESC, created_at DESC").all(text(portalKind, 80).toLowerCase())
        : db.prepare("SELECT * FROM mapping_packs ORDER BY portal_kind, version DESC, created_at DESC").all();
    return rows.map(publicPack);
}

export function getMappingPack(id) {
    return publicPack(getDb().prepare("SELECT * FROM mapping_packs WHERE id = ?").get(id));
}

function latestFor(portalKind, stage, siteHost = null) {
    if (siteHost) {
        return getDb().prepare(`
            SELECT * FROM mapping_packs
            WHERE portal_kind = ? AND stage = ? AND LOWER(site_host) = LOWER(?)
            ORDER BY version DESC, created_at DESC LIMIT 1
        `).get(portalKind, stage, siteHost);
    }
    return latestPortalPack(portalKind, stage);
}

function latestPortalPack(portalKind, stage) {
    return getDb().prepare(`
        SELECT * FROM mapping_packs
        WHERE portal_kind = ? AND stage = ?
          AND (
            LOWER(site_host) = LOWER(?)
            OR (? = 'generic' AND site_host = '*')
          )
          AND INSTR(site_host, '.') = 0
          AND INSTR(site_host, '/') = 0
        ORDER BY version DESC, created_at DESC LIMIT 1
    `).get(portalKind, stage, portalKind, portalKind);
}

function nextPackVersion(portalKind) {
    const row = getDb().prepare("SELECT MAX(version) AS version FROM mapping_packs WHERE portal_kind = ?").get(portalKind);
    return (Number(row?.version) || 0) + 1;
}

const LIVE_STAGES = ["CANARY", "DEFAULT", "SHADOW", "LOCAL_DRAFT"];

function pickLivePack(portalKind, siteHost, { portalLevel = false } = {}) {
    for (const stage of LIVE_STAGES) {
        const row = portalLevel ? latestPortalPack(portalKind, stage) : latestFor(portalKind, stage, siteHost);
        if (row) return publicPack(row);
    }
    return null;
}

function emptyPack(portalKind) {
    return { portalKind, version: 1, stage: "DEFAULT", skipSelectors: [], neverFill: ["password", "otp", "captcha", "legal"] };
}

export function portalLevelPackForProposal(portalKind) {
    const kind = text(portalKind, 80).toLowerCase() || "generic";
    for (const stage of ["DEFAULT", "CANARY", "SHADOW", "LOCAL_DRAFT"]) {
        const row = latestPortalPack(kind, stage);
        if (row) return publicPack(row);
    }
    if (kind !== "generic") {
        const generic = latestPortalPack("generic", "DEFAULT");
        if (generic) return publicPack(generic);
    }
    return null;
}

export function activeMappingPackForHost(hostnameOrUrl = "") {
    const resolved = resolvePortal(hostnameOrUrl);
    const portalKind = resolved.portalKind;
    const hostname = (hostFor(hostnameOrUrl) || resolved.hostname || "").replace(/^www\./, "");
    const overlayKeys = overlayKeysForUrl(hostnameOrUrl, portalKind);
    const killedFlag = getDb().prepare("SELECT enabled FROM feature_flags WHERE key = ?").get(`kill.adapter.${portalKind}`);
    const killedPack = latestPortalPack(portalKind, "KILLED") || latestFor(portalKind, "KILLED", portalKind);
    const killed = Boolean(killedPack) || Number(killedFlag?.enabled) === 1;
    const genericPack = pickLivePack("generic", "*", { portalLevel: true });
    const fallbackPack = genericPack?.pack || emptyPack(portalKind);

    if (killed) {
        return {
            portalKind,
            hostname,
            adapterVersion: resolved.version,
            killed: true,
            killReason: killedPack?.kill_reason || "Portal kill switch is on.",
            stage: "KILLED",
            mappingPackId: genericPack?.id || null,
            version: genericPack?.version || 1,
            pack: fallbackPack,
            overlayKeys
        };
    }

    const portalPack = portalKind === "generic"
        ? genericPack
        : pickLivePack(portalKind, portalKind, { portalLevel: true });
    const slug = boardSlugFromUrl(hostnameOrUrl, portalKind);
    const hostPack = hostname && !isPortalLevelHost(hostname, portalKind)
        ? pickLivePack(portalKind, hostname)
        : null;
    const slugKey = slug ? `${hostname}/${slug}` : "";
    const slugPack = slugKey ? pickLivePack(portalKind, slugKey) : null;
    const top = slugPack || hostPack || portalPack || genericPack;
    const merged = mergePacks(
        genericPack?.pack,
        portalKind === "generic" ? null : portalPack?.pack,
        hostPack?.pack,
        slugPack?.pack
    );

    return {
        portalKind,
        hostname,
        adapterVersion: resolved.version,
        killed: false,
        killReason: null,
        stage: top?.stage || "DEFAULT",
        mappingPackId: top?.id || null,
        version: top?.version || 1,
        pack: {
            ...merged,
            portalKind,
            version: top?.version || merged.version || 1,
            stage: top?.stage || merged.stage || "DEFAULT"
        },
        overlayKeys
    };
}

export function saveLocalDraftPack({ portalKind, siteHost, pack, parentVersion = null }) {
    const kind = text(portalKind || portalKindFor(siteHost), 80).toLowerCase();
    const host = text(siteHost || kind, 200) || kind;
    const current = latestPortalPack(kind, "DEFAULT") || latestPortalPack(kind, "CANARY")
        || latestPortalPack(kind, "SHADOW") || latestPortalPack(kind, "LOCAL_DRAFT");
    const version = nextPackVersion(kind);
    const id = packId(kind, host, version, "LOCAL_DRAFT");
    getDb().prepare(`
        INSERT INTO mapping_packs (id, portal_kind, site_host, version, stage, pack_json, parent_version)
        VALUES (?, ?, ?, ?, 'LOCAL_DRAFT', ?, ?)
    `).run(id, kind, host, version, JSON.stringify(pack || {}), parentVersion == null ? current?.version ?? null : Number(parentVersion));
    return getMappingPack(id);
}

export function promoteMappingPack(id, { gate = {}, actor = "local-admin" } = {}) {
    const pack = getMappingPack(id);
    if (!pack) throw new Error("Mapping pack not found.");
    if (pack.stage === "KILLED") throw new Error("A killed pack cannot be promoted.");
    const nextStage = PROMOTIONS[pack.stage];
    if (!nextStage) throw new Error("This pack is already at the highest promotion stage.");
    if (pack.stage === "SHADOW") {
        const status = String(gate.formAGate || gate.status || "").toUpperCase();
        if (status !== "PASS") {
            throw new Error("Form A must PASS before a pack can leave shadow.");
        }
    }
    const nextId = packId(pack.portalKind, pack.siteHost, pack.version, nextStage);
    const db = getDb();
    db.prepare(`
        INSERT INTO mapping_packs (id, portal_kind, site_host, version, stage, pack_json, parent_version, promoted_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(id) DO UPDATE SET pack_json = excluded.pack_json, promoted_at = CURRENT_TIMESTAMP
    `).run(nextId, pack.portalKind, pack.siteHost, pack.version, nextStage, JSON.stringify(pack.pack), pack.version);
    db.prepare(`
        INSERT INTO mapping_promotions (id, mapping_pack_id, from_stage, to_stage, gate_json)
        VALUES (?, ?, ?, ?, ?)
    `).run(crypto.randomUUID(), nextId, pack.stage, nextStage, JSON.stringify({ ...gate, actor }));
    return getMappingPack(nextId);
}

export function killPortalAdapter(portalKind, reason = "Manual kill switch") {
    const kind = text(portalKind, 80).toLowerCase();
    if (!kind) throw new Error("Portal kind is required.");
    const current = latestFor(kind, "DEFAULT") || latestFor(kind, "CANARY") || latestFor(kind, "SHADOW") || latestFor(kind, "LOCAL_DRAFT");
    const version = Number(current?.version) || 1;
    const id = packId(kind, kind, version, "KILLED");
    const db = getDb();
    db.prepare(`
        INSERT INTO mapping_packs (id, portal_kind, site_host, version, stage, pack_json, killed_at, kill_reason)
        VALUES (?, ?, ?, ?, 'KILLED', ?, CURRENT_TIMESTAMP, ?)
        ON CONFLICT(id) DO UPDATE SET killed_at = CURRENT_TIMESTAMP, kill_reason = excluded.kill_reason
    `).run(id, kind, kind, version, JSON.stringify(current?.pack_json ? parsePack(current.pack_json) : { portalKind: kind }), text(reason, 500));
    db.prepare(`
        INSERT INTO feature_flags (key, enabled, scope, portal_kind, payload_json, updated_at)
        VALUES (?, 1, 'adapter', ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(key) DO UPDATE SET enabled = 1, payload_json = excluded.payload_json, updated_at = CURRENT_TIMESTAMP
    `).run(`kill.adapter.${kind}`, kind, JSON.stringify({ reason: text(reason, 500) }));
    return getMappingPack(id);
}

export function revivePortalAdapter(portalKind) {
    const kind = text(portalKind, 80).toLowerCase();
    const db = getDb();
    db.prepare("DELETE FROM mapping_packs WHERE portal_kind = ? AND stage = 'KILLED'").run(kind);
    db.prepare("UPDATE feature_flags SET enabled = 0, updated_at = CURRENT_TIMESTAMP WHERE key = ?").run(`kill.adapter.${kind}`);
    return activeMappingPackForHost(kind);
}
