// Channel: delivers messages between processes and wakes blocked receivers.
// The kernel supplies the wake callback, so IPC stays independent of the process model.
import { Mailbox, type Message } from "./mailbox.ts";

export interface ChannelHooks {
  /** Called after a message is queued. Return true if a blocked receiver was woken. */
  onDeliver: (msg: Message) => boolean;
}

export class Channel {
  constructor(
    readonly mailbox: Mailbox,
    private hooks: ChannelHooks,
  ) {}

  send(jobId: string, fromPid: string, toPid: string, body: unknown): { message: Message; woke: boolean } {
    const message = this.mailbox.post(jobId, fromPid, toPid, body);
    const woke = this.hooks.onDeliver(message);
    return { message, woke };
  }

  /** Non-blocking receive. Blocking is the kernel's job (RECEIVE -> WAITING). */
  tryReceive(pid: string): Message | undefined {
    return this.mailbox.take(pid);
  }
}
