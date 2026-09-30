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
// A deployed server is shared by everyone. Railway, Render, and Fly set these; so does NODE_ENV.
const env = process.env;
const deployed = env.NODE_ENV === "production" || !!(env.RAILWAY_ENVIRONMENT || env.RAILWAY_ENVIRONMENT_NAME || env.RENDER || env.FLY_APP_NAME);
// The local sandbox runs commands as this server's own user, so on a shared server a command
// could read the database and the secrets. There, EXEC needs E2B unless explicitly allowed.
const allowExec = !deployed || env.ALLOW_LOCAL_EXEC === "true";
const sandbox = await createSandbox(env, { allowExec });
const kernel = new Kernel({ llm, sandbox });
kernel.attachRunner(new Worker(kernel));
kernel.start();

const app = await buildServer(kernel, {
  logger: process.env.API_LOG === "true",
  ...(process.env.KERNEL_DEV_TOKEN ? { devToken: process.env.KERNEL_DEV_TOKEN } : {}),
  ...(process.env.ACCOUNTS_SECRET ? { accountsSecret: process.env.ACCOUNTS_SECRET } : {}),
  // Without accounts, every visitor would see every job. A deployed API refuses to serve
  // data that way unless OPEN_API=true says it is meant to be public.
  ...(deployed && !env.ACCOUNTS_SECRET && env.OPEN_API !== "true"
    ? { locked: "This server is not set up for accounts yet. Set ACCOUNTS_SECRET on the API and the console." }
    : {}),
  ...(env.ALLOWED_ORIGINS ? { allowedOrigins: env.ALLOWED_ORIGINS.split(",").map((o) => o.trim()).filter(Boolean) } : {}),
});
const port = Number(process.env.PORT ?? 4000);
await app.listen({ port, host: process.env.HOST ?? "127.0.0.1" });
console.log(
  `[kernelagent] api http://localhost:${port}  llm=${llm.provider}/${llm.model}  sandbox=${sandbox.provider}${sandbox.provider === "local" && !allowExec ? " (exec off)" : ""}  db=${kernel.config.dbPath}  accounts=${env.ACCOUNTS_SECRET ? "on" : "off"}`,
);
if (deployed && !env.ACCOUNTS_SECRET && env.OPEN_API !== "true") console.warn("[kernelagent] no ACCOUNTS_SECRET: the API is locked. Only /health answers.");

const shutdown = async () => {
  await app.close();
  await kernel.stop();
  await telemetry.shutdown();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
