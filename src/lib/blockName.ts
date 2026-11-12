/**
 * Resolve a non-colliding block name. If `desired` already exists, strip any
 * trailing " (n)" suffix to get the base, then append the lowest free
 * " (2)", " (3)", … so copies/duplicates stay distinguishable.
 */
export function resolveUniqueName(desired: string, existing: { name: string }[]): string {
  const names = new Set(existing.map(b => b.name))
  if (!names.has(desired)) return desired
  const base = desired.replace(/\s*\(\d+\)$/, '')
  let n = 2
  while (names.has(`${base} (${n})`)) n++
  return `${base} (${n})`
}
