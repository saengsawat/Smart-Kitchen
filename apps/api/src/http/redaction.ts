/**
 * Log redaction denylist (M2-T1, ARCHITECTURE.md §7.15).
 *
 * "Structured logger with denylist (names, emails, tokens, profile fields,
 * allergy details)". This module is that denylist, as a pure function so it can
 * be asserted on directly rather than inferred from log output.
 *
 * Two layers, because either one alone fails in a predictable way:
 *
 * 1. **By key.** Any property whose name looks like personal data is replaced
 *    with {@link REDACTED}, whatever its value. Key matching is done on a
 *    normalised form (lowercased, non-alphanumerics removed), so
 *    `display_name`, `displayName` and `DISPLAY-NAME` are the same key.
 * 2. **By value shape.** Strings are scanned for an email address and for a
 *    `Bearer …` credential wherever they appear, including inside a message
 *    that was assembled somewhere else (a driver error quoting a row, say).
 *    Key-based redaction cannot catch those because the value is not under a
 *    key of its own.
 *
 * The bias is deliberate: over-redacting a log line costs a debugging session,
 * under-redacting it puts a household's allergies in a log aggregator. Where
 * the two trade off, redact.
 *
 * **What layer 2 does not catch.** Value-shape scrubbing recognises an email
 * address and a bearer credential, both of which have a syntax. A person's name
 * embedded in free text does not: to a regular expression, "no household for
 * Dean Chen" looks exactly like "no household for that item". Names are caught only
 * by their key, which is why the rule upstream of this module is that log
 * messages are fixed strings and personal data never reaches a message at all.
 *
 * What is **not** redacted, on purpose: opaque identifiers (`userId`,
 * `householdId`, `itemId`, `correlationId`). They carry no personal data on
 * their own and they are what makes an authorization denial auditable
 * (ARCHITECTURE.md §7.10).
 */

/** Replacement written in place of a redacted value. */
export const REDACTED = "[redacted]";

/** Replacement written in place of an email address found inside a string. */
export const REDACTED_EMAIL = "[redacted-email]";

/** Replacement written in place of a bearer credential found inside a string. */
export const REDACTED_TOKEN = "Bearer [redacted]";

/**
 * Keys redacted on an exact (normalised) match.
 *
 * Exact rather than substring for these, because the substrings are too common
 * to be safe: `name` as a substring would redact `displayNameCount`,
 * `componentName` and every other harmless field ending in "name".
 */
const DENIED_KEYS: ReadonlySet<string> = new Set([
  // Names
  "name",
  "names",
  "displayname",
  "displaynames",
  "displayinitials",
  "initials",
  "firstname",
  "lastname",
  "fullname",
  "givenname",
  "familyname",
  "middlename",
  "nickname",
  "username",
  "householdname",
  // Contact
  "phone",
  "phonenumber",
  "mobile",
  "address",
  "postcode",
  "zip",
  // Profile / health-adjacent (data-model.md §5)
  "profile",
  "memberprofile",
  "preferences",
  "dob",
  "dateofbirth",
  "birthdate",
  "birthday",
  "age",
  "sex",
  "gender",
  "height",
  "weight",
  "bodyweight",
  "healthgoal",
  "healthgoals",
  "goals",
  "dietary",
  "diet",
  "restriction",
  "restrictions",
  "notes",
  // Request material that can carry any of the above
  "body",
  "payload",
  "headers",
  "cookie",
  "cookies",
  "query",
  "querystring",
  "params",
]);

/**
 * Substrings that make a key unsafe wherever they appear.
 *
 * These are specific enough that a false positive is harmless: no field whose
 * name contains "allerg" or "token" should ever be in a log line.
 */
const DENIED_KEY_SUBSTRINGS: readonly string[] = [
  "email",
  "token",
  "password",
  "passphrase",
  "secret",
  "apikey",
  "credential",
  "authorization",
  "bearer",
  "allerg",
];

/** Normalises a property name for denylist matching. */
export function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** True when a property with this name must never reach a log line. */
export function isDeniedKey(key: string): boolean {
  const normalized = normalizeKey(key);
  if (DENIED_KEYS.has(normalized)) return true;
  return DENIED_KEY_SUBSTRINGS.some((fragment) => normalized.includes(fragment));
}

