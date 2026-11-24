import { randomInt } from "node:crypto";
import { SessionCode } from "@exileforge/contracts/forge";

/** Alphabet of the session code contract: no 0/1/I/O to avoid misreading. */
const ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

export function newSessionCode(): SessionCode {
  const pick = (n: number) =>
    Array.from({ length: n }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
  return SessionCode.parse(`${pick(4)}-${pick(2)}`);
}
