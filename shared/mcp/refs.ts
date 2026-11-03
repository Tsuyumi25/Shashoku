import { letterOf, noOfLetter } from "../page/numbers";
import { blocksOf, placeOfBlock, type FacePage } from "../page/units";

/**
 * How an agent names a piece of the project.
 *
 * ```
 * p7/14      sentence 14, standing for its one block of lettering
 * p7/14.2    block 2 of sentence 14
 * p7/14.2b   candidate b in that block's drawer
 * p7/14b     the same, where the sentence is set in one block
 * ```
 *
 * The page id is a directory name, so it is matched as anything without a
 * slash rather than as `p` and a number: books made before pages were named
 * that way still hold long names.
 */
export interface TextRef {
  pageId: string;
  /** The face number written in the address; absent, the call's face reads it. */
  face?: number;
  sentence: number;
  block?: number;
  candidate?: number;
}

export const REF_SYNTAX =
  "位址的格式是 p7/f2/14（f2 面的整句）、p7/f2/14.2（這一句的第 2 塊）或 p7/f2/14.2b（那一塊抽屜裡的候選 b）；省略 f2 時用這次呼叫的 face";

const REF = /^([^/\s]+)(?:\/f([1-9]\d*))?\/([1-9]\d*)(?:\.([1-9]\d*))?([a-z]+)?$/;

export function parseRef(raw: string): TextRef | null {
  const m = REF.exec(raw.trim());
  if (m === null) return null;
  const candidate = m[5] === undefined ? undefined : noOfLetter(m[5]);
  if (candidate === null) return null;
  return {
    pageId: m[1],
    ...(m[2] === undefined ? {} : { face: Number(m[2]) }),
    sentence: Number(m[3]),
    ...(m[4] === undefined ? {} : { block: Number(m[4]) }),
    ...(candidate === undefined ? {} : { candidate }),
  };
}

export function formatRef(ref: TextRef): string {
  const face = ref.face === undefined ? "" : `/f${ref.face}`;
  const block = ref.block === undefined ? "" : `.${ref.block}`;
  const letter = ref.candidate === undefined ? "" : letterOf(ref.candidate);
  return `${ref.pageId}${face}/${ref.sentence}${block}${letter}`;
}

/** The same address with any face written in it left out — how a face's own listing spells it. */
export function withoutFace(raw: string): string {
  const ref = parseRef(raw);
  if (ref === null) return raw;
  const { face: _, ...rest } = ref;
  return formatRef(rest);
}

/** The face number in `f2`, or null for anything that is not one. */
export function parseFaceRef(raw: string): number | null {
  const m = /^f([1-9]\d*)$/.exec(raw.trim());
  return m === null ? null : Number(m[1]);
}

/**
 * The address an agent would use for one block as `page` reads it, face
 * written in so it means the same thing whatever face the call names: the
 * block itself for lettering — written as its sentence where the sentence is
 * set in that one block — and its sentence for the artwork's words, which no
 * write names. Null for a block no sentence of this face holds.
 */
export function refOfBlock(pageId: string, face: number, page: FacePage, blockId: string): string | null {
  const place = placeOfBlock(page, blockId);
  const sentence = place?.unit.no;
  if (!place || sentence === undefined) return null;
  if (place.side === "source") return formatRef({ pageId, face, sentence });
  const lettering = blocksOf(page, place.unit, "translation");
  const block = lettering.find((b) => b.id === blockId)?.no;
  if (lettering.length === 1 || block === undefined) return formatRef({ pageId, face, sentence });
  return formatRef({ pageId, face, sentence, block });
}
