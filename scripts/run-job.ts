// Drive one job to completion in-process and print its event log.
// Usage: pnpm run-job examples/hello-dag.json
import { readFileSync } from "node:fs";
import { createRepositories } from "@kernelagent/db";
import { Kernel } from "@kernelagent/kernel";
import { createModelClient } from "@kernelagent/llm";
import { Worker } from "@kernelagent/runtime";
import { createSandbox } from "@kernelagent/sandbox";
import { formatLog } from "./format-log.ts";

const file = process.argv[2];
if (!file) {
  console.error("usage: run-job <job-spec.json>");
  process.exit(1);
}
const spec = JSON.parse(readFileSync(file, "utf8"));
const llm = await createModelClient();
const sandbox = await createSandbox();
const kernel = new Kernel({ llm, sandbox, repos: createRepositories(process.env.KERNEL_DB_PATH ?? ":memory:") });
kernel.attachRunner(new Worker(kernel));
kernel.start();

const { jobId } = kernel.submitJob(spec);
const job = await kernel.waitForJob(jobId, 5 * 60_000);
await kernel.stop();

console.log(formatLog(kernel.bus.getEvents({ jobId, limit: 100_000 })));
console.log(`\njob ${jobId}: ${job.status}`);
for (const p of kernel.pm.list({ jobId })) {
  console.log(`  pid ${p.pid} ${p.role.padEnd(12)} ${p.status.padEnd(10)} tokens=${p.tokensUsed} cost=$${p.costUsd.toFixed(5)}`);
}
process.exit(job.status === "COMPLETED" ? 0 : 1);
