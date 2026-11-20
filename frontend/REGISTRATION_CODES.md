# QuotaCell Registration Codes

Registration codes carry public wallet identity only. They contain no private key, seed phrase, signature, or permission to sign. Their checksum detects accidental corruption; it does not authenticate the sender. A key/address match proves structural consistency only, not control of the key.

## Text and binary encoding

Codes are the exact prefix `QCI1.` (invitation) or `QCR1.` (response), followed by unpadded base64url (`A-Z`, `a-z`, `0-9`, `_`, `-`). Decoders reject padding, other characters, unsupported versions/networks, invalid lengths, trailing bytes, and checksum mismatch. Integers are unsigned bytes except address length, which is unsigned 16-bit big-endian. Text addresses are UTF-8.

The payload is followed by the first four bytes of `SHA-256(UTF8("QuotaCell " + prefix + NUL) || payload)`. The prefix includes the final period, so invitation and response checksums are domain-separated.

| Field | QCI1 invitation | QCR1 response |
| --- | --- | --- |
| Version (`u8`) | `1` | `1` |
| Network (`u8`) | `1` = CKB testnet / Pudge genesis `0x10639e0895502b5688a6be8cf69460d76541bfa4821629d86d62ba0aae3f9606` | same |
| Slot (`u8`) | `1` = Delegate 1; `2` = Delegate 2 | `0` = standalone; `1` = Delegate 1; `2` = Delegate 2 |
| Request ID | 16 random bytes | 16 bytes copied from invitation; all zero for standalone |
| Remaining fields | none | address length (`u16be`), address (1-128 bytes), compressed secp256k1 public key (33 bytes), standard lock code hash (32 bytes), hash type (`1` = `type`), lock args (20 bytes) |

An invitation is exactly 19 payload bytes; a standalone response has a zero request ID and slot 0. Invited responses require a nonzero request ID and slot 1 or 2. Import checks a supplied invitation's request ID and slot, verifies the key is a valid compressed secp256k1 point, derives standard-lock args from the key, and requires those args to match both the included lock and the parsed CKB testnet address. It rejects duplicate participant keys during owner setup.

QCR1 is a portable representation, not a wallet-signed proof of possession. Owner setup must not present its structural checks as verified ownership.
