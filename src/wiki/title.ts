/**
 * Substantial copy of mw.Title / mwn Title (MediaWiki on-site JS).
 * Adapted from mediawiki.Title (GNU GPL v2).
 */
import toUpperMap from "./phpCharToUpperMap.json" with { type: "json" };

const NS_MAIN = 0;
const NS_TALK = 1;
const NS_SPECIAL = -1;

export type SiteInfoQueryResponse = {
  query: {
    general: {
      legaltitlechars: string;
    };
    namespaces: Record<
      string,
      {
        name: string;
        id: number;
        canonical?: string;
        case: string;
      }
    >;
    namespacealiases: {
      alias: string;
      id: number;
    }[];
  };
};

type ParsedTitle = {
  namespace: number;
  title: string;
  fragment: string | null;
};

function namespaceNorm(ns: string | undefined): string {
  return (ns || "").toLowerCase().replace(/ /g, "_");
}

function byteLength(str: string): number {
  return str
    .replace(/[\u0080-\u07FF\uD800-\uDFFF]/g, "**")
    .replace(/[\u0800-\uD7FF\uE000-\uFFFF]/g, "***").length;
}

function getNamespacePrefix(namespace: number): string {
  if (namespace === NS_MAIN) return "";
  const name = WikiTitle.idNameMap[namespace];
  if (name === undefined) {
    throw new Error(`Unknown namespace id ${namespace}`);
  }
  return name.replace(/ /g, "_") + ":";
}

function getNsIdByName(ns: string): number | false {
  if (typeof ns !== "string") {
    return false;
  }
  const id = WikiTitle.nameIdMap[ns.toLowerCase()];
  if (id === undefined) {
    return false;
  }
  return id;
}

function parse(
  title: string,
  defaultNamespace: number | undefined,
): ParsedTitle | false {
  WikiTitle.checkData();

  const rUnicodeBidi = /[\u200E\u200F\u202A-\u202E]+/g;
  const rWhitespace =
    /[ _\u00A0\u1680\u180E\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]+/g;
  const rUnderscoreTrim = /^_+|_+$/g;
  const rSplit = /^(.+?)_*:_*(.*)$/;
  // Same character class as mw.Title / mwn (legaltitlechars is stored for parity).
  const rInvalid = new RegExp(
    "[^" +
      ' %!"$&\'()*,\\-./0-9:;=?@A-Z\\\\\\^_`a-z~+\\u0080-\\uFFFF' +
      "]" +
      "|%[\\dA-Fa-f]{2}" +
      "|&[\\dA-Za-z\u0080-\uFFFF]+;" +
      "|&#\\d+;" +
      "|&#x[\\dA-Fa-f]+;",
  );

  let namespace = defaultNamespace === undefined ? NS_MAIN : defaultNamespace;
  let fragment: string | null;

  title = title
    .replace(rUnicodeBidi, "")
    .replace(rWhitespace, "_")
    .replace(rUnderscoreTrim, "");

  if (title !== "" && title[0] === ":") {
    namespace = NS_MAIN;
    title = title.slice(1).replace(rUnderscoreTrim, "");
  }

  if (title === "") {
    return false;
  }

  let m = title.match(rSplit);
  if (m) {
    const id = getNsIdByName(m[1]!);
    if (id !== false) {
      namespace = id;
      title = m[2]!;
      if (namespace === NS_TALK && (m = title.match(rSplit))) {
        if (getNsIdByName(m[1]!) !== false) {
          return false;
        }
      }
    }
  }

  const i = title.indexOf("#");
  if (i === -1) {
    fragment = null;
  } else {
    fragment = title.slice(i + 1).replace(/_/g, " ");
    title = title.slice(0, i).replace(rUnderscoreTrim, "");
  }

  if (rInvalid.test(title)) {
    return false;
  }

  if (
    title.indexOf(".") !== -1 &&
    (title === "." ||
      title === ".." ||
      title.indexOf("./") === 0 ||
      title.indexOf("../") === 0 ||
      title.indexOf("/./") !== -1 ||
      title.indexOf("/../") !== -1 ||
      title.slice(-2) === "/." ||
      title.slice(-3) === "/..")
  ) {
    return false;
  }

  if (title.indexOf("~~~") !== -1) {
    return false;
  }

  if (namespace !== NS_SPECIAL && byteLength(title) > 255) {
    return false;
  }

  if (title === "" && namespace !== NS_MAIN) {
    return false;
  }

  if (title[0] === ":") {
    return false;
  }

  return { namespace, title, fragment };
}

