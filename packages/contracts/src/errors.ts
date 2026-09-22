/**
 * Error envelope shared by every API response that is not a 2xx (M2-T1).
 *
 * The body says three things and nothing else: a stable machine code, a
 * sentence safe to show a person, and the correlation id of the request. It
 * deliberately carries no detail about *why* an authorization decision went the
 * way it did: "no session" and "that household is not yours" answer
 * identically shaped bodies, because the difference is itself information about
 * another household (the same reasoning as the tenant-inference oracle closed in
 * migration 0003).
 */

/** Stable, machine-readable failure codes. */
export const API_ERROR_CODES = [
  /** No bearer token, a malformed Authorization header, or a token the identity port refused. */
  "UNAUTHENTICATED",
  /** Authenticated, but this session may not perform this operation. */
  "FORBIDDEN",
  /** No route matched. */
  "NOT_FOUND",
  /** The request itself was malformed. */
  "BAD_REQUEST",
  /** Anything else. Never carries internal detail. */
  "INTERNAL",
] as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

export interface ApiErrorBodyDto {
  readonly error: {
    readonly code: ApiErrorCode;
    /** One sentence, safe to display. Never contains personal data or internal detail. */
    readonly message: string;
    /** Echo of the request's correlation id, so a user-reported failure can be found in the logs. */
    readonly correlationId: string;
  };
}

/** Response header carrying the correlation id on every response, success or failure. */
export const CORRELATION_ID_HEADER = "x-correlation-id";
