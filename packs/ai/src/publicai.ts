import { isAbortError } from "@nodish/core";
import { matchOption, normalizeNewlines } from "./newlines";

/**
 * Public AI chat completions via same-origin `/publicai/*` proxy.
 */

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type ChatCompletionResult = {
  content: string;
};

export async function publicAiChatCompletions(options: {
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  signal?: AbortSignal;
}): Promise<ChatCompletionResult> {
  const body = JSON.stringify({
    model: options.model,
    messages: options.messages,
  });

  let res: Response;
  try {
    res = await fetch("/publicai/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${options.apiKey}`,
      },
      body,
      signal: options.signal,
    });
  } catch (err) {
    if (isAbortError(err)) throw err;
    throw new Error(
      err instanceof Error
        ? `Public AI request failed: ${err.message}`
        : "Public AI request failed",
    );
  }

  if (res.status < 200 || res.status >= 300) {
    const detail = (await res.text()).slice(0, 400);
    throw new Error(
      `Public AI HTTP ${res.status}${detail ? `: ${detail}` : ""}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = (await res.json()) as unknown;
  } catch {
    throw new Error("Public AI returned invalid JSON");
  }

  const content = extractAssistantContent(parsed);
  if (content == null) {
    throw new Error("Public AI response missing assistant content");
  }
  return { content: normalizeNewlines(content) };
}

function extractAssistantContent(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) return null;
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const first = choices[0];
  if (typeof first !== "object" || first === null) return null;
  const message = (first as { message?: unknown }).message;
  if (typeof message !== "object" || message === null) return null;
  const content = (message as { content?: unknown }).content;
  return typeof content === "string" ? content : null;
}

/** Parse `{"reasoning":"...","choice":"..."}` from model output (fences OK). */
export function parseChoiceJson(
  raw: string,
  options: string[],
): { choice: string; reasoning: string } {
  const trimmed = normalizeNewlines(raw).trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)```$/i.exec(trimmed);
  const jsonText = (fenced?.[1] ?? trimmed).trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText) as unknown;
  } catch {
    const start = jsonText.indexOf("{");
    const end = jsonText.lastIndexOf("}");
    if (start < 0 || end <= start) {
      throw new Error("Model did not return JSON with choice/reasoning");
    }
    parsed = JSON.parse(jsonText.slice(start, end + 1)) as unknown;
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("Model JSON was not an object");
  }
  const choiceRaw = (parsed as { choice?: unknown }).choice;
  const reasoningRaw = (parsed as { reasoning?: unknown }).reasoning;
  if (typeof choiceRaw !== "string" || !choiceRaw) {
    throw new Error("Model JSON missing string choice");
  }
  if (typeof reasoningRaw !== "string") {
    throw new Error("Model JSON missing string reasoning");
  }

  const choice = matchOption(choiceRaw, options);
  if (choice == null) {
    throw new Error(
      `Model choice ${JSON.stringify(choiceRaw)} is not one of the provided options`,
    );
  }
  return {
    choice,
    reasoning: normalizeNewlines(reasoningRaw),
  };
}
