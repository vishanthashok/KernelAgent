// Deterministic MockLLM script for the coding-task example. A real model decides these
// steps itself; the mock replays a plausible run so the example works with no API key.
import type { MockScript } from "@kernelagent/llm";

const PROGRAM = `def primes(n):
    found = []
    k = 2
    while len(found) < n:
        if all(k % p for p in found if p * p <= k):
            found.append(k)
        k += 1
    return found

print(" ".join(str(p) for p in primes(15)))
`;

export const scripts: Record<string, MockScript> = {
  coder: [
    { text: "I'll write the program first.", tool: "FS_WRITE", input: { path: "/primes.py", content: PROGRAM } },
    { tool: "EXEC", input: { cmd: "python3 primes.py > out.txt" } },
    { text: "The program ran. Checkpointing before reading the output.", tool: "CHECKPOINT", input: { note: "primes.py written and executed" } },
    { tool: "FS_READ", input: { path: "/out.txt" } },
    (ctx) => ({ tool: "EXIT", input: { result: (ctx.lastToolResult ?? "").trim() } }),
  ],
};
