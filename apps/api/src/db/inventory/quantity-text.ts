/**
 * Exact decimal text to micro-units (M2-T2).
 *
 * The inverse of `repository.ts`'s {@link microsToDecimalText}, and the only
 * door a caller-supplied quantity comes through. It exists because of the
 * contract rule in `packages/contracts/src/inventory.ts`: quantities travel as
 * decimal text, never as JSON numbers, because a JSON number is an IEEE-754
 * double and inventory arithmetic is exact (ADR-008, CLAUDE.md rule 7).
 *
 * **Why the parse is here and not in the domain.** The domain's
 * `amountToMicros` takes a `number`, which is the right shape for it: the
 * ledger's `TransactionInput.qtyDelta` is a number and the domain guarantees
 * that every value inside `MAX_QUANTITY_MICROS` round-trips exactly through
 * one. Text is a *transport* concern, so the string is converted at the
 * transport boundary with integer arithmetic and string surgery, and the
 * resulting micros are handed to the domain as `microsToAmount(micros)`, a
 * value the domain itself produced and will reproduce exactly when it converts
 * back. `quantity-text.test.ts` pins that agreement with a property test
 * rather than leaving it as a claim.
 *
 * The failure codes are the domain's own {@link LedgerErrorCode}s, so a client
 * sees one vocabulary for a refused quantity whether the text never made it to
 * the ledger or the ledger refused what it became (copy-deck.md §8 keys its
 * strings off exactly these).
 */

import { err, ok, MAX_QUANTITY_MICROS, type Outcome } from "@smart-kitchen/domain";

/**
 * Plain decimal, optionally signed: `-12`, `0.5`, `1.250000`.
 *
 * Deliberately narrow. No exponent (`1e6` is a number's spelling, not a
 * quantity's), no `+` sign, no whitespace, no thousands separators, and at
 * least one digit before the point. Everything this rejects is something a
 * client should not have sent, and accepting any of it would mean guessing
 * what was meant.
 */
const DECIMAL_TEXT = /^(-?)(\d+)(?:\.(\d+))?$/;

/** The ledger's scale: 1e-6 of a unit (`QUANTITY_SCALE` in the domain). */
const FRACTION_DIGITS = 6;

/**
 * Parses exact decimal text in an item's unit into micro-units.
 *
 * `field` names the request field in the returned error so a client can point
 * at what it sent.
 */
export function decimalTextToMicros(value: string, field: string): Outcome<bigint> {
  if (typeof value !== "string") {
    return err("INVALID_FIELD", `${field} must be a decimal string`, field);
  }
  const match = DECIMAL_TEXT.exec(value);
  if (match === null) {
    return err(
      "INVALID_FIELD",
      `${field} must be a plain decimal number written as text, for example "1.25"`,
      field,
    );
  }

  const [, sign, whole, fraction = ""] = match;
  if (whole === undefined) {
    return err("INVALID_FIELD", `${field} must be a plain decimal number written as text`, field);
  }
  if (fraction.length > FRACTION_DIGITS) {
    return err(
      "PRECISION_EXCEEDED",
      `${field} carries more than ${String(FRACTION_DIGITS)} decimal places, which the ledger cannot represent exactly`,
      field,
    );
  }

  // Integer arithmetic only: pad the fraction to the ledger scale and read the
  // whole thing as one bigint. No division, no float, nothing to round.
  const padded = fraction.padEnd(FRACTION_DIGITS, "0");
  const magnitude = BigInt(`${whole}${padded}`);
  if (magnitude > MAX_QUANTITY_MICROS) {
    return err("QUANTITY_OUT_OF_RANGE", `${field} exceeds the representable ledger range`, field);
  }
  return ok(sign === "-" ? -magnitude : magnitude);
}
