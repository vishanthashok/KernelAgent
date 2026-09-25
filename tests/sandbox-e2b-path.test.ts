import { describe, expect, it } from "vitest";
import { toE2BPath } from "@kernelagent/sandbox/e2b";

describe("E2B path mapping", () => {
  it("roots every path at the sandbox working directory", () => {
    expect(toE2BPath("/primes.py")).toBe("/home/user/primes.py");
    expect(toE2BPath("a/b.txt")).toBe("/home/user/a/b.txt");
    expect(toE2BPath("/")).toBe("/home/user");
  });

  it("cannot climb above the sandbox root", () => {
    expect(toE2BPath("/../../etc/passwd")).toBe("/home/user/etc/passwd");
    expect(toE2BPath("work/../../x")).toBe("/home/user/x");
  });
});