export class WikiTitle {
  static idNameMap: Record<number, string> = {};
  static nameIdMap: Record<string, number> = {};
  static legaltitlechars = "";
  static caseSensitiveNamespaces: number[] = [];

  title: string;
  namespace: number;
  fragment: string | null;

  static processNamespaceData(json: SiteInfoQueryResponse): void {
    WikiTitle.idNameMap = {};
    WikiTitle.nameIdMap = {};
    Object.values(json.query.namespaces).forEach((ns) => {
      WikiTitle.idNameMap[ns.id] = ns.name;
      WikiTitle.nameIdMap[namespaceNorm(ns.name)] = ns.id;
      if (ns.canonical) {
        WikiTitle.nameIdMap[namespaceNorm(ns.canonical)] = ns.id;
      }
    });
    json.query.namespacealiases.forEach((ns) => {
      WikiTitle.nameIdMap[namespaceNorm(ns.alias)] = ns.id;
    });
    WikiTitle.legaltitlechars = json.query.general.legaltitlechars;
    WikiTitle.caseSensitiveNamespaces = Object.values(json.query.namespaces)
      .filter((ns) => ns.case === "case-sensitive")
      .map((ns) => ns.id);
  }

  static checkData(): void {
    if (
      !WikiTitle.nameIdMap ||
      !Object.keys(WikiTitle.nameIdMap).length ||
      !WikiTitle.idNameMap ||
      !WikiTitle.legaltitlechars
    ) {
      throw new Error(
        "namespace data unavailable: run getSiteInfo() or login() first",
      );
    }
  }

  constructor(title: string, namespace?: number) {
    const parsed = parse(title, namespace);
    if (!parsed) {
      throw new Error("Unable to parse title");
    }
    this.namespace = parsed.namespace;
    this.title = parsed.title;
    this.fragment = parsed.fragment;
  }

  getNamespaceId(): number {
    return this.namespace;
  }

  getNamespacePrefix(): string {
    return getNamespacePrefix(this.namespace);
  }

  getMain(): string {
    if (
      WikiTitle.caseSensitiveNamespaces.indexOf(this.namespace) !== -1 ||
      !this.title.length
    ) {
      return this.title;
    }
    return WikiTitle.phpCharToUpper(this.title[0]!) + this.title.slice(1);
  }

  getMainText(): string {
    return this.getMain().replace(/_/g, " ");
  }

  getPrefixedDb(): string {
    return this.getNamespacePrefix() + this.getMain();
  }

  getPrefixedText(): string {
    return this.getPrefixedDb().replace(/_/g, " ");
  }

  getFragment(): string | null {
    return this.fragment;
  }

  isTalkPage(): boolean {
    return WikiTitle.isTalkNamespace(this.getNamespaceId());
  }

  getTalkPage(): WikiTitle | null {
    if (!this.canHaveTalkPage()) {
      return null;
    }
    return this.isTalkPage()
      ? this
      : WikiTitle.makeTitle(this.getNamespaceId() + 1, this.getMainText());
  }

  getSubjectPage(): WikiTitle | null {
    return this.isTalkPage()
      ? WikiTitle.makeTitle(this.getNamespaceId() - 1, this.getMainText())
      : this;
  }

  canHaveTalkPage(): boolean {
    return this.getNamespaceId() >= NS_MAIN;
  }

  getExtension(): string | null {
    const lastDot = this.title.lastIndexOf(".");
    if (lastDot === -1) {
      return null;
    }
    return this.title.slice(lastDot + 1) || null;
  }

  getDotExtension(): string {
    const ext = this.getExtension();
    return ext === null ? "" : "." + ext;
  }

  static newFromText(
    title: string,
    namespace = 0,
  ): WikiTitle | null {
    const parsed = parse(title, namespace);
    if (!parsed) {
      return null;
    }
    const t = Object.create(WikiTitle.prototype) as WikiTitle;
    t.namespace = parsed.namespace;
    t.title = parsed.title;
    t.fragment = parsed.fragment;
    return t;
  }

  static makeTitle(namespace: number, title: string): WikiTitle | null {
    return WikiTitle.newFromText(getNamespacePrefix(namespace) + title);
  }

  static isTalkNamespace(namespaceId: number): boolean {
    return !!(namespaceId > NS_MAIN && namespaceId % 2);
  }

  static phpCharToUpper(chr: string): string {
    const mapped = (toUpperMap as Record<string, string>)[chr];
    if (mapped === "") {
      return chr;
    }
    return mapped || chr.toUpperCase();
  }

  toString(): string {
    return this.getPrefixedDb();
  }

  toText(): string {
    return this.getPrefixedText();
  }
}
