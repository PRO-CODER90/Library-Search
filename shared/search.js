// Text helpers shared by the backend (search) and the browser (highlighting).
// Plain ES module with no dependencies and no knowledge of column names.

const COMBINING_MARKS = /[̀-ͯ]/g;

/** Lowercase and strip accents so "Café" matches "cafe". Any script works. */
export function normalize(value) {
  if (value === undefined || value === null) return "";
  return String(value).normalize("NFD").replace(COMBINING_MARKS, "").toLowerCase();
}

/** Split a raw query into normalized words. */
export function tokenize(query) {
  return normalize(query).trim().split(/\s+/).filter(Boolean);
}

/**
 * Codes like "R-07", "005.1" or "978-0-262" are also indexed without their
 * punctuation, so typing "r07" finds "R-07".
 */
export function compactVariant(normalizedValue) {
  // Per whitespace-separated token, so words never run together across spaces.
  return String(normalizedValue)
    .split(/\s+/)
    .filter((token) => /[\p{L}\p{M}\p{N}][^\p{L}\p{M}\p{N}]+[\p{L}\p{M}\p{N}]/u.test(token))
    .map((token) => token.replace(/[^\p{L}\p{M}\p{N}]+/gu, ""))
    .join(" ");
}

/**
 * Split `text` into segments marking where any query word matches,
 * ignoring case and accents: [{ text, match }].
 */
export function highlightSegments(text, query) {
  const source = text === undefined || text === null ? "" : String(text);
  const words = tokenize(query);
  if (!source || !words.length) return [{ text: source, match: false }];

  // Normalize character by character so positions map back to `source`.
  let normalized = "";
  const origin = [];
  for (let i = 0; i < source.length; i++) {
    const n = normalize(source[i]);
    for (let k = 0; k < n.length; k++) {
      normalized += n[k];
      origin.push(i);
    }
  }

  const marked = new Array(source.length).fill(false);
  for (const word of words) {
    let from = normalized.indexOf(word);
    while (from !== -1) {
      for (let k = from; k < from + word.length; k++) marked[origin[k]] = true;
      from = normalized.indexOf(word, from + 1);
    }
  }

  const segments = [];
  for (let i = 0; i < source.length; i++) {
    const last = segments[segments.length - 1];
    if (last && last.match === marked[i]) last.text += source[i];
    else segments.push({ text: source[i], match: marked[i] });
  }
  return segments;
}
