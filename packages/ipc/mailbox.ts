// Mailbox: a per-pid FIFO queue of messages backed by the messages table.
import type { MessageRecord, MessageRepo } from "@kernelagent/db";

export type Message = MessageRecord;

export class Mailbox {
  constructor(
    private repo: MessageRepo,
    private now: () => number = Date.now,
  ) {}

  post(jobId: string, fromPid: string, toPid: string, body: unknown): Message {
    return this.repo.insert({ jobId, fromPid, toPid, body, createdAt: this.now() });
  }

  /** Take the oldest undelivered message for pid, or undefined if the mailbox is empty. */
  take(pid: string): Message | undefined {
    return this.repo.take(pid);
  }

  pending(pid: string): number {
    return this.repo.pendingCount(pid);
  }

  list(q: { jobId?: string; pid?: string } = {}): Message[] {
    return this.repo.list(q);
  }
}
