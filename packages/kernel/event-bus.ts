// Event bus + append-only event log. The log is the source of truth.
// emit() writes to SQLite synchronously (which assigns the monotonic sequence),
// then fans the event out to subscribers (WS broadcaster, telemetry, kernel hooks).
import type { EventQuery, EventRepo } from "@kernelagent/db";
import type { KernelEvent, KernelEventType } from "./types.ts";

export type EventListener = (e: KernelEvent) => void;

export class EventBus {
  private listeners = new Set<EventListener>();

  constructor(
    private repo: EventRepo,
    private now: () => number = Date.now,
  ) {}

  emit<P>(type: KernelEventType, jobId: string, pid: string | undefined, payload: P, at?: number): KernelEvent<P> {
    const timestamp = at ?? this.now();
    const sequence = this.repo.append({ jobId, ...(pid ? { pid } : {}), type, payload, timestamp });
    const event: KernelEvent<P> = { sequence, jobId, ...(pid ? { pid } : {}), type, payload, timestamp };
    for (const l of this.listeners) {
      try {
        l(event as KernelEvent);
      } catch (err) {
        // A broken subscriber must never corrupt the kernel.
        console.error("[event-bus] subscriber error", err);
      }
    }
    return event;
  }

  subscribe(l: EventListener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  getEvents(q: EventQuery = {}): KernelEvent[] {
    return this.repo.list(q) as KernelEvent[];
  }

  getEvent(sequence: number): KernelEvent | undefined {
    return this.repo.get(sequence) as KernelEvent | undefined;
  }

  lastSequence(): number {
    return this.repo.maxSequence();
  }
}
