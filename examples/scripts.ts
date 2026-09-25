// All example mock scripts, merged by role. The API server loads these into the MockLLM
// so submitting an example job over HTTP behaves the same as running it from the CLI.
import type { MockScript } from "@kernelagent/llm";
import { scripts as coding } from "./coding-task/mock-script.ts";
import { scripts as research } from "./research-pipeline/mock-script.ts";

export const exampleScripts: Record<string, MockScript> = { ...coding, ...research };
