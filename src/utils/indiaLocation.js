/** Location priority for India search (lower index = higher priority). */
export const LOCATION_PRIORITY = [
    "remote",
    "gurugram",
    "gurgaon",
    "delhi",
    "noida",
    "pune",
    "hyderabad",
    "bengaluru",
    "bangalore"
];

const INDIA_HUBS = [
    "india",
    "bharat",
    "remote",
    "wfh",
    "work from home",
    "gurugram",
    "gurgaon",
    "delhi",
    "ncr",
    "noida",
    "pune",
    "hyderabad",
    "bengaluru",
    "bangalore",
    "mumbai",
    "chennai",
    "ahmedabad",
    "kochi",
    "trivandrum",
    "jaipur",
    "chandigarh",
    "kolkata"
];

const FOREIGN_MARKERS = [
    "united states",
    "usa",
    "u.s.",
    "san francisco",
    "new york",
    "seattle",
    "austin",
    "berkeley",
    "london",
    "united kingdom",
    "uk",
    "canada",
    "toronto",
    "montreal",
    "paris",
    "germany",
    "berlin",
    "netherlands",
    "israel",
    "australia",
    "singapore",
    "spain",
    "france",
    "korea",
    "nordics",
    "dutch",
    "german speaking",
    "bahasa"
];

const BACKEND_TITLE =
    /\b(backend|back-end|node\.?js|nodejs|sde|software engineer|software developer|platform engineer|api engineer|full.?stack|golang|java engineer|python engineer|distributed systems)\b/i;

const NON_TARGET_TITLE =
    /\b(recruiter|talent acquisition|account executive|account development|sales|counsel|marketing|frontend|front-end|ui developer|ux designer|product designer|internship)\b/i;

export function locationRank(location = "") {
    const text = String(location).toLowerCase();
    if (/\bremote\b/.test(text) && (/\bindia\b/.test(text) || !FOREIGN_MARKERS.some((m) => text.includes(m)))) {
        return 0;
    }
    for (let i = 0; i < LOCATION_PRIORITY.length; i += 1) {
        if (text.includes(LOCATION_PRIORITY[i])) return i;
    }
    return 80;
}

export function isIndiaLocation(location = "") {
    const text = String(location).toLowerCase();
    if (!text || text === "not specified" || text === "india") {
        return true;
    }
    const hasIndiaHub = INDIA_HUBS.some((hub) => text.includes(hub));
    const hasForeign = FOREIGN_MARKERS.some((marker) => text.includes(marker));
    if (hasIndiaHub && hasForeign) {
        return true;
    }
    if (hasForeign && !hasIndiaHub) {
        return false;
    }
    return hasIndiaHub;
}

export function isBackendishTitle(title = "") {
    const value = String(title);
    if (NON_TARGET_TITLE.test(value) && !BACKEND_TITLE.test(value)) {
        return false;
    }
    return BACKEND_TITLE.test(value) || /\b(engineer|developer|sde)\b/i.test(value);
}

export function locationLabel(location = "") {
    const text = String(location).toLowerCase();
    if (/\bremote\b/.test(text)) return "Remote";
    if (text.includes("gurugram") || text.includes("gurgaon")) return "Gurugram";
    if (text.includes("noida")) return "Noida";
    if (text.includes("delhi") || text.includes("ncr")) return "Delhi";
    if (text.includes("pune")) return "Pune";
    if (text.includes("hyderabad")) return "Hyderabad";
    if (text.includes("bengaluru") || text.includes("bangalore")) return "Bengaluru";
    return "Other (India)";
}
