const STOPWORDS = new Set(
  "a an and are as at be by for from how i in is it me my near of on or the to vs what when where who why with your".split(" "),
);

// Just enough to treat "cars"/"car" and "cities"/"city" as the same word.
function stem(word: string) {
  if (word.length <= 3) return word;
  if (word.endsWith("ies")) return word.slice(0, -3) + "y";
  if (word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

function tokens(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((w) => !STOPWORDS.has(w)).map(stem);
}

// Which meaningful words of a search query don't appear in the text (e.g. a title tag).
export function missingQueryWords(query: string, text: string | null): string[] {
  const have = new Set(tokens(text ?? ""));
  const missing = new Set<string>();
  for (const word of query.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []) {
    if (!STOPWORDS.has(word) && !have.has(stem(word))) missing.add(word);
  }
  return [...missing];
}
