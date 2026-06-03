import type { HmacAuthError } from "../core/errors.js";
import type { OnBadHttpSignature } from "../core/types.js";
import type { RedisLikeClient } from "../stores/redis.js";
import { createExpressHttpHmacMiddleware } from "./server/express.js";

/**
 * Middleware factory exposed by `initializeHmacHttpAuth`.
 *
 * `createHttpMiddlewareFactory(...)` is a thin wrapper around
 * `createExpressHttpHmacMiddleware` for protecting business routes.
 */

type AnyReq = any;
type AnyRes = any;
type Next = (error?: unknown) => void;

export type HttpMiddlewareFactoryOptions = {
  attachAuthTo?: string;
  maxSkewMs?: number;
  onError?: (error: HmacAuthError, req: AnyReq, res: AnyRes, next: Next) => void;
  onBadSignature?: OnBadHttpSignature;
};

export interface CreateHttpMiddlewareFactoryDeps {
  redis: RedisLikeClient;
  namespace: string;
  maxSkewMs: number;
  defaultOnBadSignature?: OnBadHttpSignature;
}

export function createHttpMiddlewareFactory(
  deps: CreateHttpMiddlewareFactoryDeps
): (options?: HttpMiddlewareFactoryOptions) => (req: AnyReq, res: AnyRes, next: Next) => Promise<void> {
  return (middlewareOptions) =>
    createExpressHttpHmacMiddleware({
      redis: deps.redis,
      namespace: deps.namespace,
      maxSkewMs: middlewareOptions?.maxSkewMs ?? deps.maxSkewMs,
      attachAuthTo: middlewareOptions?.attachAuthTo,
      onError: middlewareOptions?.onError,
      onBadSignature: middlewareOptions?.onBadSignature ?? deps.defaultOnBadSignature,
    });
}
