import { readFile } from "node:fs/promises";
import { OperatorProvisionSchema } from "@job-hunter-v2/contracts";

// Token is provided through environment, never command arguments or command-file content.
const path = process.argv[2];
if (!path || !process.env.OPERATOR_ACCESS_TOKEN || !process.env.OPERATOR_API_ORIGIN) throw new Error("Provide command.json, OPERATOR_ACCESS_TOKEN and OPERATOR_API_ORIGIN.");
const origin = new URL(process.env.OPERATOR_API_ORIGIN);
if (origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash || (origin.protocol !== "https:" && !(origin.protocol === "http:" && ["127.0.0.1","localhost","[::1]"].includes(origin.hostname)))) throw new Error("Use an HTTPS API origin or local loopback origin.");
const command = OperatorProvisionSchema.parse(JSON.parse(await readFile(path,"utf8")));
const response = await fetch(new URL("/v1/operator/roles",origin),{method:"POST",redirect:"error",signal:AbortSignal.timeout(15_000),headers:{authorization:`Bearer ${process.env.OPERATOR_ACCESS_TOKEN}`,"content-type":"application/json"},body:JSON.stringify(command)});
if (!response.ok) throw new Error(`Operator command rejected (HTTP ${response.status}); no credentials or response payload printed.`);
console.log("Operator provisioning command acknowledged. Reuse the same requestId for retries.");
