// Accent-insensitive matching for the pickers: typing "dia" has to find "día".
// Pure; unit-tested under Node.

/** Base letter + combining marks — the shape we fold away. */
const COMBINING_ONLY = /^\p{M}+$/u;

/**
 * The canonical display form. Folding is defined against THIS string, so a caller
 * can highlight fuzzy-match ranges on the displayed text without any index shift.
 */
export function displayForm(text: string): string {
	return text.normalize("NFC");
}

/**
 * Strip diacritics for matching, preserving length: `foldDiacritics(s).length` always
 * equals `displayForm(s).length`, so match offsets computed on the folded string point
 * at the right characters of the displayed one.
 *
 * Only accent-style decompositions are folded (base letter + combining marks). Scripts
 * whose decomposition is a sequence of real letters — Hangul syllables, for instance —
 * are left alone rather than silently reduced to their first jamo.
 */
export function foldDiacritics(text: string): string {
	let out = "";
	for (const ch of displayForm(text)) {
		const decomposed = ch.normalize("NFD");
		if (decomposed.length === ch.length) {
			out += ch; // nothing to fold
			continue;
		}
		const parts = [...decomposed];
		const base = parts[0] ?? ch;
		const rest = parts.slice(1).join("");
		// Fold only when the tail is purely combining marks AND the base occupies the
		// same number of UTF-16 units — that is what keeps the length invariant true.
		out += rest.length > 0 && COMBINING_ONLY.test(rest) && base.length === ch.length ? base : ch;
	}
	return out;
}
