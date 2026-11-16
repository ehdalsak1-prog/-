/**
 * 2-beol-sik English QWERTY to Korean Hangul Transliterator
 * Converts accidental English keystrokes into Korean Hangul in real time.
 * Fully supports incremental keystroke composition, e.g.:
 * 'c' -> 'ㅊ', 'cj' -> '처', 'cjf' -> '철', 'cjfrm' -> '철그', 'cjfrms' -> '철근'
 * 'rkr' -> '각', 'rkrvkdlvm' -> '각파이프', 'dkssud' -> '안녕'
 * Also properly handles mixed Hangul + English typing by decomposing existing syllables first.
 */

// Initial consonants (초성 19개)
export const CHO = [
  'ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ',
  'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'
];

// Medial vowels (중성 21개)
export const JUNG = [
  'ㅏ', 'ㅐ', 'ㅑ', 'ㅒ', 'ㅓ', 'ㅔ', 'ㅕ', 'ㅖ', 'ㅗ', 'ㅘ',
  'ㅙ', 'ㅚ', 'ㅛ', 'ㅜ', 'ㅝ', 'ㅞ', 'ㅟ', 'ㅠ', 'ㅡ', 'ㅢ', 'ㅣ'
];

// Final consonants (종성 28개, 0 is empty)
export const JONG = [
  '', 'ㄱ', 'ㄲ', 'ㄳ', 'ㄴ', 'ㄵ', 'ㄶ', 'ㄷ', 'ㄹ', 'ㄺ',
  'ㄻ', 'ㄼ', 'ㄽ', 'ㄾ', 'ㄿ', 'ㅀ', 'ㅁ', 'ㅂ', 'ㅄ', 'ㅅ',
  'ㅆ', 'ㅇ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'
];

// QWERTY key to Korean jamo mapping (Standard 2-beol-sik)
export const KEY_MAP: Record<string, string> = {
  r: 'ㄱ', R: 'ㄲ',
  s: 'ㄴ',
  e: 'ㄷ', E: 'ㄸ',
  f: 'ㄹ',
  a: 'ㅁ',
  q: 'ㅂ', Q: 'ㅃ',
  t: 'ㅅ', T: 'ㅆ',
  d: 'ㅇ',
  w: 'ㅈ', W: 'ㅉ',
  c: 'ㅊ',
  z: 'ㅋ',
  x: 'ㅌ',
  v: 'ㅍ',
  g: 'ㅎ',
  k: 'ㅏ',
  o: 'ㅐ', O: 'ㅒ',
  i: 'ㅑ',
  j: 'ㅓ',
  p: 'ㅔ', P: 'ㅖ',
  u: 'ㅕ',
  h: 'ㅗ',
  y: 'ㅛ',
  n: 'ㅜ',
  b: 'ㅠ',
  m: 'ㅡ',
  l: 'ㅣ',
};

// Double vowels composition
const COMPOUND_VOWELS: Record<string, string> = {
  'ㅗㅏ': 'ㅘ',
  'ㅗㅐ': 'ㅙ',
  'ㅗㅣ': 'ㅚ',
  'ㅜㅓ': 'ㅝ',
  'ㅜㅔ': 'ㅞ',
  'ㅜㅣ': 'ㅟ',
  'ㅡㅣ': 'ㅢ',
};

// Double final consonants composition
const COMPOUND_JONG: Record<string, string> = {
  'ㄱㅅ': 'ㄳ',
  'ㄴㅈ': 'ㄵ',
  'ㄴㅎ': 'ㄶ',
  'ㄹㄱ': 'ㄺ',
  'ㄹㅁ': 'ㄻ',
  'ㄹㅂ': 'ㄼ',
  'ㄹㅅ': 'ㄽ',
  'ㄹㅌ': 'ㄾ',
  'ㄹㅍ': 'ㄿ',
  'ㄹㅎ': 'ㅀ',
  'ㅂㅅ': 'ㅄ',
};

const DECOMPOSE_JONG: Record<string, string[]> = {
  'ㄳ': ['ㄱ', 'ㅅ'],
  'ㄵ': ['ㄴ', 'ㅈ'],
  'ㄶ': ['ㄴ', 'ㅎ'],
  'ㄺ': ['ㄹ', 'ㄱ'],
  'ㄻ': ['ㄹ', 'ㅁ'],
  'ㄼ': ['ㄹ', 'ㅂ'],
  'ㄽ': ['ㄹ', 'ㅅ'],
  'ㄾ': ['ㄹ', 'ㅌ'],
  'ㄿ': ['ㄹ', 'ㅍ'],
  'ㅀ': ['ㄹ', 'ㅎ'],
  'ㅄ': ['ㅂ', 'ㅅ'],
  'ㄲ': ['ㄲ'],
  'ㅆ': ['ㅆ'],
};

const DECOMPOSE_JUNG: Record<string, string[]> = {
  'ㅘ': ['ㅗ', 'ㅏ'],
  'ㅙ': ['ㅗ', 'ㅐ'],
  'ㅚ': ['ㅗ', 'ㅣ'],
  'ㅝ': ['ㅜ', 'ㅓ'],
  'ㅞ': ['ㅜ', 'ㅔ'],
  'ㅟ': ['ㅜ', 'ㅣ'],
  'ㅢ': ['ㅡ', 'ㅣ'],
};

