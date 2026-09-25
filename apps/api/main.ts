// Boot the kernel and serve the API. Zero keys needed: MockLLM + LocalSandbox by default.
import { initTelemetry } from "@kernelagent/telemetry";
const telemetry = initTelemetry({ serviceName: "kernelagent-api" });

const { Kernel } = await import("@kernelagent/kernel");
const { createModelClient } = await import("@kernelagent/llm");
const { Worker } = await import("@kernelagent/runtime");
const { createSandbox } = await import("@kernelagent/sandbox");
const { buildServer } = await import("./server.ts");

const llm = await createModelClient();
const sandbox = await createSandbox();
const kernel = new Kernel({ llm, sandbox });
kernel.attachRunner(new Worker(kernel));
kernel.start();

const app = await buildServer(kernel, {
  logger: process.env.API_LOG === "true",
  ...(process.env.KERNEL_DEV_TOKEN ? { devToken: process.env.KERNEL_DEV_TOKEN } : {}),
});
const port = Number(process.env.PORT ?? 4000);
await app.listen({ port, host: process.env.HOST ?? "127.0.0.1" });
console.log(
  `[kernelagent] api http://localhost:${port}  llm=${llm.provider}/${llm.model}  sandbox=${sandbox.provider}  db=${kernel.config.dbPath}`,
);

const shutdown = async () => {
  await app.close();
  await kernel.stop();
  await telemetry.shutdown();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
