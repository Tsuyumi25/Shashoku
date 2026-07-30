/**
 * The next free `<prefix>N`, for the things the panel creates without asking
 * for a name — a folder, a group, a layer.
 *
 * Counting from one past however many are taken rather than from one: a page
 * that has been worked on for a while would otherwise walk the whole run every
 * time, and the first number offered would drop back to 1 as soon as anything
 * was deleted, handing the same name to two different things in one session.
 */
export function nextAutoName(taken: ReadonlySet<string>, prefix: string): string {
  let n = taken.size + 1
  while (taken.has(`${prefix}${n}`)) n += 1
  return `${prefix}${n}`
}
