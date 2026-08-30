import {
  getDeprecatedParamsRulesAsync,
  replaceDeprecatedParametersInContentAsync,
} from "../deprecatedParams.ts";
import { isInfoboxTemplateName } from "../wikitext.ts";

declare const mw: {
  config: { get: (key: string) => unknown };
  loader: { using: (modules: string | string[]) => Promise<unknown> };
  notify: (msg: string, opts?: { type?: string }) => void;
  hook: (name: string) => { add: (fn: () => void) => void };
};

declare function $(selector: string): JQueryLike;

type JQueryLike = {
  textSelection: (cmd: string, arg?: string) => string | unknown;
  length: number;
  data: (key: string, value?: unknown) => unknown;
  append: (...nodes: unknown[]) => unknown;
  attr: (a: string | Record<string, string>, b?: string) => JQueryLike;
  text: (t: string) => JQueryLike;
  on: (event: string, handler: () => void | Promise<void>) => JQueryLike;
};

const FIXINDENT = true;

function uniqueTemplateNames(content: string): string[] {
  const names = new Set<string>();
  let i = 0;
  while (i < content.length - 1) {
    if (content[i] === "{" && content[i + 1] === "{") {
      if (content[i + 2] === "{") {
        i += 3;
        continue;
      }
      let depth = 2;
      const start = i;
      i += 2;
      while (i < content.length && depth > 0) {
        if (content[i] === "{" && content[i + 1] === "{") {
          depth += 2;
          i += 2;
          continue;
        }
        if (content[i] === "}" && content[i + 1] === "}") {
          depth -= 2;
          i += 2;
          continue;
        }
        i += 1;
      }
      if (depth === 0) {
        const inner = content.slice(start + 2, i - 2);
        const m = /^([^|{}\n]+)/.exec(inner);
        let name = (m?.[1] ?? "").trim().replace(/_/g, " ");
        name = name.replace(/^Template\s*:\s*/i, "");
        if (name && !name.startsWith("#")) {
          names.add(name);
        }
      }
      continue;
    }
    i += 1;
  }
  return [...names];
}

async function runToolbar(): Promise<void> {
  await mw.loader.using(["jquery.textSelection", "mediawiki.util"]);

  function getText(): string {
    return String($("#wpTextbox1").textSelection("getContents") ?? "");
  }
  function setText(text: string): void {
    $("#wpTextbox1").textSelection("setContents", text);
  }

  async function runOne(title: string): Promise<boolean> {
    const before = getText();
    const after = await replaceDeprecatedParametersInContentAsync(
      title,
      before,
      FIXINDENT && isInfoboxTemplateName(title),
    );
    if (after !== before) setText(after);
    return after !== before;
  }

  function addButtons(): boolean {
    const $sections = $("#wikiEditor-ui-toolbar .sections");
    if (!$sections.length || $sections.data("rdp-buttons")) {
      return false;
    }
    $sections.data("rdp-buttons", true);

    const $one = $("<button>")
      .attr({
        type: "button",
        title: "Replace deprecated parameters for one template",
      })
      .attr("style", "margin: 5px;")
      .text("RDP (one)")
      .on("click", async () => {
        const title = window.prompt(
          "Template name (Template: implied if omitted):",
          "",
        );
        if (title == null || !title.trim()) return;
        try {
          const changed = await runOne(title.trim());
          mw.notify(
            changed ? "Deprecated parameters replaced." : "No changes.",
            { type: changed ? "success" : "info" },
          );
        } catch (err) {
          const e = err as { message?: string };
          mw.notify(String(e?.message || err), { type: "error" });
        }
      });

    const $all = $("<button>")
      .attr({
        type: "button",
        title: "Replace deprecated parameters for every template",
      })
      .attr("style", "margin: 5px;")
      .text("RDP (all)")
      .on("click", async () => {
        try {
          let text = getText();
          const names = uniqueTemplateNames(text);
          if (!names.length) {
            mw.notify("No templates found.", { type: "info" });
            return;
          }
          const errors: string[] = [];
          await Promise.all(
            names.map(async (name) => {
              try {
                await getDeprecatedParamsRulesAsync(name);
              } catch (err) {
                const e = err as { message?: string };
                errors.push(`${name}: ${e?.message || err}`);
              }
            }),
          );
          let any = false;
          for (const name of names) {
            try {
              const next = await replaceDeprecatedParametersInContentAsync(
                name,
                text,
                FIXINDENT && isInfoboxTemplateName(name),
              );
              if (next !== text) {
                any = true;
                text = next;
              }
            } catch (err) {
              const e = err as { message?: string };
              const msg = `${name}: ${e?.message || err}`;
              if (!errors.includes(msg)) errors.push(msg);
            }
          }
          if (any) setText(text);
          if (errors.length) {
            mw.notify(
              `Done with ${errors.length} error(s). First: ${errors[0]}`,
              { type: "warn" },
            );
          } else {
            mw.notify(
              any
                ? `Updated (${names.length} unique template(s)).`
                : `No changes (${names.length} unique template(s)).`,
              { type: any ? "success" : "info" },
            );
          }
        } catch (err) {
          const e = err as { message?: string };
          mw.notify(String(e?.message || err), { type: "error" });
        }
      });

    $sections.append($one, $all);
    return true;
  }

  if (!addButtons()) {
    mw.hook("wikiEditor.toolbarReady").add(() => {
      addButtons();
    });
    const t0 = Date.now();
    const timer = setInterval(() => {
      if (addButtons() || Date.now() - t0 > 15000) {
        clearInterval(timer);
      }
    }, 250);
  }
}

export function startWikiUi(): void {
  if (typeof mw === "undefined") return;

  const action = mw.config.get("wgAction");
  if (action !== "edit" && action !== "submit") return;

  void runToolbar().catch((err) => {
    const e = err as { message?: string };
    mw.notify("RDP toolbar failed: " + String(e?.message || err), {
      type: "error",
    });
  });
}
