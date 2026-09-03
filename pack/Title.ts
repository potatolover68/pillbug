import type { WikiTitle } from "../src/wiki/title.ts";
import type { NodeSpec, NodeSpecRegistry, TypeSpec } from "@nodish/core";

const TITLE_TYPE = "wiki/title";
const TITLE_COLOR = "#eb9e34";

function isWikiTitle(value: unknown): value is WikiTitle {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as WikiTitle).getNamespaceId === "function" &&
    typeof (value as WikiTitle).getPrefixedDb === "function"
  );
}

function asTitle(value: unknown): WikiTitle {
  if (!isWikiTitle(value)) {
    throw new Error("Expected wiki/title");
  }
  return value;
}

export const Title: TypeSpec = {
  id: TITLE_TYPE,
  label: "Title",
  color: TITLE_COLOR,
  description:
    "A parsed MediaWiki title (namespace + page name). Requires siteinfo from login. Wire from String to Title or the graph Title input.",
  widgets: {
    default: {
      kind: "none",
    },
  },
  validate: (value: unknown) => value === null || isWikiTitle(value),
};

function titleMethodNode(
  typeId: string,
  displayName: string,
  description: string,
  outputKey: string,
  outputType: string,
  invoke: (title: WikiTitle) => unknown,
  keywords: string[] = [],
): NodeSpec {
  return {
    typeId,
    displayName,
    description,
    keywords,
    color: TITLE_COLOR,
    group: ["MediaWiki", "title"],
    inputs: {
      title: {
        type: TITLE_TYPE,
        label: "Title",
        description: "Parsed MediaWiki title.",
      },
    },
    outputs: {
      [outputKey]: {
        type: outputType,
        label: displayName.replace(/^Get /i, "").replace(/^Is /i, ""),
      },
    },
    execute: (inputs) => ({
      [outputKey]: invoke(asTitle(inputs.title)),
    }),
  };
}

const getNamespaceId = titleMethodNode(
  "wiki/get-namespace-id",
  "Get Namespace ID",
  "Get the namespace number (e.g. 6 for File:Example.svg).",
  "namespaceId",
  "number",
  (title) => title.getNamespaceId(),
);

const getNamespacePrefix = titleMethodNode(
  "wiki/get-namespace-prefix",
  "Get Namespace Prefix",
  'Get the namespace prefix in the content language (e.g. "File:").',
  "namespacePrefix",
  "string",
  (title) => title.getNamespacePrefix(),
);

const getMain = titleMethodNode(
  "wiki/get-main",
  "Get Main",
  'Get the main page name (e.g. "Example_image.svg").',
  "main",
  "string",
  (title) => title.getMain(),
);

const getMainText = titleMethodNode(
  "wiki/get-main-text",
  "Get Main Text",
  'Get the main page name with spaces (e.g. "Example image.svg").',
  "mainText",
  "string",
  (title) => title.getMainText(),
);

const getPrefixedDb = titleMethodNode(
  "wiki/get-prefixed-db",
  "Get Prefixed DB",
  'Get the full page name for API use (e.g. "File:Example_image.svg").',
  "prefixedDb",
  "string",
  (title) => title.getPrefixedDb(),
);

const getPrefixedText = titleMethodNode(
  "wiki/get-prefixed-text",
  "Get Prefixed Text",
  'Get the full display title (e.g. "File:Example image.svg").',
  "prefixedText",
  "string",
  (title) => title.getPrefixedText(),
);

const getFragment = titleMethodNode(
  "wiki/get-fragment",
  "Get Fragment",
  "Get the fragment without the hash character, or null if none.",
  "fragment",
  "string",
  (title) => title.getFragment() ?? "",
);

const isTalkPage = titleMethodNode(
  "wiki/is-talk-page",
  "Is Talk Page",
  "Check if the title is in a talk namespace.",
  "isTalkPage",
  "boolean",
  (title) => title.isTalkPage(),
);

const getTalkPage = titleMethodNode(
  "wiki/get-talk-page",
  "Get Talk Page",
  "Get the associated talk page title, or null if unavailable.",
  "talkPage",
  TITLE_TYPE,
  (title) => title.getTalkPage(),
);

const getSubjectPage = titleMethodNode(
  "wiki/get-subject-page",
  "Get Subject Page",
  "Get the subject page for a talk page, or null if unavailable.",
  "subjectPage",
  TITLE_TYPE,
  (title) => title.getSubjectPage(),
);

const canHaveTalkPage = titleMethodNode(
  "wiki/can-have-talk-page",
  "Can Have Talk Page",
  "Check if the title can have an associated talk page.",
  "canHaveTalkPage",
  "boolean",
  (title) => title.canHaveTalkPage(),
);

const getExtension = titleMethodNode(
  "wiki/get-extension",
  "Get Extension",
  "Get the page name extension, or null if none.",
  "extension",
  "string",
  (title) => title.getExtension() ?? "",
);

const getDotExtension = titleMethodNode(
  "wiki/get-dot-extension",
  "Get Dot Extension",
  'Get the extension with a leading dot (e.g. ".json"), or "" if none.',
  "dotExtension",
  "string",
  (title) => title.getDotExtension(),
);

const toString = titleMethodNode(
  "wiki/title-to-string",
  "Title To String",
  "Alias for getPrefixedDb.",
  "string",
  "string",
  (title) => title.toString(),
);

const toText = titleMethodNode(
  "wiki/title-to-text",
  "Title To Text",
  "Alias for getPrefixedText.",
  "text",
  "string",
  (title) => title.toText(),
);

export const titleNodes: NodeSpecRegistry = {
  [getNamespaceId.typeId]: getNamespaceId,
  [getNamespacePrefix.typeId]: getNamespacePrefix,
  [getMain.typeId]: getMain,
  [getMainText.typeId]: getMainText,
  [getPrefixedDb.typeId]: getPrefixedDb,
  [getPrefixedText.typeId]: getPrefixedText,
  [getFragment.typeId]: getFragment,
  [isTalkPage.typeId]: isTalkPage,
  [getTalkPage.typeId]: getTalkPage,
  [getSubjectPage.typeId]: getSubjectPage,
  [canHaveTalkPage.typeId]: canHaveTalkPage,
  [getExtension.typeId]: getExtension,
  [getDotExtension.typeId]: getDotExtension,
  [toString.typeId]: toString,
  [toText.typeId]: toText,
};
