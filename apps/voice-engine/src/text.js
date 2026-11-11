// Transcript cleanup. whisper.cpp output contains non-speech markers ("[BLANK_AUDIO]",
// "(música)", "[Aplausos]"), line breaks per segment and, on silence, a few well-known
// hallucinated phrases learned from subtitle data. None of that should be typed.

// Whole-transcript hallucinations Whisper is known to emit on silence/noise. Compared after
// normalisation (lowercase, no accents/punctuation) and only when they are the ENTIRE text,
// so a real sentence that contains these words is never altered.
const HALLUCINATIONS = [
  'legendas pela comunidade amara org',
  'legenda adriana zanotto',
  'obrigado por assistir',
  'obrigada por assistir',
  'thanks for watching',
  'thank you for watching',
  'subtitles by the amara org community',
  'you',
];

function normalise(s) {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Raw whisper stdout -> one clean line of text ('' when nothing useful was said).
 */
export function cleanTranscript(raw) {
  let s = String(raw ?? '');
  // Timestamps, in case the caller ran whisper without -nt: "[00:00:00.000 --> 00:00:02.000]"
  s = s.replace(/\[\d{2}:\d{2}[:.\d]*\s*-->\s*\d{2}:\d{2}[:.\d]*\]/g, ' ');
  // Non-speech markers: [BLANK_AUDIO], [Música], [ Silence ], (risos), *music*, ♪ ... ♪
  s = s.replace(/\[[^\]\n]*\]/g, ' ');
  // Short parentheticals made only of letters (1-3 words) are sound tags: "(música)", "(risos)".
  s = s.replace(/\(\s*\p{L}+(?:\s+\p{L}+){0,2}\s*\)/gu, ' ');
  s = s.replace(/\*[^*\n]{1,30}\*/g, ' ');
  s = s.replace(/[♪♫]+[^♪♫\n]*[♪♫]*/g, ' ');
  // Segments come one per line: join them into a single line.
  s = s.replace(/[\r\n\t]+/g, ' ');
  // Remove control chars (would become strange keystrokes) and collapse whitespace.
  // eslint-disable-next-line no-control-regex
  s = s.replace(/[\u0000-\u001f\u007f]/g, ' ');
  s = s.replace(/\s{2,}/g, ' ').trim();
  // Spaces before punctuation left by removed markers: "olá , mundo" -> "olá, mundo"
  s = s.replace(/\s+([,.;:!?…])/g, '$1');
  if (!s || /^[\s.,;:!?…-]*$/.test(s)) return '';
  if (HALLUCINATIONS.includes(normalise(s))) return '';
  return s;
}

/** Final text to insert, honoring voice.appendSpace. */
export function finalizeText(clean, { appendSpace = true } = {}) {
  if (!clean) return '';
  return appendSpace ? `${clean} ` : clean;
}