/**
 * Anything shaped like an email address.
 *
 * Deliberately broader than a validating pattern: the goal is to catch
 * addresses, not to accept only well-formed ones, so it matches any
 * `local@domain.tld` run of non-space characters.
 *
 * Path separators are excluded from both halves. An email address never
 * contains one, and without the exclusion the pattern swallowed whole stack
 * frames on this project's own layout, because pnpm's virtual store puts an `@`
 * in every directory name (`.pnpm/fastify@5.12.1/node_modules/fastify/lib/
 * handleRequest.js` matched `local@domain.js`). Over-redaction is the right
 * default, but not when it eats the stack trace of every 500.
 */
const EMAIL_PATTERN = /[^\s"'<>(),;:/\\]+@[^\s"'<>(),;:/\\]+\.[a-z]{2,}/gi;

/** `Bearer <credential>` anywhere in a string, however it got there. */
const BEARER_PATTERN = /\bbearer\s+[^\s"']+/gi;

/** Scrubs personal-data shapes out of a single string value. */
export function redactString(value: string): string {
  return value.replace(BEARER_PATTERN, REDACTED_TOKEN).replace(EMAIL_PATTERN, REDACTED_EMAIL);
}

/** The shape an `Error` is reduced to in a log record. */
export interface SerializedError {
  readonly [key: string]: unknown;
  readonly type: string;
  readonly message: string;
  readonly stack: string;
}

/**
 * Reduces a thrown value to three scrubbed strings.
 *
 * An `Error`'s useful fields are non-enumerable, so it would otherwise reach a
 * log line as `{}` or as pino's default serialization, which emits the raw
 * message and stack. A driver error can quote row values: a Postgres unique
 * violation names the conflicting tuple, which on a `users` index is an email
 * address. Both fields go through {@link redactString}.
 *
 * This runs from inside {@link redactLogRecord} rather than from a pino `err`
 * serializer. pino applies `formatters.log` **before** its serializers, so a
 * serializer would only ever see the object the formatter had already produced
 * (M2-T1 review fix F2: it did, and every 500 logged
 * `{"type":"NonError","message":"[object Object]"}`).
 */
export function redactError(error: unknown): SerializedError {
  if (isSerializedError(error)) return error;
  if (!(error instanceof Error)) {
    return { type: "NonError", message: redactString(String(error)), stack: "" };
  }
  return {
    type: error.name,
    message: redactString(error.message),
    stack: typeof error.stack === "string" ? redactString(error.stack) : "",
  };
}

/**
 * True for a value {@link redactError} has already produced.
 *
 * Idempotency matters because the value passes through twice: once in the
 * formatter, which is where the real `Error` still exists, and once in the
 * logger's `err` serializer, which the framework installs by default and which
 * would otherwise re-serialize the already-reduced object and report its `type`
 * as `"Object"` (M2-T1 review fix F2, second half).
 */
export function isSerializedError(value: unknown): value is SerializedError {
  if (typeof value !== "object" || value === null || value instanceof Error) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate["type"] === "string" &&
    typeof candidate["message"] === "string" &&
    typeof candidate["stack"] === "string"
  );
}

/** Depth beyond which a log record is truncated rather than walked. */
const MAX_DEPTH = 8;

/**
 * Returns a copy of `record` with every denied key redacted and every string
 * scrubbed, recursively.
 *
 * Cycles and over-deep structures are replaced with a marker rather than
 * thrown on: a logger that crashes on a self-referential object turns a
 * diagnostic into an outage.
 */
export function redactLogRecord(record: unknown): unknown {
  return redactValue(record, 0, new WeakSet<object>());
}

function redactValue(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (typeof value === "string") return redactString(value);
  if (value === null || typeof value !== "object") return value;
  if (depth >= MAX_DEPTH) return "[truncated]";
  if (seen.has(value)) return "[circular]";
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((entry) => redactValue(entry, depth + 1, seen));
  }

  // Errors are objects whose useful fields are non-enumerable, so they are
  // reshaped explicitly rather than spread into nothing.
  if (value instanceof Error) return redactError(value);

  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    out[key] = isDeniedKey(key) ? REDACTED : redactValue(entry, depth + 1, seen);
  }
  return out;
}

/** {@link redactLogRecord} narrowed to the object shape pino's formatter hands us. */
export function redactLogObject(record: Record<string, unknown>): Record<string, unknown> {
  const redacted = redactLogRecord(record);
  return typeof redacted === "object" && redacted !== null && !Array.isArray(redacted)
    ? (redacted as Record<string, unknown>)
    : { log: redacted };
}
