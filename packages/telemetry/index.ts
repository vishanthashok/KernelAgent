// OpenTelemetry for KernelAgent. Console exporter by default, OTLP/HTTP when
// OTEL_EXPORTER_OTLP_ENDPOINT is set. OTEL_SDK_DISABLED=true turns it off (tests do this).
//
// This package is a leaf: the kernel passes callbacks in, so there is no dependency cycle.
import {
  context,
  metrics,
  SpanStatusCode,
  trace,
  type Attributes,
  type Context,
  type Span,
} from "@opentelemetry/api";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { ConsoleMetricExporter, PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { ConsoleSpanExporter } from "@opentelemetry/sdk-trace-node";

export { context, trace, type Context, type Span };

const NAME = "kernelagent";

export const tracer = () => trace.getTracer(NAME);
export const meter = () => metrics.getMeter(NAME);

let sdk: NodeSDK | undefined;

export function initTelemetry(opts: { serviceName?: string; env?: NodeJS.ProcessEnv } = {}): { shutdown: () => Promise<void> } {
  const env = opts.env ?? process.env;
  if (env.OTEL_SDK_DISABLED === "true" || sdk) return { shutdown: async () => {} };
  const otlp = env.OTEL_EXPORTER_OTLP_ENDPOINT;
  sdk = new NodeSDK({
    resource: resourceFromAttributes({ "service.name": opts.serviceName ?? env.OTEL_SERVICE_NAME ?? NAME }),
    traceExporter: otlp ? new OTLPTraceExporter() : new ConsoleSpanExporter(),
    metricReaders: [
      new PeriodicExportingMetricReader({
        exporter: otlp ? new OTLPMetricExporter() : new ConsoleMetricExporter(),
        exportIntervalMillis: Number(env.OTEL_METRIC_EXPORT_INTERVAL ?? 60_000),
      }),
    ],
  });
  sdk.start();
  return {
    shutdown: async () => {
      await sdk?.shutdown();
      sdk = undefined;
    },
  };
}

/** Run fn inside a new active span. Records errors and ends the span. */
export async function withSpan<T>(name: string, attributes: Attributes, fn: (span: Span) => Promise<T>, parent?: Context): Promise<T> {
  const ctx = parent ?? context.active();
  return tracer().startActiveSpan(name, { attributes }, ctx, async (span) => {
    try {
      const out = await fn(span);
      span.end();
      return out;
    } catch (err) {
      span.recordException(err as Error);
      span.setStatus({ code: SpanStatusCode.ERROR, message: err instanceof Error ? err.message : String(err) });
      span.end();
      throw err;
    }
  });
}

/** Start a span that outlives a single call (a job or a process run). */
export function startSpan(name: string, attributes: Attributes, parent?: Context): { span: Span; ctx: Context } {
  const p = parent ?? context.active();
  const span = tracer().startSpan(name, { attributes }, p);
  return { span, ctx: trace.setSpan(p, span) };
}

export interface KernelGauges {
  processesByState: () => Record<string, number>;
  queueDepth: () => number;
  rateLimiterSaturation: () => { requests: number; tokens: number };
}

export interface KernelMetrics {
  tokens: (n: number, attrs: Attributes) => void;
  cost: (usd: number, attrs: Attributes) => void;
  syscalls: (attrs: Attributes) => void;
}

export function registerKernelMetrics(g: KernelGauges): KernelMetrics {
  const m = meter();
  m.createObservableGauge("kernelagent.processes", { description: "Processes by state" }).addCallback((r) => {
    for (const [state, n] of Object.entries(g.processesByState())) r.observe(n, { state });
  });
  m.createObservableGauge("kernelagent.queue_depth", { description: "READY processes" }).addCallback((r) => r.observe(g.queueDepth()));
  m.createObservableGauge("kernelagent.rate_limiter.saturation", { description: "0 idle, 1 exhausted" }).addCallback((r) => {
    const s = g.rateLimiterSaturation();
    r.observe(s.requests, { bucket: "requests" });
    r.observe(s.tokens, { bucket: "tokens" });
  });
  const tokens = m.createCounter("kernelagent.tokens", { description: "LLM tokens used" });
  const cost = m.createCounter("kernelagent.cost_usd", { description: "Estimated LLM cost in USD" });
  const syscalls = m.createCounter("kernelagent.syscalls", { description: "Syscalls dispatched" });
  return {
    tokens: (n, a) => tokens.add(n, a),
    cost: (n, a) => cost.add(n, a),
    syscalls: (a) => syscalls.add(1, a),
  };
}
