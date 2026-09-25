import { describe, expect, it } from "vitest";
import { buildServer } from "@kernelagent/api";
import { makeKernel } from "./helpers.ts";

describe("artifacts", () => {
  it("keeps /output files after the sandbox is destroyed and serves them over the API", async () => {
    const { kernel, sandbox } = makeKernel({
      mock: {
        scripts: {
          writer: [
            { tool: "FS_WRITE", input: { path: "/output/report.md", content: "# Texas\n\nHello." } },
            { tool: "EXEC", input: { cmd: "mkdir -p output/img && printf '\\x89PNG' > output/img/logo.png && echo scratch > notes.txt" } },
            { tool: "EXIT", input: { result: "Report written to /output/report.md" } },
          ],
        },
      },
    });
    kernel.start();
    const { jobId, pids } = kernel.submitJob({
      process: { role: "writer", goal: "write a report", capabilities: [{ type: "FS_WRITE" }, { type: "EXEC" }] },
    });
    await kernel.waitForJob(jobId);
    await kernel.stop();

    const list = kernel.repos.artifacts.list({ jobId });
    expect(list.map((a) => [a.pid, a.path, a.mime])).toEqual([
      [pids.p0, "img/logo.png", "image/png"],
      [pids.p0, "report.md", "text/markdown; charset=utf-8"],
    ]);
    expect(sandbox.list()).toEqual([]);
    expect(kernel.bus.getEvents({ jobId }).filter((e) => e.type === "ARTIFACT")).toHaveLength(2);

    const app = await buildServer(kernel);
    const listed = (await app.inject({ method: "GET", url: `/artifacts?jobId=${jobId}` })).json();
    expect(listed.artifacts).toHaveLength(2);
    const md = list.find((a) => a.path === "report.md")!;
    const res = await app.inject({ method: "GET", url: `/artifacts/${md.id}` });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/markdown");
    expect(res.headers["content-disposition"]).toContain('filename="report.md"');
    expect(res.body).toBe("# Texas\n\nHello.");
    expect((await app.inject({ method: "GET", url: "/artifacts/9999" })).statusCode).toBe(404);
    await app.close();
  });
});
