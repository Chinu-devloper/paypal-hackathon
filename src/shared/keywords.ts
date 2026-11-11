const STOPWORDS = new Set([
  "must", "include", "least", "with", "that", "have", "from", "will", "should", "every", "each", "your", "into",
  "this", "than", "then", "them", "they", "also", "only", "such", "when", "where", "which", "while", "about",
  "provide", "deliver", "ensure", "using", "used", "following", "contain", "contains", "more", "well",
]);

/** Significant words of an acceptance criterion, used by the demo engine and the sample builder. */
export function keywords(criterion: string): string[] {
  const words = criterion.toLowerCase().match(/[a-z][a-z0-9-]{3,}/g) ?? [];
  return [...new Set(words.filter((w) => !STOPWORDS.has(w)))];
}
