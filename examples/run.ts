// Run an example workload in-process and print its event log.
//   pnpm example:coding            (MockLLM + LocalSandbox, no keys)
//   LLM_PROVIDER=anthropic ANTHROPIC_API_KEY=... pnpm example:research
import { readFileSync } from "node:fs";
import { createRepositories } from "@kernelagent/db";
import { Kernel } from "@kernelagent/kernel";
import { createModelClient } from "@kernelagent/llm";
import { Worker } from "@kernelagent/runtime";
import { createSandbox } from "@kernelagent/sandbox";
import { formatLog } from "../scripts/format-log.ts";
import { exampleScripts } from "./scripts.ts";

const name = process.argv[2];
if (!name) {
  console.error("usage: tsx examples/run.ts <coding-task|research-pipeline>");
  process.exit(1);
}
const spec = JSON.parse(readFileSync(new URL(`./${name}/job.json`, import.meta.url), "utf8"));
const llm = await createModelClient(process.env, { scripts: exampleScripts, latencyMs: Number(process.env.MOCK_LATENCY_MS ?? 0) });
const sandbox = await createSandbox();
const kernel = new Kernel({ llm, sandbox, repos: createRepositories(process.env.KERNEL_DB_PATH ?? ":memory:") });
kernel.attachRunner(new Worker(kernel));
kernel.start();

console.log(`running ${name} with llm=${llm.provider}/${llm.model} sandbox=${sandbox.provider}\n`);
const { jobId } = kernel.submitJob(spec);
const job = await kernel.waitForJob(jobId, 10 * 60_000);
await kernel.stop();

console.log(formatLog(kernel.bus.getEvents({ jobId, limit: 100_000 })));
console.log(`\njob ${jobId}: ${job.status}`);
for (const p of kernel.pm.list({ jobId })) {
  console.log(`  pid ${p.pid} ${p.role.padEnd(13)} ${p.status.padEnd(10)} tokens=${String(p.tokensUsed).padStart(6)} cost=$${p.costUsd.toFixed(5)}`);
  if (p.result) console.log(`      result: ${p.result.replace(/\n/g, " ").slice(0, 160)}`);
}
process.exit(job.status === "COMPLETED" ? 0 : 1);