function isVowel(ch: string): boolean {
  return JUNG.includes(ch) || ['ㅏ', 'ㅐ', 'ㅑ', 'ㅒ', 'ㅓ', 'ㅔ', 'ㅕ', 'ㅖ', 'ㅗ', 'ㅛ', 'ㅜ', 'ㅠ', 'ㅡ', 'ㅣ'].includes(ch);
}

function isConsonant(ch: string): boolean {
  return CHO.includes(ch) || JONG.includes(ch);
}

/**
 * Decomposes Hangul syllables into individual constituent jamos.
 * E.g. '처' -> ['ㅊ', 'ㅓ'], '철' -> ['ㅊ', 'ㅓ', 'ㄹ'], '첡' -> ['ㅊ', 'ㅓ', 'ㄹ', 'ㄱ']
 */
export function decomposeHangul(str: string): string[] {
  const result: string[] = [];
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    const code = ch.charCodeAt(0);
    if (code >= 0xac00 && code <= 0xd7a3) {
      const offset = code - 0xac00;
      const jong = offset % 28;
      const jung = Math.floor(offset / 28) % 21;
      const cho = Math.floor(offset / (28 * 21));

      result.push(CHO[cho]);

      const jungChar = JUNG[jung];
      if (DECOMPOSE_JUNG[jungChar]) {
        result.push(...DECOMPOSE_JUNG[jungChar]);
      } else {
        result.push(jungChar);
      }

      if (jong > 0) {
        const jongChar = JONG[jong];
        if (DECOMPOSE_JONG[jongChar]) {
          result.push(...DECOMPOSE_JONG[jongChar]);
        } else {
          result.push(jongChar);
        }
      }
    } else {
      result.push(ch);
    }
  }
  return result;
}

/**
 * Combines an array of Korean jamos into fully assembled Hangul syllables.
 */
export function assembleHangul(jamos: string[]): string {
  let result = '';
  let i = 0;

  while (i < jamos.length) {
    const cur = jamos[i];

    // If current character is not a standard cho consonant, just output as-is
    const choIdx = CHO.indexOf(cur);
    if (choIdx === -1) {
      result += cur;
      i++;
      continue;
    }

    // Next must be a vowel to form a syllable
    if (i + 1 < jamos.length && isVowel(jamos[i + 1])) {
      let jung = jamos[i + 1];
      let step = 2;

      // Check if there's a compound vowel (e.g. ㅗ + ㅏ -> ㅘ)
      if (i + 2 < jamos.length && COMPOUND_VOWELS[jung + jamos[i + 2]]) {
        jung = COMPOUND_VOWELS[jung + jamos[i + 2]];
        step = 3;
      }

      const jungIdx = JUNG.indexOf(jung);
      if (jungIdx === -1) {
        result += cur;
        i++;
        continue;
      }

      // Check for final consonant (종성)
      let jongIdx = 0;
      let finalStep = step;

      const next1 = jamos[i + step];
      const next2 = jamos[i + step + 1];
      const next3 = jamos[i + step + 2];

      if (next1 && isConsonant(next1)) {
        // If next1 is followed by a vowel, next1 belongs to the NEXT syllable as its cho!
        if (next2 && isVowel(next2)) {
          jongIdx = 0;
        } else if (next2 && isConsonant(next2) && COMPOUND_JONG[next1 + next2]) {
          // Compound final consonant candidate
          // But if next2 is followed by a vowel, next2 goes to next syllable!
          if (next3 && isVowel(next3)) {
            // only next1 is jong
            const singleJong = JONG.indexOf(next1);
            if (singleJong > 0) {
              jongIdx = singleJong;
              finalStep = step + 1;
            }
          } else {
            // Both next1 and next2 form a compound jong!
            const comp = COMPOUND_JONG[next1 + next2];
            const compIdx = JONG.indexOf(comp);
            if (compIdx > 0) {
              jongIdx = compIdx;
              finalStep = step + 2;
            } else {
              const singleJong = JONG.indexOf(next1);
              if (singleJong > 0) {
                jongIdx = singleJong;
                finalStep = step + 1;
              }
            }
          }
        } else {
          // Single jong candidate
          const singleJong = JONG.indexOf(next1);
          if (singleJong > 0) {
            jongIdx = singleJong;
            finalStep = step + 1;
          }
        }
      }

      // Calculate Unicode Hangul code
      const syllableCode = 0xac00 + (choIdx * 21 + jungIdx) * 28 + jongIdx;
      result += String.fromCharCode(syllableCode);
      i += finalStep;
    } else {
      // Just single consonant
      result += cur;
      i++;
    }
  }

  return result;
}

/**
 * Converts English QWERTY letters to Korean 2-beol-sik string.
 * Preserves non-alphabet characters, punctuation, and properly handles mixed Hangul + English.
 */
export function engToKor(input: string): string {
  if (!input) return '';

  // 1. Decompose existing Hangul into basic jamos so incoming keystrokes compose seamlessly
  const decomposed = decomposeHangul(input);

  // 2. Map QWERTY keys to Korean jamos
  const jamos = decomposed.map((ch) => (KEY_MAP[ch] !== undefined ? KEY_MAP[ch] : ch));

  // 3. Assemble jamos into proper Hangul syllables
  return assembleHangul(jamos);
}

/**
 * Checks if the text contains any English letters that can be converted to Korean.
 */
export function hasEnglishToKorCandidate(input: string): boolean {
  if (!input || !/[a-zA-Z]/.test(input)) return false;
  const converted = engToKor(input);
  return converted !== input && /[가-힣ㄱ-ㅎ]/.test(converted);
}
