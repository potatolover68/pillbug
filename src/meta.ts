import pkg from "../package.json";

export const APP_NAME = "pillbug";
export const APP_VERSION = pkg.version;
export const GITHUB_REPO = "https://github.com/potatolover68/pillbug";
export const GITHUB_ISSUES_NEW = `${GITHUB_REPO}/issues/new`;
export const GITHUB_WIKI = `${GITHUB_REPO}/wiki/Getting-started`;

/** Fixed UA sent to MediaWiki; not user-configurable. */
export const DEFAULT_USER_AGENT = `${APP_NAME}/${APP_VERSION} (${GITHUB_REPO})`;
