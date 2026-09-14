import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BROWSER_SHARED_CONTRACT_RUNTIME } from "../src/contracts/browserValidatorTemplate.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const target = path.join(root, "extension/contracts/shared-contract-validator.js");
const output = `// Generated from src/contracts/browserValidatorTemplate.js. Do not edit by hand.\n${BROWSER_SHARED_CONTRACT_RUNTIME}`;

if (process.argv.includes("--check")) {
    if (!fs.existsSync(target) || fs.readFileSync(target, "utf8") !== output) {
        throw new Error("Extension shared-contract validator is stale. Run node scripts/generate_extension_contract_validator.js");
    }
    console.log("Extension shared-contract validator is synchronized.");
} else {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, output);
    console.log(`Generated ${path.relative(root, target)}`);
}

