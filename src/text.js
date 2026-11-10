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

module.exports = { normalize, containsPhrase, slugify };
