const TSQUERY_SPECIAL_CHARS = /[':&|!()]/g;

/**
 * Builds a prefix tsquery for PostgreSQL `simple` config.
 * Example: "hello team" -> "hello:* & team:*"
 */
export function buildMessageSearchTsQuery(query: string): string | null {
  const terms = query
    .trim()
    .split(/\s+/)
    .map((term) => term.replace(TSQUERY_SPECIAL_CHARS, ' ').trim())
    .filter((term) => term.length >= 2);

  if (terms.length === 0) return null;

  return terms.map((term) => `${term}:*`).join(' & ');
}
