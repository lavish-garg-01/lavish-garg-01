import crypto from "node:crypto";
import { getDb } from "../database/connection.js";
import { env } from "../config/environment.js";
import { LOCAL_USER_ID } from "../repositories/copilotRepository.js";

const COOKIE_NAME = "jh_local_session";
const SESSION_DAYS = 30;

function cookies(header = "") {
    return Object.fromEntries(String(header).split(";").map((part) => {
        const index = part.indexOf("=");
        if (index < 0) return ["", ""];
        return [part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim())];
    }).filter(([key]) => key));
}

function newLocalSession() {
    const id = crypto.randomBytes(32).toString("base64url");
    getDb().prepare(`INSERT INTO local_sessions (id, user_id, expires_at)
        VALUES (?, ?, datetime('now', '+' || ? || ' days'))`).run(id, LOCAL_USER_ID, SESSION_DAYS);
    return { id, userId: LOCAL_USER_ID };
}

function existingLocalSession(id) {
    if (!id) return null;
    const row = getDb().prepare(`SELECT id, user_id FROM local_sessions
        WHERE id = ? AND expires_at > CURRENT_TIMESTAMP`).get(id);
    if (!row) return null;
    getDb().prepare("UPDATE local_sessions SET last_seen_at = CURRENT_TIMESTAMP WHERE id = ?").run(id);
    return { id: row.id, userId: row.user_id };
}

export function requestIdentity(req, res, next) {
    // This is intentionally an adapter boundary. Local mode creates an opaque,
    // httpOnly device session; Supabase mode will verify a bearer token here.
    if (env.appMode !== "local") {
        return res.status(503).json({ error: "External authentication is not configured yet." });
    }
    const supplied = cookies(req.headers.cookie)[COOKIE_NAME];
    const session = existingLocalSession(supplied) || newLocalSession();
    if (session.id !== supplied) {
        res.append("Set-Cookie", `${COOKIE_NAME}=${encodeURIComponent(session.id)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_DAYS * 86400}`);
    }
    req.user = { id: session.userId, sessionId: session.id, mode: "local" };
    next();
}

export function localSessionSummary(req) {
    return {
        mode: req.user?.mode || "local",
        authenticated: true,
        requiresLogin: false,
        userId: req.user?.id || LOCAL_USER_ID,
        storage: "This machine"
    };
}

