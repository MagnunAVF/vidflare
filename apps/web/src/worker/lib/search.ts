// Words beyond this are ignored: every term narrows the result (implicit AND), so more add
// little, and it bounds the work one query can ask of FTS5.
export const SEARCH_MAX_TERMS = 8

// Runs of letters, digits and combining marks: what the unicode61 tokenizer keeps as a token.
const WORD = /[\p{L}\p{N}\p{M}]+/gu

// Turns free text into a safe FTS5 MATCH expression: every word becomes a quoted string (so
// quotes, `*`, `-`, `:`, parentheses and AND/OR/NOT/NEAR are plain text, never syntax), all
// words must match, and the last one also matches as a prefix ("sourd" finds "sourdough").
// null when the text has no searchable word (e.g. only punctuation).
export function toFtsQuery(text: string): string | null {
  const words = text.match(WORD)?.slice(0, SEARCH_MAX_TERMS)
  if (!words?.length) return null
  return words.map((w, i) => (i === words.length - 1 ? `"${w}"*` : `"${w}"`)).join(' ')
}
