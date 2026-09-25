// Boot the kernel and serve the API. Zero keys needed: MockLLM + LocalSandbox by default.
import { Kernel } from "@kernelagent/kernel";
import { createModelClient } from "@kernelagent/llm";
import { Worker } from "@kernelagent/runtime";
import { createSandbox } from "@kernelagent/sandbox";
import { buildServer } from "./server.ts";

const llm = await createModelClient();
const sandbox = await createSandbox();
const kernel = new Kernel({ llm, sandbox });
kernel.attachRunner(new Worker(kernel));
kernel.start();

const app = await buildServer(kernel, { logger: true });
const port = Number(process.env.PORT ?? 4000);
await app.listen({ port, host: process.env.HOST ?? "127.0.0.1" });
console.log(`[kernelagent] api on :${port} llm=${llm.provider}/${llm.model} db=${kernel.config.dbPath}`);

const shutdown = async () => {
  await app.close();
  await kernel.stop();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
