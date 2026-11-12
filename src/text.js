'use strict';

// Lowercase, strip diacritics (Ọ̀ṣun → osun), turn punctuation into spaces.
function normalize(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// True when every word of `needle` appears in `haystack`, in order, as whole words.
function containsPhrase(haystack, needle) {
  const h = ` ${normalize(haystack)} `;
  const n = normalize(needle);
  if (!n) return false;
  return h.includes(` ${n} `);
}

function slugify(value) {
  return normalize(value).replace(/ /g, '-');
}

// Grouping key for one film or show: ignores accents, apostrophes, a plural s, and leftover words like
// "Season", "Complete Season" or "Season Finale" ("Jenifa's Diary Season" = "Jenifas Diary").
function groupKey(name) {
  return normalize(String(name).replace(/['’`]/g, ''))
    .replace(/\b(?:complete|compete|complet|compele)?\s*seasons?\b(?:\s*finale)?/g, ' ')
    .replace(/\bfinal(?:e)?\b/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((w) => w.replace(/s$/, ''))
    .join(' ');
}

module.exports = {
  groupKey, normalize, containsPhrase, slugify };
