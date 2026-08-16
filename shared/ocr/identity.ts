/**
 * What makes one reading the same reading as another.
 *
 * A candidate's identity is fixed at the moment it is created and never
 * recomputed — the text can be corrected by hand afterwards and the identity
 * does not move. That is the whole point: it says *which run of which model
 * produced this*, not *what it currently says*.
 *
 * What it buys is that running the same model over the same page twice is
 * idempotent. The second run recomputes the same identities, recognizes every
 * one of them as already present, and so adds nothing and overwrites nothing —
 * including the corrections someone typed in between.
 *
 * ⚠️ Two routes that read one balloon and agree on every character are still
 * two candidates, because their confidences differ and the confidence is part
 * of the identity. That is deliberate: they really are two results, and being
 * able to see that both agree is worth more than folding them into one.
 */

/** Everything about a reading that was true the moment it came into being. */
export interface OcrBirth {
  source: string
  text: string
  x: number
  y: number
  width: number
  height: number
  confidence: number
}

/**
 * The identity of a reading, as a hex string.
 *
 * Not a cryptographic digest: nothing here is a secret and nobody is trying to
 * forge a reading. What is needed is that the same birth produces the same
 * string on every machine, which a spec-defined number-to-string and a fixed
 * arithmetic give. Two rounds of FNV-1a with different offsets, so the answer
 * is sixty-four bits rather than thirty-two — a chapter holds thousands of
 * these, and thirty-two bits starts to collide at that scale.
 */
export function ocrIdentity(birth: OcrBirth): string {
  const preimage = [
    birth.source,
    birth.text,
    birth.x,
    birth.y,
    birth.width,
    birth.height,
    birth.confidence,
    // Joined on a separator no field can contain, or two readings whose
    // fields run together the same way would share an identity. A source
    // name and a reading are both arbitrary text; a unit separator is
    // neither typed by anyone nor emitted by any recognizer here.
  ].join('\u001f')
  return fnv1a(preimage, 0x811c9dc5) + fnv1a(preimage, 0x01000193)
}

function fnv1a(text: string, offset: number): string {
  let hash = offset
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    // The prime, multiplied in a way that does not lose the high bits to
    // JavaScript's float mantissa. Imul is a thirty-two-bit multiply.
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}
