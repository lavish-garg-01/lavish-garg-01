import { getDb } from '../src/database/index.js';

function normalizedUrl(raw = "") {
    try {
        const url = new URL(raw);
        url.hash = "";
        for (const key of [...url.searchParams.keys()]) {
            if (/^(?:utm_|trk|tracking|ref|source)/i.test(key)) url.searchParams.delete(key);
        }
        return `${url.hostname.toLowerCase()}${url.pathname.replace(/\/$/, "")}${url.search}`;
    } catch {
        return "";
    }
}

console.log("Without search:", `${new URL("https://www.deepwatch.com/current-job-openings-india/?gh_jid=4700641005").hostname}${new URL("https://www.deepwatch.com/current-job-openings-india/?gh_jid=4700641005").pathname}`);
console.log("With search:", normalizedUrl("https://www.deepwatch.com/current-job-openings-india/?gh_jid=4700641005"));
