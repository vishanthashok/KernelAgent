// Boot the kernel and serve the API. Zero keys needed: MockLLM + LocalSandbox by default.
import { initTelemetry } from "@kernelagent/telemetry";
const telemetry = initTelemetry({ serviceName: "kernelagent-api" });

const { Kernel } = await import("@kernelagent/kernel");
const { apiModelEnv, createModelClient } = await import("@kernelagent/llm");
const { Worker } = await import("@kernelagent/runtime");
const { createSandbox } = await import("@kernelagent/sandbox");
const { buildServer } = await import("./server.ts");

// With the mock provider, load the example scripts so example jobs submitted over HTTP run
// their scripted syscalls. MOCK_LATENCY_MS slows the mock down so the console is watchable.
const { exampleScripts } = await import("../../examples/scripts.ts");
// Jobs run on the caller's own key. The server's keys are used only with ALLOW_SERVER_KEY=true.
const llm = await createModelClient(apiModelEnv(process.env), { scripts: exampleScripts, latencyMs: Number(process.env.MOCK_LATENCY_MS ?? 400) });
const sandbox = await createSandbox();
const kernel = new Kernel({ llm, sandbox });
kernel.attachRunner(new Worker(kernel));
kernel.start();

const app = await buildServer(kernel, {
  logger: process.env.API_LOG === "true",
  ...(process.env.KERNEL_DEV_TOKEN ? { devToken: process.env.KERNEL_DEV_TOKEN } : {}),
  ...(process.env.ACCOUNTS_SECRET ? { accountsSecret: process.env.ACCOUNTS_SECRET } : {}),
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
