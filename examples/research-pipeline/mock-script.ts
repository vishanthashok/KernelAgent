// Deterministic MockLLM scripts for the research-pipeline example.
// planner -> (IPC) -> researcher x2 -> (IPC + DAG edge) -> reviewer -> SPAWN fact-checker.
import type { MockContext, MockScript } from "@kernelagent/llm";

const QUESTIONS = [
  "How does cooperative scheduling decide when a task gives up the CPU, and what fails when a task never yields?",
  "What does preemptive scheduling need from hardware, and what does it cost in context switches and locking?",
];

const ANSWERS: Record<string, string> = {
  [QUESTIONS[0]!]:
    "Under cooperative scheduling a task runs until it yields, blocks, or exits. The scheduler only regains control at those points. One task that loops without yielding starves every other task. Early Mac OS and Windows 3.x worked this way, as do async runtimes today.",
  [QUESTIONS[1]!]:
    "Preemptive scheduling relies on a timer interrupt to take the CPU back at any instruction. That bounds latency for every task, but each switch saves and restores registers and pollutes caches. Shared data then needs locks, because a task can be interrupted mid-update.",
};

const peersWith = (ctx: MockContext, role: string) => ctx.peers.filter((p) => p.role === role).map((p) => p.pid);
const parse = (s: string | undefined) => {
  try {
    return JSON.parse(s ?? "{}") as Record<string, any>;
  } catch {
    return {};
  }
};

export const scripts: Record<string, MockScript> = {
  planner: [
    (ctx) => ({ text: "Splitting the report into two questions.", tool: "SEND", input: { to: peersWith(ctx, "researcher")[0]!, message: QUESTIONS[0]! } }),
    (ctx) => ({ tool: "SEND", input: { to: peersWith(ctx, "researcher")[1]!, message: QUESTIONS[1]! } }),
    { tool: "EXIT", input: { result: `Plan: (1) ${QUESTIONS[0]} (2) ${QUESTIONS[1]}` } },
  ],
  researcher: [
    { text: "Waiting for my question.", tool: "RECEIVE", input: {} },
    { tool: "SLEEP", input: { ms: 300 } },
    (ctx) => {
      const q = String(parse(ctx.messages[2] && (ctx.messages[2].content as any[])[0]?.content).message ?? "");
      return { tool: "SEND", input: { to: peersWith(ctx, "reviewer")[0]!, message: ANSWERS[q] ?? `No answer for: ${q}` } };
    },
    { tool: "EXIT", input: { result: "answer sent to reviewer" } },
  ],
  reviewer: [
    { tool: "RECEIVE", input: {} },
    { tool: "RECEIVE", input: {} },
    // First attempt asks for EXEC, which the reviewer does not hold: the kernel rejects the escalation.
    { text: "Spawning a fact-checker.", tool: "SPAWN", input: { role: "fact-checker", goal: "Check the answers", capabilities: [{ type: "EXEC" }] } },
    (ctx) => ({
      text: "Denied. Retrying with only SEND back to me.",
      tool: "SPAWN",
      input: { role: "fact-checker", goal: "Check both answers for factual errors and SEND a verdict to your parent.", capabilities: [{ type: "SEND", scope: ctx.pid }] },
    }),
    { tool: "RECEIVE", input: {} },
    (ctx) => {
      const answers = ctx.messages
        .flatMap((m) => (Array.isArray(m.content) ? m.content : []))
        .filter((b: any) => b.type === "tool_result" && !b.is_error)
        .map((b: any) => parse(b.content))
        .filter((r) => typeof r.message === "string" && r.from);
      const body = answers.map((a) => `- (pid ${a.from}) ${a.message}`).join("\n");
      return { tool: "FS_WRITE", input: { path: "/output/report.md", content: `# Cooperative vs preemptive scheduling\n\n${body}\n` } };
    },
    { tool: "CHECKPOINT", input: { note: "report written" } },
    {
      tool: "EXIT",
      input: {
        result:
          "Cooperative scheduling switches only when a task yields, so it is cheap but one greedy task stalls everyone. Preemptive scheduling uses timer interrupts to bound latency, at the cost of context switches and locking. Report written to /output/report.md and fact-checked.",
      },
    },
  ],
  "fact-checker": [
    { tool: "SLEEP", input: { ms: 200 } },
    (ctx) => {
      const parent = ctx.peers.find((p) => p.role === "reviewer")!.pid;
      return { tool: "SEND", input: { to: parent, message: "Verdict: both answers are accurate. No corrections." } };
    },
    { text: "verdict sent" },
  ],
};
