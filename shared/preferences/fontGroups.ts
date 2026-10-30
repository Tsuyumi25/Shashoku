/**
 * The name a new group gets: the one asked for, or that with the first free
 * number after it. Group names are what a person picks a group by, so no two
 * may read the same.
 */
export function freeGroupName(wanted: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  if (!used.has(wanted)) return wanted;
  for (let n = 2; ; n++) {
    const name = `${wanted} ${n}`;
    if (!used.has(name)) return name;
  }
}
