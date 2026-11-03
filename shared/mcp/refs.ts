import { letterOf, noOfLetter } from "../page/numbers";

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
  sentence: number;
  block?: number;
  candidate?: number;
}

export const REF_SYNTAX =
  "位址的格式是 p7/14（整句）、p7/14.2（這一句的第 2 塊）或 p7/14.2b（那一塊抽屜裡的候選 b）";

const REF = /^([^/\s]+)\/([1-9]\d*)(?:\.([1-9]\d*))?([a-z]+)?$/;

export function parseRef(raw: string): TextRef | null {
  const m = REF.exec(raw.trim());
  if (m === null) return null;
  const candidate = m[4] === undefined ? undefined : noOfLetter(m[4]);
  if (candidate === null) return null;
  return {
    pageId: m[1],
    sentence: Number(m[2]),
    ...(m[3] === undefined ? {} : { block: Number(m[3]) }),
    ...(candidate === undefined ? {} : { candidate }),
  };
}

export function formatRef(ref: TextRef): string {
  const block = ref.block === undefined ? "" : `.${ref.block}`;
  const letter = ref.candidate === undefined ? "" : letterOf(ref.candidate);
  return `${ref.pageId}/${ref.sentence}${block}${letter}`;
}

/** The face number in `f2`, or null for anything that is not one. */
export function parseFaceRef(raw: string): number | null {
  const m = /^f([1-9]\d*)$/.exec(raw.trim());
  return m === null ? null : Number(m[1]);
}

export function faceRef(no: number): string {
  return `f${no}`;
}
