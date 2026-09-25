import { describe, expect, it } from "vitest";
import { createRepositories } from "@kernelagent/db";
import { EventBus, IllegalTransitionError, ProcessManager, TRANSITIONS, type ProcessStatus } from "@kernelagent/kernel";

function setup() {
  const repos = createRepositories(":memory:");
  const bus = new EventBus(repos.events);
  const pm = new ProcessManager(bus, repos.processes);
  const p = pm.create({
    pid: "1",
    jobId: "job",
    role: "r",
    goal: "g",
    priority: 0,
    tokenBudget: 100,
    capabilities: [],
    dependsOn: [],
    maxRetries: 2,
    timeoutMs: 1000,
  });
  return { repos, bus, pm, p };
}

const ALL: ProcessStatus[] = ["NEW", "READY", "RUNNING", "WAITING", "TERMINATED", "FAILED"];

// Drive a fresh process into a given state along legal edges.
const PATH: Record<ProcessStatus, ProcessStatus[]> = {
  NEW: [],
  READY: ["READY"],
  RUNNING: ["READY", "RUNNING"],
  WAITING: ["READY", "RUNNING", "WAITING"],
  TERMINATED: ["READY", "RUNNING", "TERMINATED"],
  FAILED: ["READY", "RUNNING", "FAILED"],
};

describe("process state machine", () => {
  it("follows the brief's core transitions", () => {
    const { pm } = setup();
    for (const s of ["READY", "RUNNING", "WAITING", "READY", "RUNNING", "FAILED", "READY", "RUNNING", "TERMINATED"] as const) {
      pm.transition("1", s);
    }
    expect(pm.get("1")?.status).toBe("TERMINATED");
  });

  for (const from of ALL) {
    for (const to of ALL) {
      const legal = TRANSITIONS[from].includes(to);
      it(`${from} -> ${to} is ${legal ? "legal" : "illegal"}`, () => {
        const { pm } = setup();
        for (const s of PATH[from]) pm.transition("1", s);
        if (legal) expect(pm.transition("1", to).status).toBe(to);
        else expect(() => pm.transition("1", to)).toThrow(IllegalTransitionError);
      });
    }
  }

  it("emits a STATE_CHANGE event per transition and persists status", () => {
    const { pm, bus, repos } = setup();
    pm.transition("1", "READY", { reason: "test" });
    pm.transition("1", "RUNNING");
    const changes = bus.getEvents({ jobId: "job" }).filter((e) => e.type === "STATE_CHANGE");
    expect(changes.map((e) => e.payload)).toEqual([
      { from: "NEW", to: "READY", reason: "test" },
      { from: "READY", to: "RUNNING" },
    ]);
    expect(repos.processes.get("1")?.status).toBe("RUNNING");
  });

  it("refuses to change status through update()", () => {
    const { pm } = setup();
    expect(() => pm.update("1", { status: "READY" } as never)).toThrow();
  });
});
