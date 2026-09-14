import { spawn } from "node:child_process";

const port = 32107;
const child = spawn(process.execPath, ["src/server.js"], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"]
});

let output = "";
child.stdout.on("data", (chunk) => { output += chunk; });
child.stderr.on("data", (chunk) => { output += chunk; });

async function check() {
    for (let attempt = 0; attempt < 25; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 200));
        try {
            const response = await fetch(`http://127.0.0.1:${port}/health`);
            const body = await response.json();
            if (response.ok && body.ok) return;
        } catch {
            // Server is still booting.
        }
    }
    throw new Error(`Health endpoint did not become ready.\n${output}`);
}

async function checkPage(pathname, expectedText) {
    const response = await fetch(`http://127.0.0.1:${port}${pathname}`);
    const body = await response.text();
    if (!response.ok || !body.includes(expectedText)) {
        throw new Error(`${pathname} did not render the expected local UI (${response.status}).\n${output}`);
    }
}

try {
    await check();
    await checkPage("/onboarding", "Your application workspace");
    await checkPage("/admin/reliability", "Reliability dashboard");
    console.log(`Startup check passed: health, onboarding, and reliability UI on http://127.0.0.1:${port}`);
} finally {
    child.kill("SIGTERM");
}
