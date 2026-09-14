/** Major job boards and ATS families shown as application tags. */

const PLATFORMS = [
    { id: "linkedin", label: "LinkedIn", hosts: ["linkedin.com"], sources: ["linkedin"] },
    { id: "indeed", label: "Indeed", hosts: ["indeed.com"], sources: ["indeed"] },
    { id: "naukri", label: "Naukri", hosts: ["naukri.com"], sources: ["naukri"] },
    { id: "wellfound", label: "Wellfound", hosts: ["wellfound.com", "angel.co"], sources: ["wellfound"] },
    { id: "instahyre", label: "Instahyre", hosts: ["instahyre.com"], sources: ["instahyre"] },
    { id: "hirist", label: "Hirist", hosts: ["hirist.com", "hirist.tech"], sources: ["hirist"] },
    { id: "cutshort", label: "Cutshort", hosts: ["cutshort.io"], sources: ["cutshort"] },
    { id: "greenhouse", label: "Greenhouse", hosts: ["greenhouse.io"], sources: ["greenhouse"] },
    { id: "lever", label: "Lever", hosts: ["lever.co"], sources: ["lever"] },
    { id: "ashby", label: "Ashby", hosts: ["ashbyhq.com"], sources: ["ashby"] },
    { id: "smartrecruiters", label: "SmartRecruiters", hosts: ["smartrecruiters.com"], sources: ["smartrecruiters"] },
    { id: "workday", label: "Workday", hosts: ["myworkdayjobs.com", "workday.com"], sources: ["workday"] },
    { id: "rippling", label: "Rippling", hosts: ["rippling.com"], sources: ["rippling"] },
    { id: "keka", label: "Keka", hosts: ["keka.com"], sources: ["keka"] }
];

const BADGE_CLASS = {
    linkedin: "bg-[#0a66c2] text-white",
    indeed: "bg-[#2164f3] text-white",
    naukri: "bg-[#2557a7] text-white",
    wellfound: "bg-zinc-900 text-white",
    instahyre: "bg-emerald-700 text-white",
    hirist: "bg-orange-600 text-white",
    cutshort: "bg-indigo-700 text-white",
    greenhouse: "bg-green-800 text-white",
    lever: "bg-sky-800 text-white",
    ashby: "bg-violet-800 text-white",
    smartrecruiters: "bg-blue-800 text-white",
    workday: "bg-orange-800 text-white",
    rippling: "bg-slate-800 text-white",
    keka: "bg-teal-800 text-white"
};

function hostnameOf(value = "") {
    try {
        return new URL(String(value || "")).hostname.replace(/^www\./, "").toLowerCase();
    } catch {
        return "";
    }
}

function hostMatches(hostname, pattern) {
    return hostname === pattern || hostname.endsWith(`.${pattern}`);
}

export function listJobPlatforms() {
    return PLATFORMS.map((platform) => ({ ...platform, hosts: [...platform.hosts] }));
}

export function jobPlatform(job = {}) {
    const source = String(job.source || "").trim().toLowerCase();
    const hostname = hostnameOf(job.url || job.currentUrl || job.pageUrl || "");
    const byHost = hostname
        ? PLATFORMS.find((platform) => platform.hosts.some((host) => hostMatches(hostname, host)))
        : null;
    if (byHost) return { id: byHost.id, label: byHost.label };
    const bySource = PLATFORMS.find((platform) => platform.sources.includes(source));
    if (bySource) return { id: bySource.id, label: bySource.label };
    return null;
}

export function platformBadgeClass(platformOrId) {
    const id = typeof platformOrId === "string" ? platformOrId : platformOrId?.id;
    return BADGE_CLASS[id] || "bg-slate-700 text-white";
}
