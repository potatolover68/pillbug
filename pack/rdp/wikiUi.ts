import {
  getDeprecatedParamsRulesAsync,
  replaceDeprecatedParametersInContentAsync,
} from "../deprecatedParams.ts";
import {
  collectTemplateNames,
  isInfoboxTemplateName,
  templatesFromContent,
} from "../wikitext.ts";

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

const RDP_SUMMARY = "removed deprecated parameters using [[User:MSK/rdp|rdp]]";

function touchEditSummary(): void {
  const el = document.getElementById("wpSummary") as
    | HTMLInputElement
    | HTMLTextAreaElement
    | null;
  if (!el) return;
  const current = el.value.trim();
  if (current.includes("[[User:MSK/rdp|rdp]]")) return;
  el.value = current ? `${current} · ${RDP_SUMMARY}` : RDP_SUMMARY;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
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
          if (changed) touchEditSummary();
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
          const names = collectTemplateNames(templatesFromContent(text));
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
          if (any) {
            setText(text);
            touchEditSummary();
          }
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
