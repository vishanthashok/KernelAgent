import { describe, expect, it } from "vitest";
import { fromOpenAIMessage, toOpenAIMessages } from "@kernelagent/llm/openai";
import { priceFor } from "@kernelagent/kernel";

describe("OpenAI message mapping", () => {
  it("maps a tool-use turn and its results to Chat Completions messages", () => {
    const out = toOpenAIMessages("sys", [
      { role: "user", content: "write a file" },
      {
        role: "assistant",
        content: [
          { type: "text", text: "on it" },
          { type: "tool_use", id: "call_1", name: "WRITE_FILE", input: { path: "a.txt", content: "x" } },
          { type: "opaque", provider: "anthropic", block: { type: "thinking" } },
        ],
      },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "call_1", content: "denied", is_error: true }, { type: "text", text: "go on" }] },
    ]);
    expect(out).toEqual([
      { role: "system", content: "sys" },
      { role: "user", content: "write a file" },
      {
        role: "assistant",
        content: "on it",
        tool_calls: [{ id: "call_1", type: "function", function: { name: "WRITE_FILE", arguments: '{"path":"a.txt","content":"x"}' } }],
      },
      { role: "tool", tool_call_id: "call_1", content: "ERROR: denied" },
      { role: "user", content: "go on" },
    ]);
  });

  it("maps a response to kernel blocks, keeping bad JSON arguments as a string", () => {
    const blocks = fromOpenAIMessage({
      content: "done",
      tool_calls: [
        { id: "c1", type: "function", function: { name: "EXIT", arguments: '{"result":"ok"}' } },
        { id: "c2", type: "function", function: { name: "EXIT", arguments: "{bad" } },
      ],
    });
    expect(blocks).toEqual([
      { type: "text", text: "done" },
      { type: "tool_use", id: "c1", name: "EXIT", input: { result: "ok" } },
      { type: "tool_use", id: "c2", name: "EXIT", input: "{bad" },
    ]);
  });

  it("prices GPT models, dated snapshots included", () => {
    expect(priceFor("gpt-5-mini").inputPerMTok).toBe(0.25);
    expect(priceFor("gpt-4o-2024-08-06").outputPerMTok).toBe(10);
  });
});
