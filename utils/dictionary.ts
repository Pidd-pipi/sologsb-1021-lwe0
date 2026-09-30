import type { DictionaryEntry, DuplicatePair } from '~/types/dictionary';

export const normalizeWord = (value: string) => value
  .normalize('NFKC')
  .toLowerCase()
  .replace(/[\s·.'’\-_()[\]{}，。！？、]/g, '');

const bigrams = (value: string) => {
  const text = normalizeWord(value);
  if (text.length < 2) return text ? [text] : [];
  return Array.from({ length: text.length - 1 }, (_, index) => text.slice(index, index + 2));
};

export const similarity = (left: string, right: string) => {
  const a = bigrams(left);
  const b = bigrams(right);
  if (!a.length || !b.length) return 0;
  const remaining = [...b];
  let hits = 0;
  a.forEach((token) => {
    const index = remaining.indexOf(token);
    if (index >= 0) {
      hits += 1;
      remaining.splice(index, 1);
    }
  });
  return (2 * hits) / (a.length + b.length);
};

export const findDuplicates = (entries: DictionaryEntry[]): DuplicatePair[] => {
  const pairs: DuplicatePair[] = [];
  entries.forEach((left, index) => {
    entries.slice(index + 1).forEach((right) => {
      const headwordScore = similarity(left.headword, right.headword);
      const synonymScore = Math.max(0, ...left.synonyms.map((word) => similarity(word, right.headword)), ...right.synonyms.map((word) => similarity(word, left.headword)));
      const meaningScore = similarity(left.definition, right.definition) * .35;
      const score = Math.max(headwordScore, synonymScore * .92, meaningScore);
      if (score < .62) return;
      const reasons: string[] = [];
      if (headwordScore === score) reasons.push('词形高度相似');
      if (synonymScore * .92 === score) reasons.push('同义词交叉命中');
      if (meaningScore === score) reasons.push('释义相近');
      if (left.pronunciation && right.pronunciation && similarity(left.pronunciation, right.pronunciation) > .72) reasons.push('发音相近');
      pairs.push({ leftId: left.id, rightId: right.id, score: Math.min(1, score), reasons });
    });
  });
  return pairs.sort((a, b) => b.score - a.score);
};

export const referencesToEntry = (entries: DictionaryEntry[], target: DictionaryEntry) => {
  const names = new Set([target.headword, ...target.synonyms].map(normalizeWord));
  return entries.filter((entry) => entry.id !== target.id && (
    entry.synonyms.some((synonym) => names.has(normalizeWord(synonym)))
    || entry.definition.includes(target.headword)
    || entry.examples.some((example) => names.has(normalizeWord(example.source)))
  ));
};
