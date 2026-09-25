# Demo recording script

A 3-minute walkthrough for the README GIF or a screen recording. Everything runs with no API keys.

## Setup

```bash
pnpm install
pnpm demo
```

`pnpm demo` builds the console, starts the API on :4000 and the console on :3000, then submits three jobs over HTTP with pauses between them. The mock model waits 700 ms per call so the run is watchable. Set `MOCK_LATENCY_MS` to change that.

Record a 1500×900 browser window at http://localhost:3000. Keep a terminal visible for the kill step.

## Shot list

1. **Boot (0:00).** Empty process table. Point at the header: uptime, `llm mock/mock-llm`, `sandbox local`, `run 0/4`. Say: each agent is a process, and this is its process table.
2. **Research pipeline (0:10).** The planner (priority 10) is scheduled first. The researchers call `RECEIVE`. A researcher that asks before its question arrives shows `WAITING receive`: blocked, holding no slot. Point at the event stream: `send -> PID 102`, then `WAITING -> READY (MESSAGE)`, then the researchers `SLEEP` (another `WAITING`).
3. **Task Graph (0:35).** Select the research job. Researchers feed the reviewer. When the reviewer turns green it tries to `SPAWN` a fact-checker with `EXEC`. Point at `syscall(SPAWN via SPAWN) DENIED` in the stream: the reviewer does not hold `EXEC`, so the child cannot get it. The second `SPAWN` succeeds, and a dashed edge appears to `fact-checker`.
4. **Inspector (1:00).** Click the fact-checker's PID. Capabilities show `SEND(<reviewer pid>)` only: attenuated. Show the token meter and the event log.
5. **Coding task (1:15).** Processes tab. The coder writes `/primes.py`, runs it with `EXEC`, checkpoints, reads `/out.txt`, and exits with `2 3 5 7 11 ...`. Sandboxes tab: its sandbox goes `active` then `destroyed`.
6. **Approval gate (1:40).** The third job's coder stops at `WAITING approval`. Open its inspector and press **approve**. `EXEC` runs and the job completes.
7. **Kill (2:00).** In the terminal:
   ```bash
   curl -s -XPOST localhost:4000/jobs -H 'content-type: application/json' \
     -d '{"process":{"role":"waiter","goal":"wait forever","capabilities":[{"type":"RECEIVE"}]}}'
   curl -s -XPOST localhost:4000/processes/<pid>/kill
   ```
   The row goes `WAITING` then `TERMINATED killed`.
8. **Rewind (2:20).** Traces tab, research job. Press `|◀`, then `play`. The kernel-state table replays from the log. Stop on an `LLM_CALL` and show the recorded system prompt, messages, and response. Say: the event log is the source of truth, so any run can be replayed to any sequence number.
9. **Close (2:50).** Point at the `CPU*` footnote: it is runtime utilization, not real CPU. The scarce resources here are tokens, dollars, time, and rate limits.

## With a real model

```bash
LLM_PROVIDER=anthropic ANTHROPIC_API_KEY=... pnpm demo
```

The same jobs run against Claude. Decisions differ from the mock script, and every `LLM_CALL` in Traces shows the real completion.
