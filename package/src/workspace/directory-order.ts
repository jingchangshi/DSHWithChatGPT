/** Compare directory names, then types, using case-sensitive UTF-16 ordering. */
export function compareDirectoryEntries(left: { name: string; type: string }, right: { name: string; type: string }): number {
  return left.name < right.name ? -1 : left.name > right.name ? 1 : left.type < right.type ? -1 : left.type > right.type ? 1 : 0
}
