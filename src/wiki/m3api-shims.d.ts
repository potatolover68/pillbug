declare module "m3api/browser.js" {
  import type { Options, Params } from "m3api/core.js";

  export class ApiErrors extends Error {
    errors: unknown[];
  }
  export class ApiWarnings extends Error {
    warnings: unknown[];
  }
  export function set(...args: Array<string | number>): Set<string | number>;

  export default class BrowserSession {
    apiUrl: string;
    defaultParams: Params;
    defaultOptions: Options;
    tokens: Map<string, string>;

    constructor(
      apiUrl: string,
      defaultParams?: Params,
      defaultOptions?: Options,
    );

    request(params: Params, options?: Options): Promise<unknown>;
    getToken(type: string, options?: Options): Promise<string>;
    getFetchOptions(fetchOptions: RequestInit): RequestInit;
    fetch(resource: URL | string, fetchOptions: RequestInit): Promise<Response>;
  }
}

declare module "m3api/core.js" {
  export type Params = Record<string, unknown>;
  export type Options = {
    method?: string;
    tokenType?: string | null;
    tokenName?: string;
    userAgent?: string;
    maxRetriesSeconds?: number;
    accessToken?: string | null;
    [key: string]: unknown;
  };
  export const DEFAULT_OPTIONS: Options;
  export function set(...args: Array<string | number>): Set<string | number>;
  export class ApiErrors extends Error {
    errors: unknown[];
  }
  export class ApiWarnings extends Error {
    warnings: unknown[];
  }
  export class Session {
    apiUrl: string;
    defaultParams: Params;
    defaultOptions: Options;
    tokens: Map<string, string>;
    constructor(
      apiUrl: string,
      defaultParams?: Params,
      defaultOptions?: Options,
    );
    request(params: Params, options?: Options): Promise<unknown>;
    getToken(type: string, options?: Options): Promise<string>;
  }
}

declare module "m3api-botpassword" {
  import type { Session } from "m3api/core.js";

  export class LoginError extends Error {
    result: string;
    reason: string | { code?: string } | undefined;
    username: string;
  }

  export function login(
    session: Session,
    username: string,
    password: string,
    options?: Record<string, unknown>,
  ): Promise<{ name: string; id: number }>;

  export function logout(
    session: Session,
    options?: Record<string, unknown>,
  ): Promise<Record<string, never>>;
}

declare module "m3api-rest" {
  import type { Session } from "m3api/core.js";

  export class RestApiClientError extends Error {
    status: number;
    body: unknown;
  }
  export class RestApiServerError extends Error {
    status: number;
    body: unknown;
  }

  export function path(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): string;

  export function getJson(
    session: Session,
    path: string,
    params?: Record<string, unknown>,
    options?: Record<string, unknown>,
  ): Promise<unknown>;
}
