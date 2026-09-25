// Capability Manager. Capabilities enforce least authority, and attenuate on spawn:
// a child may only receive a subset of its parent's capabilities, never a superset.
import { posix } from "node:path";
import type { Capability, CapabilityType } from "./types.ts";

export class CapabilityEscalationError extends Error {
  constructor(public requested: Capability, reason: string) {
    super(`capability escalation: ${requested.type}${requested.scope ? `(${requested.scope})` : ""} ${reason}`);
    this.name = "CapabilityEscalationError";
  }
}

/** A concrete permission request made by a syscall. */
export interface CapabilityRequest {
  type: CapabilityType;
  /** The resource the syscall touches: a path, host, or pid. */
  resource?: string;
}

const FS_TYPES: ReadonlySet<CapabilityType> = new Set(["FS_READ", "FS_WRITE"]);

/** Normalize an FS path to an absolute, dot-free posix path inside the sandbox. */
export function normalizePath(p: string): string {
  const n = posix.normalize("/" + p);
  return n.length > 1 && n.endsWith("/") ? n.slice(0, -1) : n;
}

function pathWithin(path: string, prefix: string): boolean {
  const p = normalizePath(path);
  const pre = normalizePath(prefix);
  return pre === "/" || p === pre || p.startsWith(pre + "/");
}

/** NET scope is a comma-separated host allowlist. "*.example.com" matches subdomains. */
function hostList(scope: string): string[] {
  return scope
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
}

function hostMatches(host: string, pattern: string): boolean {
  const h = host.toLowerCase();
  if (pattern === "*") return true;
  if (pattern.startsWith("*.")) return h.endsWith(pattern.slice(1));
  return h === pattern;
}

/** Is host pattern `h` (possibly "*.x" or "*") no wider than pattern `p`? */
function hostPatternWithin(h: string, p: string): boolean {
  if (p === "*") return true;
  if (h === "*") return false;
  if (h.startsWith("*.")) return p.startsWith("*.") && h.endsWith(p.slice(1));
  return hostMatches(h, p);
}

function pidList(scope: string): string[] {
  return scope.split(",").map((s) => s.trim()).filter(Boolean);
}

/** Does a single capability cover a concrete request? */
function covers(cap: Capability, req: CapabilityRequest): boolean {
  if (cap.type !== req.type) return false;
  if (cap.scope === undefined) return true;
  if (req.resource === undefined) return false;
  if (FS_TYPES.has(cap.type)) return pathWithin(req.resource, cap.scope);
  if (cap.type === "NET") return hostList(cap.scope).some((p) => hostMatches(req.resource!, p));
  if (cap.type === "SEND" || cap.type === "RECEIVE") return pidList(cap.scope).includes(req.resource);
  // EXEC and SPAWN scopes are exact-match labels.
  return cap.scope === req.resource;
}

/** Is the capability `child` no wider than `parent`? */
function capWithin(child: Capability, parent: Capability): boolean {
  if (child.type !== parent.type) return false;
  if (parent.scope === undefined) return true;
  if (child.scope === undefined) return false; // unscoped is wider than any scope
  if (FS_TYPES.has(child.type)) return pathWithin(child.scope, parent.scope);
  if (child.type === "NET") {
    const allowed = hostList(parent.scope);
    return hostList(child.scope).every((h) => allowed.some((p) => hostPatternWithin(h, p)));
  }
  if (child.type === "SEND" || child.type === "RECEIVE") {
    const allowed = pidList(parent.scope);
    return pidList(child.scope).every((p) => allowed.includes(p));
  }
  return child.scope === parent.scope;
}

export class CapabilityManager {
  /** Find the capability that authorizes a request, if any. */
  find(caps: readonly Capability[], req: CapabilityRequest): Capability | undefined {
    return caps.find((c) => covers(c, req));
  }

  check(process: { capabilities: readonly Capability[] }, req: CapabilityRequest): boolean {
    return this.find(process.capabilities, req) !== undefined;
  }

  /**
   * Compute a child's capability set for SPAWN. Every requested capability must be covered by
   * one of the parent's (same type, equal or narrower scope). Throws on any escalation.
   * The approval flag is inherited: a child can never drop a parent's approval gate.
   */
  attenuate(parentCaps: readonly Capability[], requestedCaps: readonly Capability[]): Capability[] {
    return requestedCaps.map((req) => {
      const parent = parentCaps.find((p) => capWithin(req, p));
      if (!parent) {
        const sameType = parentCaps.some((p) => p.type === req.type);
        throw new CapabilityEscalationError(req, sameType ? "is wider than the parent's scope" : "is not held by the parent");
      }
      const child: Capability = { type: req.type };
      if (req.scope !== undefined) child.scope = req.scope;
      if (req.requiresApproval || parent.requiresApproval) child.requiresApproval = true;
      return child;
    });
  }
}
