const statusNode = document.getElementById("status");
const apiInput = document.getElementById("api");
const actionsNode = document.getElementById("actions");
const pauseBtn = document.getElementById("pause-btn");
const unlinkBtn = document.getElementById("unlink-btn");
const processBtn = document.getElementById("process");
const confirmSubmittedBtn = document.getElementById("confirm-submitted");

let isPaused = false;

function status(text, kind = "") {
    statusNode.textContent = text;
    statusNode.className = `status ${kind}`;
}

async function activeTab() {
    return (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
}

async function tabAction(type) {
    try {
        status("Working…");
        const tab = await activeTab();
        const response = await chrome.tabs.sendMessage(tab.id, { type });
        if (!response?.ok) throw new Error(response?.error || "The page did not accept the request.");
        status("Action started in the current tab.", "success");
    } catch (error) {
        status(`${error.message} Reload the job page after installing the extension.`, "error");
    }
}

document.getElementById("filled").addEventListener("click", () => {
    if (confirm("You are marking this form ready without automated validation. Confirm that you reviewed all required fields.")) tabAction("MARK_FILLED");
});
processBtn.addEventListener("click", () => tabAction("FILL_PAGE"));
confirmSubmittedBtn.addEventListener("click", () => tabAction("CONFIRM_SUBMISSION"));
document.getElementById("replay").addEventListener("click", () => tabAction("TEST_LEARNED_AUTOFILL"));
document.getElementById("open-sidecar").addEventListener("click", async () => {
    try {
        const tab = await activeTab();
        await chrome.sidePanel.open({ tabId: tab.id });
        window.close();
    } catch (error) { status(error.message || "Could not open the sidecar.", "error"); }
});
document.getElementById("dashboard").addEventListener("click", async () => chrome.tabs.create({ url: `${apiInput.value.replace(/\/$/, "")}/copilot` }));
document.getElementById("save").addEventListener("click", () => chrome.runtime.sendMessage({ type: "SET_API_BASE", apiBase: apiInput.value }, (response) => status(response?.ok ? "Connection saved." : response?.error || "Could not save.", response?.ok ? "success" : "error")));

pauseBtn.addEventListener("click", async () => {
    isPaused = !isPaused;
    const response = await chrome.runtime.sendMessage({ type: isPaused ? "PAUSE_COPILOT" : "RESUME_COPILOT" });
    pauseBtn.textContent = isPaused ? "▶️ Resume" : "⏸️ Pause";
    status(isPaused ? "COPILOT paused." : "COPILOT resumed.", "success");
});

unlinkBtn.addEventListener("click", async () => {
    if (confirm("Unlink COPILOT from this job session?")) {
        await chrome.runtime.sendMessage({ type: "UNLINK_SESSION" });
        actionsNode.style.display = "none";
        status("Session unlinked. Open a qualified job from the dashboard.", "normal");
    }
});

chrome.runtime.sendMessage({ type: "GET_EXTENSION_STATE" }, (response) => {
    if (!response?.ok) return status(response?.error || "Backend unavailable.", "error");
    apiInput.value = response.result.apiBase;
    const job = response.result.activeJob;
    const application = response.result.activeApplication;
    isPaused = Boolean(response.result.isPaused);
    pauseBtn.textContent = isPaused ? "▶️ Resume" : "⏸️ Pause";
    if (job) {
        actionsNode.style.display = "flex";
        processBtn.style.display = "block";
        confirmSubmittedBtn.style.display = response.result.pendingSubmission?.jobId === job.id ? "block" : "none";
        status(`${job.title} · ${job.company}${application?.status ? ` · ${application.status}` : ""}${isPaused ? " (Paused)" : ""}`);
    } else {
        actionsNode.style.display = "none";
        processBtn.style.display = "none";
        confirmSubmittedBtn.style.display = "none";
        status("Open a qualified job from the dashboard.");
    }
});
