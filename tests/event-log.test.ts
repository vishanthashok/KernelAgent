import { describe, expect, it } from "vitest";
import { createRepositories } from "@kernelagent/db";
import { EventBus } from "@kernelagent/kernel";

describe("event log", () => {
  it("assigns strictly increasing sequence numbers and fans out", () => {
    const repos = createRepositories(":memory:");
    const bus = new EventBus(repos.events);
    const seen: number[] = [];
    bus.subscribe((e) => seen.push(e.sequence));
    for (let i = 0; i < 20; i++) bus.emit("MESSAGE", "j", "1", { i });
    const seqs = bus.getEvents().map((e) => e.sequence);
    expect(seqs).toEqual(seen);
    for (let i = 1; i < seqs.length; i++) expect(seqs[i]!).toBeGreaterThan(seqs[i - 1]!);
  });

  it("is append-only at the storage layer", () => {
    const repos = createRepositories(":memory:");
    const bus = new EventBus(repos.events);
    bus.emit("MESSAGE", "j", undefined, {});
    expect(() => repos.db.prepare("UPDATE events SET type = 'X'").run()).toThrow(/append-only/);
    expect(() => repos.db.prepare("DELETE FROM events").run()).toThrow(/append-only/);
  });

  it("pages by sinceSeq and filters by job", () => {
    const repos = createRepositories(":memory:");
    const bus = new EventBus(repos.events);
    for (let i = 0; i < 5; i++) bus.emit("MESSAGE", i % 2 ? "a" : "b", undefined, { i });
    expect(bus.getEvents({ jobId: "a" }).length).toBe(2);
    expect(bus.getEvents({ sinceSeq: 3 }).map((e) => e.sequence)).toEqual([4, 5]);
    expect(bus.getEvents({ limit: 2 }).length).toBe(2);
  });

  it("survives a throwing subscriber", () => {
    const repos = createRepositories(":memory:");
    const bus = new EventBus(repos.events);
    bus.subscribe(() => {
      throw new Error("boom");
    });
    const orig = console.error;
    console.error = () => {};
    try {
      expect(bus.emit("MESSAGE", "j", undefined, {}).sequence).toBe(1);
    } finally {
      console.error = orig;
    }
  });
});
