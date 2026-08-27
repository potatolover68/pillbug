/**
 * Sync Public AI chat completions via same-origin `/publicai/*` proxy.
 * Graph execute is sync-only, so this uses blocking XHR (blocks the UI).
 */

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type ChatCompletionResult = {
  content: string;
};

export function publicAiChatCompletionsSync(options: {
  apiKey: string;
  model: string;
  messages: ChatMessage[];
}): ChatCompletionResult {
  const xhr = new XMLHttpRequest();
  xhr.open("POST", "/publicai/chat/completions", false);
  xhr.setRequestHeader("Content-Type", "application/json");
  xhr.setRequestHeader("Authorization", `Bearer ${options.apiKey}`);
  // Browsers forbid setting User-Agent on XHR; the proxy forwards the browser UA
  // and injects pillbug-ai if needed.

  const body = JSON.stringify({
    model: options.model,
    messages: options.messages,
  });

  try {
    xhr.send(body);
  } catch (err) {
    throw new Error(
      err instanceof Error
        ? `Public AI request failed: ${err.message}`
        : "Public AI request failed",
    );
  }

  if (xhr.status < 200 || xhr.status >= 300) {
    const detail = xhr.responseText?.slice(0, 400) || "";
    throw new Error(
      `Public AI HTTP ${xhr.status}${detail ? `: ${detail}` : ""}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(xhr.responseText) as unknown;
  } catch {
    throw new Error("Public AI returned invalid JSON");
  }

  const content = extractAssistantContent(parsed);
  if (content == null) {
    throw new Error("Public AI response missing assistant content");
  }
  return { content };
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
  const trimmed = raw.trim();
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
  const choice = (parsed as { choice?: unknown }).choice;
  const reasoning = (parsed as { reasoning?: unknown }).reasoning;
  if (typeof choice !== "string" || !choice) {
    throw new Error("Model JSON missing string choice");
  }
  if (typeof reasoning !== "string") {
    throw new Error("Model JSON missing string reasoning");
  }
  if (!options.includes(choice)) {
    throw new Error(
      `Model choice ${JSON.stringify(choice)} is not one of the provided options`,
    );
  }
  return { choice, reasoning };
}
