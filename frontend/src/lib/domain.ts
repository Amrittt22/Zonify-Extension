/** Pure domain validation for the blocklist input. */

const HOSTNAME_RE =
  /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/;

/**
 * Normalize user input to a bare lowercase hostname.
 * Strips protocol, "www.", paths, queries, fragments and ports.
 * Returns null when the result is not a valid hostname (duplicates are
 * checked separately by the caller).
 */
export function normalizeDomain(input: string): string | null {
  let value = input.trim().toLowerCase();
  if (!value) return null;

  value = value.replace(/^[a-z][a-z0-9+.-]*:\/\//, ''); // protocol
  value = value.replace(/^\/\//, ''); // protocol-relative "//"
  value = value.split(/[/?#]/, 1)[0] ?? ''; // path / query / hash
  if (value.startsWith('[')) return null; // IPv6 literals unsupported
  value = value.split(':', 1)[0] ?? ''; // port
  value = value.replace(/^www\./, ''); // www prefix
  value = value.replace(/\.+$/, ''); // trailing dots

  if (!value) return null;
  if (value === 'localhost') return value;
  if (!HOSTNAME_RE.test(value)) return null;
  return value;
}
