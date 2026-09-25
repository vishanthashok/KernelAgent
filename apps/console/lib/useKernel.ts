"use client";
// Live kernel state for the console. Everything is derived by folding the WS event stream
// with the same reducer the kernel's replay test uses. The console never polls for state.
import { useEffect, useRef, useState } from "react";
import type { KernelEvent } from "@kernelagent/kernel/types";
import { applyEvent, type ReplayedProcess } from "@kernelagent/kernel/replay";
import { api, wsUrl, type Stats } from "./api";

export interface JobInfo {
  id: string;
  name?: string;
  submittedAt: number;
  firstSeq: number;
}

export interface IpcMessage {
  id: number;
  jobId: string;
  from: string;
  to: string;
  body: string;
  sentAt: number;
  sequence: number;
  receivedAt?: number;
}

export interface Artifact {
  id: number;
  jobId: string;
  pid: string;
  path: string;
  mime: string;
  size: number;
}

export interface KernelState {
  connected: boolean;
  stats?: Stats;
  /** Why the last /stats poll failed, if it did. Cleared on the next success. */
  apiError?: string;
  events: KernelEvent[];
  processes: Map<string, ReplayedProcess>;
  jobs: JobInfo[];
  messages: IpcMessage[];
  artifacts: Artifact[];
  lastSequence: number;
  version: number;
}

const MAX_EVENTS = 50_000;

export function useKernel(): KernelState {
  const store = useRef({
    events: [] as KernelEvent[],
    processes: new Map<string, ReplayedProcess>(),
    jobs: [] as JobInfo[],
    messages: new Map<number, IpcMessage>(),
    artifacts: [] as Artifact[],
    lastSequence: 0,
  });
  const [version, setVersion] = useState(0);
  const [connected, setConnected] = useState(false);
  const [stats, setStats] = useState<Stats>();
  const [apiError, setApiError] = useState<string>();

  useEffect(() => {
    let ws: WebSocket | undefined;
    let closed = false;
    let dirty = false;
    let retry: ReturnType<typeof setTimeout> | undefined;

    const ingest = (e: KernelEvent) => {
      const s = store.current;
      if (e.sequence <= s.lastSequence) return;
      s.lastSequence = e.sequence;
      s.events.push(e);
      if (s.events.length > MAX_EVENTS) s.events.splice(0, s.events.length - MAX_EVENTS);
      applyEvent(s.processes, e);
      const p = e.payload as Record<string, any>;
      if (e.type === "JOB_SUBMITTED") s.jobs.push({ id: e.jobId, name: p.spec?.name, submittedAt: e.timestamp, firstSeq: e.sequence });
      if (e.type === "ARTIFACT" && e.pid)
        s.artifacts.push({ id: p.id, jobId: e.jobId, pid: e.pid, path: p.path, mime: p.mime, size: p.size });
      if (e.type === "MESSAGE")
        s.messages.set(p.id, { id: p.id, jobId: e.jobId, from: p.from, to: p.to, body: String(p.body), sentAt: e.timestamp, sequence: e.sequence });
      if (e.type === "SYSCALL" && p.request?.type === "RECEIVE" && p.ok) {
        const m = s.messages.get(p.result?.id);
        if (m) m.receivedAt = e.timestamp;
      }
      dirty = true;
    };

    const connect = () => {
      ws = new WebSocket(wsUrl(store.current.lastSequence));
      ws.onopen = () => setConnected(true);
      ws.onmessage = (m) => {
        const msg = JSON.parse(String(m.data));
        if (msg.type === "event") ingest(msg.event as KernelEvent);
      };
      ws.onclose = () => {
        setConnected(false);
        if (!closed) retry = setTimeout(connect, 1000);
      };
      ws.onerror = () => ws?.close();
    };
    connect();

    // Batch renders: at most one per animation frame, however fast events arrive.
    let raf = 0;
    const frame = () => {
      if (dirty) {
        dirty = false;
        setVersion((v) => v + 1);
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    const pollStats = () =>
      api
        .stats()
        .then((s) => {
          setStats(s);
          setApiError(undefined);
        })
        .catch((err: Error) => setApiError(err.message));
    pollStats();
    const statsTimer = setInterval(pollStats, 2000);

    return () => {
      closed = true;
      clearTimeout(retry);
      clearInterval(statsTimer);
      cancelAnimationFrame(raf);
      ws?.close();
    };
  }, []);

  const s = store.current;
  return {
    connected,
    ...(stats ? { stats } : {}),
    ...(apiError ? { apiError } : {}),
    events: s.events,
    processes: s.processes,
    jobs: s.jobs,
    messages: [...s.messages.values()],
    artifacts: s.artifacts,
    lastSequence: s.lastSequence,
    version,
  };
}

/** Re-render on an interval, for clocks and live CPU* figures. */
export function useNow(ms = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}
