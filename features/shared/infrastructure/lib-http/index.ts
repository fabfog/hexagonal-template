import ky, { type KyInstance } from "ky";

export type HttpClient = KyInstance;
export type { KyInstance };

export interface HttpContext {
  correlationId?: string | undefined;
  headers?: Record<string, string | undefined>;
}

export interface HttpRequestOptions {
  headers?: Record<string, string>;
}

export interface CreateHttpClientOptions extends HttpRequestOptions {
  prefixUrl?: string;
}

/**
 * Turns a lightweight HTTP context into plain outbound headers.
 * Repositories using third-party SDKs can reuse this without depending on `ky`.
 */
export function getHttpContextHeaders(context?: HttpContext): Record<string, string> {
  const headers = {
    ...(context?.correlationId ? { "x-correlation-id": context.correlationId } : {}),
    ...context?.headers,
  };

  return Object.fromEntries(
    Object.entries(headers).filter(([, value]) => typeof value === "string" && value.length > 0)
  );
}

export function mergeHttpHeaders(
  ...sources: (Record<string, string | undefined> | undefined)[]
): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const source of sources) {
    if (!source) continue;
    for (const [key, value] of Object.entries(source)) {
      if (typeof value === "string" && value.length > 0) {
        merged[key] = value;
      }
    }
  }
  return merged;
}

export function applyHttpContext<T extends HttpRequestOptions>(
  context?: HttpContext,
  options?: T
): T {
  return {
    ...(options ?? {}),
    headers: mergeHttpHeaders(getHttpContextHeaders(context), options?.headers),
  } as T;
}

export function createHttpClient(options?: CreateHttpClientOptions): HttpClient {
  return ky.create(options ?? {});
}

export function createHttpClientForContext(
  context?: HttpContext,
  options?: CreateHttpClientOptions
): HttpClient {
  return createHttpClient(applyHttpContext(context, options));
}
