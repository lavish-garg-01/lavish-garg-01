import fs from "node:fs";
import path from "node:path";

const projectRoot = path.resolve(import.meta.dirname, "..");
const sourceRoots = ["src", "extension"];
const files = sourceRoots.flatMap((root) => fs.readdirSync(path.join(projectRoot, root), { recursive: true })
    .filter((entry) => entry.endsWith(".js"))
    .map((entry) => path.resolve(projectRoot, root, entry)))
    .filter((file) => fs.statSync(file).isFile());
const fileSet = new Set(files);
const edges = new Map(files.map((file) => [file, []]));
const importPattern = /(?:import\s+(?:[^"'\n]+?\s+from\s+)?|export\s+[^"'\n]+?\s+from\s+|import\()\s*["']([^"']+)["']/g;

for (const file of files) {
    const source = fs.readFileSync(file, "utf8");
    for (const match of source.matchAll(importPattern)) {
        if (!match[1].startsWith(".")) continue;
        let target = path.resolve(path.dirname(file), match[1]);
        if (!path.extname(target)) target += ".js";
        if (fileSet.has(target)) edges.get(file).push(target);
    }
}

const seen = new Set();
const active = new Set();
const stack = [];
const cycles = new Map();
function visit(file) {
    seen.add(file);
    active.add(file);
    stack.push(file);
    for (const target of edges.get(file) || []) {
        if (!seen.has(target)) visit(target);
        else if (active.has(target)) {
            const start = stack.indexOf(target);
            const cycle = stack.slice(start).concat(target).map((item) => path.relative(projectRoot, item));
            cycles.set(cycle.join(" -> "), cycle);
        }
    }
    stack.pop();
    active.delete(file);
}
for (const file of files) if (!seen.has(file)) visit(file);

const fanIn = new Map(files.map((file) => [file, 0]));
for (const targets of edges.values()) for (const target of targets) fanIn.set(target, (fanIn.get(target) || 0) + 1);
const report = {
    files: files.length,
    internalEdges: [...edges.values()].reduce((total, targets) => total + targets.length, 0),
    cycles: [...cycles.values()],
    topFanIn: [...fanIn.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)
        .map(([file, count]) => ({ file: path.relative(projectRoot, file), count }))
};
console.log(JSON.stringify(report, null, 2));
if (report.cycles.length) process.exitCode = 1;
