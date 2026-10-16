import pdfParse from 'pdf-parse';
import { extractQuizPdfWithGemini } from './geminiPdfExtractor.js';

export interface ParsedOption {
  key: string;
  text: string;
  imageUrl?: string;
}

export interface ParsedQuestion {
  questionNumber: number;
  topicName?: string;
  questionText: string;
  questionType?: 'MCQ' | 'SHORT_ANSWER';
  acceptableAnswers?: string[];
  imageUrl?: string;
  imageCaption?: string;
  options: ParsedOption[];
  correctAnswer: string;
  marks: number;
  explanation: string;
  errors: string[];
}

export interface PdfParseResult {
  subjectName: string;
  defaultTopicName: string;
  parsedQuestions: ParsedQuestion[];
  validationErrors: string[];
}

/**
 * FM-Abhaya / Legacy Sinhala font to Unicode Sinhala converter.
 * In Sri Lanka, many school/tuition PDF exam papers are typed in FM-Abhaya or DL-Manel fonts.
 */
const FM_SPECIAL_MAP: [RegExp, string][] = [
  // Multi-character ligatures and special combinations
  [/fm%/g, 'ප්‍රෙ'],
  [/fl%/g, 'ක්‍රෙ'],
  [/fc%/g, 'ග්‍රෙ'],
  [/fi%/g, 'ස්‍රෙ'],
  [/fo%/g, 'ද්‍රෙ'],
  [/fn%/g, 'බ්‍රෙ'],
  [/fj%/g, 'ට්‍රෙ'],
  [/fv%/g, 'ඩ්‍රෙ'],
  [/m%/g, 'ප්‍ර'],
  [/l%/g, 'ක්‍ර'],
  [/c%/g, 'ග්‍ර'],
  [/i%/g, 'ස්‍ර'],
  [/o%/g, 'ද්‍ර'],
  [/n%/g, 'බ්‍ර'],
  [/j%/g, 'ට්‍ර'],
  [/v%/g, 'ඩ්‍ර'],
  [/L%/g, 'ඛ්‍ර'],
  [/Y%/g, 'ශ්‍ර'],
  [/y%/g, 'ත්‍ර'],
  [/H%/g, 'ජ්‍ර'],

  // Bandi Akuru & special combinations
  [/CI/g, 'ක්‍ෂ'],
  [/Cj/g, 'ක්‍ෂ'],
  [/\{\}/g, 'ඥ'],
  [/\{/g, 'ඥ'],
  [/\}/g, 'ඤ'],
  [/`o/g, 'ඳ'],
  [/`v/g, 'ඬ'],
  [/`c/g, 'ඟ'],
  [/`j/g, 'ඦ'],
  [/`n/g, 'ඹ'],
  [/~/g, 'ත්‍ව'],

  // Special vowels & kombuwa combinations
  [/fI/g, 'ෂෙ'],
  [/ff/g, 'ෛ'],
  [/f/g, 'ෙ'], // Kombuwa (handled before consonants)
  [/F/g, 'ේ'],
  [/D/g, 'ෞ'],
];

const FM_CONSONANT_MAP: Record<string, string> = {
  k: 'න',
  K: 'ණ',
  l: 'ක',
  L: 'ඛ',
  c: 'ග',
  C: 'ඝ',
  p: 'ච',
  P: 'ඡ',
  c2: 'ජ',
  j: 'ට',
  J: 'ඨ',
  v: 'ඩ',
  V: 'ඪ',
  y: 'ත',
  Y: 'ථ',
  o: 'ද',
  O: 'ධ',
  m: 'ප',
  M: 'ඵ',
  n: 'බ',
  N: 'භ',
  u: 'ම',
  h: 'ය',
  r: 'ර',
  ',': 'ල',
  '.': 'ව',
  i: 'ස',
  I: 'ෂ',
  y2: 'හ',
  '<': 'ළ',
  x: 'ෆ',
  w: 'අ',
  W: 'උ',
  b: 'ඉ',
  B: 'ඊ',
  t: 'එ',
  T: 'ඒ',
  q: 'ු',
  Q: 'ූ',
  s: 'ි',
  S: 'ී',
  d: 'ා',
  ';': '්',
  e: 'ැ',
  E: 'ෑ',
  '/': 'ර',
  '?': '?',
};

export function convertFmToUnicode(text: string): string {
  if (!text) return '';

  // Check if text is likely FM font encoded:
  // Typical FM signatures: "m%Yak", "ms<s;=re", "ksje/os", "úoHdj", "f;dr;=re", "fõ", "fkd"
  const fmSignature = /(?:m%Yak|ms<s;=re|ksje\/os|úoHdj|f;dr;=re|wxl|fõ|fkd|fld|fl|fm|fo|fi|úNd\.)/i;
  const hasSinhalaUnicode = /[\u0D80-\u0DFF]/.test(text);

  if (!fmSignature.test(text) && hasSinhalaUnicode) {
    // Already modern Unicode Sinhala
    return text;
  }

  let converted = text;

  // Apply multi-character FM replacements
  for (const [re, rep] of FM_SPECIAL_MAP) {
    converted = converted.replace(re, rep);
  }

  // Handle kombuwa reordering in FM: "f" + consonant -> consonant + "ෙ"
  converted = converted.replace(/ෙ([a-zA-Z,.<>])/g, (_match, ch) => {
    const sinhalaChar = FM_CONSONANT_MAP[ch] || ch;
    return sinhalaChar + 'ෙ';
  });

  // Convert individual FM characters
  let result = '';
  for (let i = 0; i < converted.length; i++) {
    const ch = converted[i];
    result += FM_CONSONANT_MAP[ch] !== undefined ? FM_CONSONANT_MAP[ch] : ch;
  }

  return result;
}

/**
 * Repairs common Sinhala font artifacts and character collisions:
 * - Fixes Kombuva (ෙ) wrongly encoded/extracted as 'ව' (e.g. වනා -> නො, වපා -> පො, වස්වා -> සේවා, වවනස් -> වෙනස්)
 * - Fixes Rakaransaya collisions (පරකාශ -> ප්‍රකාශ, පරවාහන -> ප්‍රවාහන, කරමය -> ක්‍රමය)
 * - Fixes Yansaya collisions (වයාපාර -> ව්‍යාපාර, අධයාපන -> අධ්‍යාපන, වාණිජයය -> වාණිජ්‍යය)
 * - Fixes Bandi Akuru (පුේගල -> පුද්ගල, සිේීන් -> සිද්ධීන්, උේධමන -> උද්ධමන, ේවිතීයික -> ද්විතීයික)
 * - Fixes vowel signs and diacritics (රැ -> රු, රෑ -> රූ, මට්ටටම -> මට්ටම, ඔප්පපුව -> ඔප්පුව)
 */
export function repairSinhalaPdfFontArtifacts(text: string): string {
  if (!text) return '';

  let s = text;

  // 1. Double letter / OCR ligature anomalies:
  s = s.replace(/මට්ටටම/g, 'මට්ටම');
  s = s.replace(/ඔප්පපුව/g, 'ඔප්පුව');
  s = s.replace(/තෘප්පති/g, 'තෘප්ති');
  s = s.replace(/විශ්වාාස/g, 'විශ්වාස');
  s = s.replace(/[\u0C00-\u0C7F]+[ා-ෞ්\u0D80-\u0DFF]*/g, 'විශ්වාස');
  s = s.replace(/වාවිශ්වාස/g, 'විශ්වාස');
  s = s.replace(/විශ්වාා+ස?/g, 'විශ්වාස');
  s = s.replace(/ස්පර්ශ්‍/g, 'ස්පර්ශ');
  s = s.replace(/පරකාශ්‍/g, 'ප්‍රකාශ');
  s = s.replace(/පරකාශ්‍ය/g, 'ප්‍රකාශය');
  s = s.replace(/අංශ්‍ය/g, 'අංශය');
  s = s.replace(/ලාභාංශ්‍/g, 'ලාභාංශ');
  s = s.replace(/ශ්‍ක්ති/g, 'ශක්ති');
  s = s.replace(/ශ්‍ක්තී/g, 'ශක්තී');
  s = s.replace(/පාර්්ව/g, 'පාර්ශ්ව');
  s = s.replace(/පාර්ග්ව්‍/g, 'පාර්ශ්ව');
  s = s.replace(/පාර්ග්ව/g, 'පාර්ශ්ව');

  // 2. Kombuwa-as-va before 'න' + 'ා' -> 'නො'
  s = s.replace(/වනා([හමකවගදතපබයලසජචණඤඥටඩණඳඬ])(?=[්ා-ෞ\u0D80-\u0DFF]|$)/g, 'නො$1');
  s = s.replace(/වනාවන්වන්/g, 'නොවන්නේ');
  s = s.replace(/වනාවේ/g, 'නොවේ');
  s = s.replace(/වනාවන/g, 'නොවන');
  s = s.replace(/වනාකරමින්/g, 'නොකරමින්');

  // 3. Kombuwa-as-va before 'ප' + 'ා' -> 'පො'
  s = s.replace(/වපාදු/g, 'පොදු');
  s = s.replace(/වපාදුවේ/g, 'පොදුවේ');
  s = s.replace(/වපාළ/g, 'පොළ');
  s = s.replace(/වපා([දලළරගකතමහයසන])(?=[්ා-ෞ\u0D80-\u0DFF]|$)/g, 'පො$1');

  // 4. Kombuwa-as-va before other consonants + 'ා' -> consonant + 'ො'
  s = s.replace(/වකාණ්ඩ/g, 'කොණ්ඩ');
  s = s.replace(/වකාටස්/g, 'කොටස්');
  s = s.replace(/වතාග/g, 'තොග');
  s = s.replace(/වතාරතුරැ/g, 'තොරතුරු');
  s = s.replace(/වතාරතුරු/g, 'තොරතුරු');
  s = s.replace(/වගාඩනැගිලි/g, 'ගොඩනැගිලි');
  s = s.replace(/වසායා/g, 'සොයා');

  // 5. Kombuwa-as-va before consonant + 'ෝ' -> consonant + 'ෝ'
  s = s.replace(/වතෝර/g, 'තෝර');
  s = s.replace(/වමෝස්තර/g, 'මෝස්තර');
  s = s.replace(/වගෝලීය/g, 'ගෝලීය');
  s = s.replace(/පරිවභෝජන/g, 'පරිභෝජන');
  s = s.replace(/පාරිවභෝගික/g, 'පාරිභෝගික');
  s = s.replace(/ස්වයංවපෝෂිත/g, 'ස්වයංපෝෂිත');

  // 6. Kombuwa-as-va before consonant + 'ෞ' -> consonant + 'ෞ'
  s = s.replace(/වභෞතික/g, 'භෞතික');

  // 7. Kombuwa-as-va before 'ස්' -> 'සේ'
  s = s.replace(/වස්වා/g, 'සේවා');
  s = s.replace(/වස්වක/g, 'සේවක');
  s = s.replace(/වස්ව/g, 'සේව');
  s = s.replace(/නිවවස්/g, 'නිවසේ');

  // 8. Kombuwa-as-va before 'ව' -> 'වෙ'
  s = s.replace(/දැක්වවන/g, 'දැක්වෙන');
  s = s.replace(/පහසුවවන්/g, 'පහසුවෙන්');
  s = s.replace(/අනුපිළිවවල/g, 'අනුපිළිවෙල');
  s = s.replace(/වවනස්/g, 'වෙනස්');
  s = s.replace(/වවවළඳ/g, 'වෙළෙඳ');
  s = s.replace(/වවන්/g, 'වෙන්');
  s = s.replace(/වවනුවෙන්/g, 'වෙනුවෙන්');
  s = s.replace(/වවනුවවන්/g, 'වෙනුවෙන්');
  s = s.replace(/වවත/g, 'වෙත');

  // 9. Kombuwa-as-va before 'ද' -> 'දෙ'
  s = s.replace(/ගනුවදනු/g, 'ගනුදෙනු');
  s = s.replace(/වදක/g, 'දෙක');
  s = s.replace(/වදනා/g, 'දෙනා');
  s = s.replace(/වදනු/g, 'දෙනු');
  s = s.replace(/උපවදස්/g, 'උපදෙස්');

  // 10. Kombuwa-as-va before 'බ' -> 'බෙ'
  s = s.replace(/වබදා/g, 'බෙදා');
  s = s.replace(/වබදී/g, 'බෙදී');

  // 11. Kombuwa-as-va before 'ය' -> 'යෙ'
  s = s.replace(/වයදවුම්/g, 'යෙදවුම්');
  s = s.replace(/කරැ/g, 'කරු');
  s = s.replace(/න්වේ/g, 'න්ගේ');
  s = s.replace(/අවයකු/g, 'අයෙකු');
  s = s.replace(/පුේගලවයකු/g, 'පුද්ගලයෙකු');
  s = s.replace(/පුේගලයාවගන්/g, 'පුද්ගලයාගෙන්');
  s = s.replace(/දියණියවේ/g, 'දියණියගේ');
  s = s.replace(/අයවේ/g, 'අයගේ');
  s = s.replace(/ජනතාවවේ/g, 'ජනතාවගේ');
  s = s.replace(/සේවකයින්වේ/g, 'සේවකයින්ගේ');
  s = s.replace(/ශිල්පීන්වේ/g, 'ශිල්පීන්ගේ');
  s = s.replace(/ගනුදෙනුකරුවන්වේ/g, 'ගනුදෙනුකරුවන්ගේ');
  s = s.replace(/ගනුදෙනුකරැවන්වේ/g, 'ගනුදෙනුකරුවන්ගේ');
  s = s.replace(/වස්වකයින්වේ/g, 'සේවකයින්ගේ');
  s = s.replace(/වයාපාරවේ/g, 'ව්‍යාපාරයේ');
  s = s.replace(/විකාශ්‍නවේ/g, 'විකාශනයේ');
  s = s.replace(/විකාශනවේ/g, 'විකාශනයේ');
  s = s.replace(/රැකියාවේ/g, 'රැකියාවේ');
  s = s.replace(/සංවිධානවේ/g, 'සංවිධානයේ');
  s = s.replace(/පරිසරවේ/g, 'පරිසරයේ');
  s = s.replace(/ජනගහනවේ/g, 'ජනගහනයේ');
  s = s.replace(/පරම්පරාවේ/g, 'පරම්පරාවේ');
  s = s.replace(/නිෂ්පාදනවේ/g, 'නිෂ්පාදනයේ');
  s = s.replace(/කරමවේ/g, 'ක්‍රමයේ');
  s = s.replace(/ක්‍රමවේ/g, 'ක්‍රමයේ');
  s = s.replace(/කිරීවම්/g, 'කිරීමේ');
  s = s.replace(/කිරීවමන්/g, 'කිරීමෙන්');
  s = s.replace(/ගැනීවම්/g, 'ගැනීමේ');
  s = s.replace(/සැපයීවම්/g, 'සැපයීමේ');
  s = s.replace(/යාවම්/g, 'යාමේ');
  s = s.replace(/අධයයනවයන්/g, 'අධ්‍යයනයෙන්');
  s = s.replace(/භාවිතවයන්/g, 'භාවිතයෙන්');
  s = s.replace(/සම්බන්ධවයන්/g, 'සම්බන්ධයෙන්');
  s = s.replace(/වයකු/g, 'යෙකු');
  s = s.replace(/සපයන්නාවගන්/g, 'සපයන්නාගෙන්');
  s = s.replace(/පුද්ගලයාවගන්/g, 'පුද්ගලයාගෙන්');
  s = s.replace(/යාවගන්/g, 'යාගෙන්');
  s = s.replace(/යින්වගන්/g, 'යින්ගෙන්');

  // 12. Kombuwa-as-va before 'ල' -> 'ලෙ'
  s = s.replace(/වලස/g, 'ලෙස');
  s = s.replace(/අවලවිකරණ/g, 'අලෙවිකරණ');

  // 13. Kombuwa-as-va before 'හ' -> 'හෙ' / 'ක' -> 'කෙ'
  s = s.replace(/වමවහයුම්/g, 'මෙහෙයුම්');
  s = s.replace(/වකවරහි/g, 'කෙරෙහි');
  s = s.replace(/වකවස්/g, 'කෙසේ');
  s = s.replace(/වකවර්/g, 'කෙරේ');

  // 14. Kombuwa-as-va before 'ග' / 'ත්'
  s = s.replace(/වගවත්වත්/g, 'ගෙවත්තේ');
  s = s.replace(/වගවීම/g, 'ගෙවීම');
  s = s.replace(/වගවී/g, 'ගෙවී');
  s = s.replace(/හඳුනාවගන/g, 'හඳුනාගෙන');
  s = s.replace(/වත් සහ රබර්/g, 'තේ සහ රබර්');
  s = s.replace(/වල්ඛන/g, 'ලේඛන');

  // 15. 'වේ' where 'දේ' or 'හේ' belongs
  s = s.replace(/වේවල්/g, 'දේවල්');
  s = s.replace(/වේශීය/g, 'දේශීය');
  s = s.replace(/විවේශීය/g, 'විදේශීය');
  s = s.replace(/වේශ්‍පාලන/g, 'දේශපාලන');
  s = s.replace(/දේශ්‍පාලන/g, 'දේශපාලන');
  s = s.replace(/ආවේශ්‍න/g, 'ආදේශන');
  s = s.replace(/ආවේශන/g, 'ආදේශන');
  s = s.replace(/නිර්වේශ්‍ය/g, 'නිර්දේශය');
  s = s.replace(/නිර්වේශය/g, 'නිර්දේශය');
  s = s.replace(/වේතුව/g, 'හේතුව');
  s = s.replace(/වන්වන්/g, 'වන්නේ');
  s = s.replace(/හැක්වක්/g, 'හැක්කේ');
  s = s.replace(/බලපාන්වන්/g, 'බලපාන්නේ');

  // 16. Rakaransaya ('පර' -> 'ප්‍ර', 'කර' -> 'ක්‍ර', etc.)
  s = s.replace(/පරකාශ/g, 'ප්‍රකාශ');
  s = s.replace(/පරකාශ්‍ය/g, 'ප්‍රකාශය');
  s = s.replace(/පරවාහන/g, 'ප්‍රවාහන');
  s = s.replace(/පරධාන/g, 'ප්‍රධාන');
  s = s.replace(/පරව්‍ණතා/g, 'ප්‍රවණතා');
  s = s.replace(/පරවණතා/g, 'ප්‍රවණතා');
  s = s.replace(/පරාථමික/g, 'ප්‍රාථමික');
  s = s.replace(/පරාේධන/g, 'ප්‍රාග්ධන');
  s = s.replace(/පරජා/g, 'ප්‍රජා');
  s = s.replace(/පරචාරණ/g, 'ප්‍රචාරණ');
  s = s.replace(/පරතිලාභ/g, 'ප්‍රතිලාභ');
  s = s.replace(/පරසාද/g, 'ප්‍රසාද');
  s = s.replace(/පරමාණ/g, 'ප්‍රමාණ');
  s = s.replace(/කරමය/g, 'ක්‍රමය');
  s = s.replace(/කරමවේ/g, 'ක්‍රමයේ');
  s = s.replace(/(?:අර්ථ|හුවමාරු|හුවමාරැ)\s+කරම/g, (m) => m.replace('කරම', 'ක්‍රම'));
  s = s.replace(/කාලානුකරමික/g, 'කාලානුක්‍රමික');
  s = s.replace(/වකරනිෂ්පාදන/g, 'වක්‍ර නිෂ්පාදන');
  s = s.replace(/ශීීලංකා/g, 'ශ්‍රී ලංකා');
  s = s.replace(/ශීී\s*ලංකා/g, 'ශ්‍රී ලංකා');
  s = s.replace(/ස්තීීපුරැෂ/g, 'ස්ත්‍රී පුරුෂ');
  s = s.replace(/ස්තීී\s*පුරැෂ/g, 'ස්ත්‍රී පුරුෂ');
  s = s.replace(/ස්ත්‍රී\s*පුරැෂ/g, 'ස්ත්‍රී පුරුෂ');
  s = s.replace(/මිශ්‍ීණ/g, 'මිශ්‍රණ');
  s = s.replace(/මිශ්‍රීණ/g, 'මිශ්‍රණ');
  s = s.replace(/විප්පලව/g, 'විප්ලව');

  // 17. Yansaya ('වයා' -> 'ව්‍යා', 'අධයා' -> 'අධ්‍යා', etc.)
  s = s.replace(/වයාපාර/g, 'ව්‍යාපාර');
  s = s.replace(/අධයාපන/g, 'අධ්‍යාපන');
  s = s.replace(/අධයයන/g, 'අධ්‍යයන');
  s = s.replace(/අභයන්තර/g, 'අභ්‍යන්තර');
  s = s.replace(/වාණිජයය/g, 'වාණිජ්‍යය');
  s = s.replace(/වාණිජය/g, 'වාණිජ්‍ය');
  s = s.replace(/සතය/g, 'සත්‍ය');
  s = s.replace(/අතයවශ්‍ය/g, 'අත්‍යවශ්‍ය');
  s = s.replace(/වයවසායක/g, 'ව්‍යවසායක');
  s = s.replace(/වුහය/g, 'ව්‍යූහය');
  s = s.replace(/වුහ/g, 'ව්‍යූහ');
  s = s.replace(/මූලය රක්ෂණ/g, 'මූල්‍ය රක්ෂණ');

  // 18. Bandi Akuru & ligatures:
  s = s.replace(/පුේගල/g, 'පුද්ගල');
  s = s.replace(/සිේීන්/g, 'සිද්ධීන්');
  s = s.replace(/උේධමන/g, 'උද්ධමන');
  s = s.replace(/ේවිතීයික/g, 'ද්විතීයික');
  s = s.replace(/ආර්ික/g, 'ආර්ථික');
  s = s.replace(/නනතික/g, 'නෛතික');
  s = s.replace(/ස්ූටර/g, 'ස්කූටර');
  s = s.replace(/විනාකම්/g, 'වටිනාකම්');
  s = s.replace(/වර්ීකරණ/g, 'වර්ගීකරණ');
  s = s.replace(/වර්ග්ීකරණ/g, 'වර්ගීකරණ');
  s = s.replace(/අවප්පක්ෂා/g, 'අපේක්ෂා');
  s = s.replace(/සිින/g, 'සිටින');
  s = s.replace(/වි්වාස/g, 'විශ්වාස');
  s = s.replace(/පේධති/g, 'පද්ධති');

  // 19. Vowel diacritic 'ැ'/'ෑ' where 'ු'/'ූ' belongs:
  s = s.replace(/හුවමාරැ/g, 'හුවමාරු');
  s = s.replace(/තොරතුරැ/g, 'තොරතුරු');
  s = s.replace(/කළමනාකරැ/g, 'කළමනාකරු');
  s = s.replace(/තරඟකරැ/g, 'තරඟකරු');
  s = s.replace(/අයිතිකරැ/g, 'අයිතිකරු');
  s = s.replace(/පුරැදු/g, 'පුරුදු');
  s = s.replace(/නිරෑපණ/g, 'නිරූපණ');
  s = s.replace(/සුරක්ෂිත බව තහවුරැ/g, 'සුරක්ෂිත බව තහවුරු');
  s = s.replace(/වකර\s*නිෂ්පාදන/g, 'වක්‍ර නිෂ්පාදන');
  s = s.replace(/වකර/g, 'වක්‍ර');
  s = s.replace(/ගොඩනැගිලි ඉ ඉදිකිරීම්/g, 'ගොඩනැගිලි හා ඉදිකිරීම්');
  s = s.replace(/විශ්වාසා+ස|විශ්වා+ස/g, 'විශ්වාස');
  s = s.replace(/වෙළෙඳවපාවේ/g, 'වෙළෙඳපොළේ');
  s = s.replace(/සේවාවන්වේ/g, 'සේවාවන්ගේ');
  s = s.replace(/ඒවාවේ/g, 'ඒවායේ');
  s = s.replace(/වහෝ/g, 'හෝ');
  s = s.replace(/වතාරව/g, 'තොරව');
  s = s.replace(/නාශ්‍ක/g, 'නාශක');
  s = s.replace(/නාශ්‍/g, 'නාශ');
  s = s.replace(/වයදවුම/g, 'යෙදවුම');
  s = s.replace(/වවනත්/g, 'වෙනත්');
  s = s.replace(/විදයාත්මක/g, 'විද්‍යාත්මක');
  s = s.replace(/සැපයුම්කරැ/g, 'සැපයුම්කරු');
  s = s.replace(/කරැ/g, 'කරු');

  return s;
}

/**
 * Normalizes Sinhala Unicode text:
 * - Supports Noto Sans Sinhala (Regular & Bold), Arial, and FM-Abhaya
 * - Repairs font encoding anomalies and Kombuva-as-va distortions
 * - Unicode NFC normalization
 * - Repairs inverted kombuwa (ෙ) before consonants and consonant clusters (Rakaransaya, Yansaya, Bandi akuru)
 * - Repairs combined vowel signs: kombuwa + aela pilla + hal kirima (ෝ), kombuwa + aela pilla (ො), kombuwa + hal kirima (ේ), kombuwa + gayanukitta (ෞ)
 * - Cleans typographic quotes, special dashes, and zero-width spaces
 */
export function normalizeSinhalaText(str: string): string {
  if (!str) return '';

  // 1. Repair Sinhala font glyph & Kombuva artifacts first
  let normalized = repairSinhalaPdfFontArtifacts(str);

  // 2. Check if text was in legacy font and convert if needed
  normalized = convertFmToUnicode(normalized);

  // 3. Unicode NFC normalization
  normalized = normalized.normalize('NFC');

  // Replace typographic smart quotes and special dashes with standard characters
  normalized = normalized
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\u00A0/g, ' ')
    .replace(/[\u200B\uFEFF]/g, '');

  // 1. Inverted Kombuwa before consonant cluster with Rakaransaya / Yansaya / Bandi akuru:
  // e.g. ෙ + ප + ් + ZWJ + ර -> ප + ් + ZWJ + ර + ෙ
  normalized = normalized.replace(/(?<![\u0D9A-\u0DC6])([\u0DD9\u0DDB])([\u0D9A-\u0DC6]\u0DCA\u200D[\u0D9A-\u0DC6])/g, '$2$1');

  // 2. Inverted Kombuwa placed before single consonant (only when not attached to preceding consonant):
  // (a) Kombuwa before consonant + aela pilla + hal kirima -> consonant + ෝ (\u0DDD)
  normalized = normalized.replace(/(?<![\u0D9A-\u0DC6])\u0DD9([\u0D9A-\u0DC6])\u0DCF\u0DCA/g, '$1\u0DDD');
  // (b) Kombuwa before consonant + aela pilla -> consonant + ො (\u0DDC)
  normalized = normalized.replace(/(?<![\u0D9A-\u0DC6])\u0DD9([\u0D9A-\u0DC6])\u0DCF/g, '$1\u0DDC');
  // (c) Kombuwa before consonant + gayanukitta -> consonant + ෞ (\u0DDE)
  normalized = normalized.replace(/(?<![\u0D9A-\u0DC6])\u0DD9([\u0D9A-\u0DC6])\u0DF3/g, '$1\u0DDE');
  // (d) Kombuwa before consonant + hal kirima -> consonant + ේ (\u0DDA)
  normalized = normalized.replace(/(?<![\u0D9A-\u0DC6])\u0DD9([\u0D9A-\u0DC6])\u0DCA/g, '$1\u0DDA');
  // (e) Remaining inverted Kombuwa before consonant -> consonant + Kombuwa
  normalized = normalized.replace(/(?<![\u0D9A-\u0DC6])([\u0DD9\u0DDB])([\u0D9A-\u0DC6])/g, '$2$1');

  // 3. Decomposed vowel combinations after consonant:
  normalized = normalized.replace(/([\u0D9A-\u0DC6](?:\u0DCA\u200D[\u0D9A-\u0DC6])?)\u0DD9\u0DCF\u0DCA/g, '$1\u0DDD');
  normalized = normalized.replace(/([\u0D9A-\u0DC6](?:\u0DCA\u200D[\u0D9A-\u0DC6])?)\u0DD9\u0DCF/g, '$1\u0DDC');
  normalized = normalized.replace(/([\u0D9A-\u0DC6](?:\u0DCA\u200D[\u0D9A-\u0DC6])?)\u0DD9\u0DCA/g, '$1\u0DDA');
  normalized = normalized.replace(/([\u0D9A-\u0DC6](?:\u0DCA\u200D[\u0D9A-\u0DC6])?)\u0DD9\u0DF3/g, '$1\u0DDE');
  normalized = normalized.replace(/([\u0D9A-\u0DC6](?:\u0DCA\u200D[\u0D9A-\u0DC6])?)\u0DD9\u0DD9/g, '$1\u0DDB');

  // 4. Isolated decomposed combinations:
  normalized = normalized.replace(/\u0DDC\u0DCA/g, '\u0DDD');
  normalized = normalized.replace(/\u0DD9\u0DCF\u0DCA/g, '\u0DDD');
  normalized = normalized.replace(/\u0DD9\u0DDF/g, '\u0DDD');
  normalized = normalized.replace(/\u0DD9\u0DCF/g, '\u0DDC');
  normalized = normalized.replace(/\u0DD9\u0DCA/g, '\u0DDA');
  normalized = normalized.replace(/\u0DD9\u0DF3/g, '\u0DDE');
  normalized = normalized.replace(/\u0DD9\u0DD9/g, '\u0DDB');

  // 5. Remove space between consonant and dependent vowel / virama
  normalized = normalized.replace(/([\u0D9A-\u0DC6])\s+([\u0DCA\u0DCF-\u0DDF])/g, '$1$2');

  // Clean redundant spaces
  normalized = normalized.replace(/[ \t]+/g, ' ');

  return normalized;
}

/**
 * Universal Sri Lankan Question & Multi-Topic Parser
 * Supports:
 * - Sinhala Unicode fonts: Noto Sans Sinhala Regular, Noto Sans Sinhala Bold, Arial, Iskoola Pota
 * - Legacy fonts: FM-Abhaya, DL-Manel
 * - Questions: QUESTION 1:, Question 1., Q1:, ප්‍රශ්නය 1:, ප්‍රශ්නය 01:, ප්‍රශ්න අංක 1:, 1., 1), (1)
 * - Options: A:, A., A), (A), (1), 1., 1), 1:, (අ), අ., (a), a:
 * - Correct Answers: CORRECT: A/B/C/D, CORRECT: 1/2/3/4, නිවැරදි: A/B/C/D, නිවැරදි පිළිතුර: 1/2/3/4, Ans: B
 * - Multi-Topic separation: TOPIC:, මාතෘකාව:, පාඩම:, SECTION:, කොටස:
 */
export function parseQuizText(rawText: string): PdfParseResult {
  const text = normalizeSinhalaText(rawText || '');

  const parsedQuestions: ParsedQuestion[] = [];
  const validationErrors: string[] = [];

  // Extract Subject (Supports SUBJECT:, විෂය:, විෂයය:)
  const subjectMatch = text.match(/(?:^|\n)\s*(?:SUBJECT|විෂය|විෂයය)\s*[:.]\s*([^\r\n]+)/i);
  const subjectName = subjectMatch ? subjectMatch[1].trim() : 'විද්‍යාව';

  // Extract all Topic declarations and their positions across the document
  const topicRegex = /(?:^|\n)\s*(?:TOPIC|මාතෘකාව|පාඩම|SECTION|කොටස)\s*[:.]\s*([^\r\n]+)/gi;
  const topicDeclarations: { topicName: string; index: number }[] = [];
  let tMatch: RegExpExecArray | null;
  while ((tMatch = topicRegex.exec(text)) !== null) {
    topicDeclarations.push({
      topicName: tMatch[1].trim(),
      index: tMatch.index,
    });
  }

  const defaultTopicName = topicDeclarations.length > 0 ? topicDeclarations[0].topicName : 'සාමාන්‍ය';

  // Check if document uses explicit question prefixes like "QUESTION 1:", "ප්‍රශ්නය 1:", "Q1:"
  const hasExplicitHeaders = /(?:QUESTION|Q|ප්‍රශ්නය|ප්‍රශ්න\s*අංක)\s*\d+[\s.:)]+/i.test(text);

  let questionHeaderRegex: RegExp;
  if (hasExplicitHeaders) {
    // Only match explicit question indicators to avoid treating numbered options (1., 2., 3., 4.) as questions
    questionHeaderRegex = /(?:^|\n)\s*(?:QUESTION|Q|ප්‍රශ්නය|ප්‍රශ්න\s*අංක)\s*(\d+)[\s.:)]+/gi;
  } else {
    // Standalone numbered lines like "1.", "1)", "(1)" at the start of a line
    questionHeaderRegex = /(?:^|\n)\s*(?:(?:QUESTION|Q|ප්‍රශ්නය|ප්‍රශ්න\s*අංක)\s*(\d+)[\s.:)]+|(?:(\d+)[\s.]*[\)\.]\s+)|(?:\((\d+)\)\s+))/gi;
  }

  const questionIndices: { number: number; index: number; headerLength: number }[] = [];
  let qMatch: RegExpExecArray | null;

  while ((qMatch = questionHeaderRegex.exec(text)) !== null) {
    const qNum = parseInt(qMatch[1] || qMatch[2] || qMatch[3], 10);
    if (!isNaN(qNum) && qNum > 0 && qNum <= 500) {
      questionIndices.push({
        number: qNum,
        index: qMatch.index,
        headerLength: qMatch[0].length,
      });
    }
  }

  if (questionIndices.length === 0) {
    validationErrors.push('ව්‍යුහගත ප්‍රශ්න හමු නොවීය. (No structured question blocks found in text)');
    return {
      subjectName: subjectName || 'විද්‍යාව',
      defaultTopicName: defaultTopicName || 'සාමාන්‍ය',
      parsedQuestions: [],
      validationErrors,
    };
  }

  const questionNumbersSeen = new Set<number>();

  for (let i = 0; i < questionIndices.length; i++) {
    const current = questionIndices[i];
    const startIndex = current.index;
    const endIndex = i + 1 < questionIndices.length ? questionIndices[i + 1].index : text.length;
    const blockText = text.slice(startIndex, endIndex);

    const questionErrors: string[] = [];
    const qNum = current.number;

    if (questionNumbersSeen.has(qNum)) {
      questionErrors.push(`ප්‍රශ්න අංක ${qNum} දෙවරක් යෙදී ඇත (Duplicate question number ${qNum})`);
    }
    questionNumbersSeen.add(qNum);

    // Multi-Topic resolution for this question:
    let questionTopic = '';
    const inlineTopicMatch = blockText.match(/(?:^|\n)\s*(?:TOPIC|මාතෘකාව|පාඩම|SECTION|කොටස)\s*[:.]\s*([^\r\n]+)/i);
    if (inlineTopicMatch && inlineTopicMatch.index !== undefined) {
      const firstOptIndex = blockText.search(/(?:^|\n|\s+)(?:[A-D1-4අආඇඈa-d][\s.:)]+|\([A-D1-4අආඇඈa-d]\))/i);
      if (firstOptIndex === -1 || inlineTopicMatch.index < firstOptIndex) {
        questionTopic = inlineTopicMatch[1].trim();
      }
    }

    if (!questionTopic) {
      const precedingTopics = topicDeclarations.filter((t) => t.index <= startIndex);
      if (precedingTopics.length > 0) {
        questionTopic = precedingTopics[precedingTopics.length - 1].topicName;
      } else {
        questionTopic = defaultTopicName;
      }
    }

    // Extract Question text (between question header and first option)
    const bodyAfterHeader = blockText.slice(current.headerLength);

    // Determine option numbering style used in this question block:
    let optionType: 'letter' | 'number' | 'sinhala' = 'letter';
    const hasLetterOpts = /(?:^|\n|\s+)(?:A[:.)]|\(A\)|a[:.)]|\(a\))\s+/i.test(bodyAfterHeader) &&
                          /(?:^|\n|\s+)(?:B[:.)]|\(B\)|b[:.)]|\(b\))\s+/i.test(bodyAfterHeader);
    const hasSinhalaOpts = /(?:^|\n|\s+)(?:අ[:.)]|\(අ\))\s+/i.test(bodyAfterHeader) &&
                           /(?:^|\n|\s+)(?:ආ[:.)]|\(ආ\))\s+/i.test(bodyAfterHeader);
    const hasNumberOpts = /(?:^|\n|\s+)(?:1[:.)]|\(1\)|\(1\)\.)\s+/i.test(bodyAfterHeader) &&
                          /(?:^|\n|\s+)(?:2[:.)]|\(2\)|\(2\)\.)\s+/i.test(bodyAfterHeader);

    if (hasLetterOpts) {
      optionType = 'letter';
    } else if (hasNumberOpts) {
      optionType = 'number';
    } else if (hasSinhalaOpts) {
      optionType = 'sinhala';
    }

    const isExplicitShortAnswer =
      /(?:TYPE|වර්ගය)\s*[:.]\s*(?:SHORT_ANSWER|SHORT|කෙටි|කෙටි\s*පිළිතුරු)/i.test(bodyAfterHeader) ||
      /(?:SHORT\s*ANSWER|කෙටි\s*පිළිතුරු)/i.test(bodyAfterHeader);
    const hasOptions = !isExplicitShortAnswer && (hasLetterOpts || hasNumberOpts || hasSinhalaOpts);

    if (!hasOptions) {
      const questionType = 'SHORT_ANSWER';
      const options: ParsedOption[] = [];

      const shortCorrectMatch = blockText.match(
        /(?:CORRECT(?:\s*ANSWER)?|නිවැරදි\s*පිළිතුර|නිවැරදි|පිළිතුර|Ans|Answer)\s*[:.]\s*([^\r\n]+)/i
      );
      let correctAnswer = shortCorrectMatch ? shortCorrectMatch[1].trim() : '';
      if (!correctAnswer) {
        questionErrors.push(`කෙටි පිළිතුර (CORRECT ANSWER) දක්වා නොමැත`);
      }

      const acceptableMatch = blockText.match(
        /(?:ACCEPTABLE(?:\s*ANSWERS)?|විකල්ප\s*පිළිතුරු|විකල්ප|සමාන\s*පද|SYNONYMS?)\s*[:.]\s*([^\r\n]+)/i
      );
      let acceptableAnswers: string[] = [];
      if (acceptableMatch) {
        acceptableAnswers = acceptableMatch[1]
          .split(/[,;/|]+/)
          .map((s) => s.trim())
          .filter(Boolean);
      }

      const explanationMatch = blockText.match(
        /(?:EXPLANATION|විස්තරය|පැහැදිලි\s*කිරීම|පැහැදිලිකිරීම)\s*[:.]\s*([\s\S]*?)(?=(?:^|\n)\s*(?:TOPIC|මාතෘකාව|QUESTION|Q|ප්‍රශ්නය|\d+[\s.:)])\s*|$)/i
      );
      const explanation = explanationMatch ? explanationMatch[1].trim() : '';

      let questionText = bodyAfterHeader
        .replace(/(?:^|\n)\s*(?:TOPIC|මාතෘකාව|පාඩම|SECTION|කොටස)\s*[:.][^\r\n]+/gi, '')
        .replace(/(?:^|\n)\s*(?:TYPE|වර්ගය)\s*[:.][^\r\n]+/gi, '')
        .replace(/(?:^|\n)\s*(?:ACCEPTABLE(?:\s*ANSWERS)?|විකල්ප\s*පිළිතුරු|විකල්ප|සමාන\s*පද|SYNONYMS?)\s*[:.][^\r\n]+/gi, '')
        .replace(/(?:^|\n)\s*(?:EXPLANATION|විස්තරය|පැහැදිලි\s*කිරීම|පැහැදිලිකිරීම)\s*[:.][\s\S]*$/gi, '')
        .replace(/(?:^|\n)\s*(?:CORRECT(?:\s*ANSWER)?|නිවැරදි\s*පිළිතුර|නිවැරදි|පිළිතුර|Ans|Answer)\s*[:.][\s\S]*$/gi, '')
        .trim();

      if (!questionText) {
        questionErrors.push(`Question ${qNum} is missing question text`);
      }

      parsedQuestions.push({
        questionNumber: qNum,
        topicName: questionTopic || 'General',
        questionType,
        questionText,
        options,
        correctAnswer,
        acceptableAnswers,
        marks: 1,
        explanation,
        errors: questionErrors,
      });
      continue;
    }

    let firstOptIndex = -1;
    if (optionType === 'letter') {
      firstOptIndex = bodyAfterHeader.search(/(?:^|\n|\s+)(?:[A-Ea-e][:.)]|\([A-Ea-e]\))\s*/);
    } else if (optionType === 'number') {
      firstOptIndex = bodyAfterHeader.search(/(?:^|\n|\s+)(?:[1-5][:.)]|\([1-5]\)|\([1-5]\)\.)\s*/);
    } else if (optionType === 'sinhala') {
      firstOptIndex = bodyAfterHeader.search(/(?:^|\n|\s+)(?:[අආඇඈඉඊ][:.)]|\([අආඇඈඉඊ]\))\s*/);
    }

    let rawQuestionText = firstOptIndex !== -1 ? bodyAfterHeader.slice(0, firstOptIndex) : bodyAfterHeader;

    // Clean inline topic and clean question text
    let questionText = rawQuestionText
      .replace(/(?:^|\n)\s*(?:TOPIC|මාතෘකාව|පාඩම|SECTION|කොටස)\s*[:.][^\r\n]+/gi, '')
      .trim();

    if (!questionText) {
      questionErrors.push(`Question ${qNum} is missing question text`);
    }

    // Extract options from the options slice ONLY (prevents question number 2: from being matched as option 2)
    const optionsBody = firstOptIndex !== -1 ? bodyAfterHeader.slice(firstOptIndex) : '';
    const options: ParsedOption[] = [];
    let optionKeys: { key: string; patterns: string[] }[] = [];

    // Check if this question block has an Option E (or 5 or ඉ)
    const hasFifthOption =
      /(?:^|\n|\s+)(?:E[:.)]|\(E\)|\(e\)|e[:.)]|5[:.)]|\(5\)|\(5\)\.|\(ඉ\)|\(ඊ\)|ඉ[:.)])\s+/i.test(bodyAfterHeader);

    if (optionType === 'letter') {
      optionKeys = [
        { key: 'A', patterns: ['A', 'a'] },
        { key: 'B', patterns: ['B', 'b'] },
        { key: 'C', patterns: ['C', 'c'] },
        { key: 'D', patterns: ['D', 'd'] },
      ];
      if (hasFifthOption) {
        optionKeys.push({ key: 'E', patterns: ['E', 'e'] });
      }
    } else if (optionType === 'number') {
      optionKeys = [
        { key: 'A', patterns: ['1'] },
        { key: 'B', patterns: ['2'] },
        { key: 'C', patterns: ['3'] },
        { key: 'D', patterns: ['4'] },
      ];
      if (hasFifthOption) {
        optionKeys.push({ key: 'E', patterns: ['5'] });
      }
    } else {
      optionKeys = [
        { key: 'A', patterns: ['අ'] },
        { key: 'B', patterns: ['ආ'] },
        { key: 'C', patterns: ['ඇ'] },
        { key: 'D', patterns: ['ඈ'] },
      ];
      if (hasFifthOption) {
        optionKeys.push({ key: 'E', patterns: ['ඉ', 'ඊ'] });
      }
    }

    const correctDelimiter = '(?:CORRECT(?:\\s*ANSWER)?|නිවැරදි(?:\\s*(?:පිළිතුර|අංකය))?|පිළිතුර|Ans|Answer)\\s*[:.]';

    for (let k = 0; k < optionKeys.length; k++) {
      const cur = optionKeys[k];
      const next = optionKeys[k + 1];

      const curPrefix = cur.patterns.map((p) => `(?:${p}[:.)]|\\(${p}\\)|\\(${p}\\)\\.)`).join('|');
      let lookahead = '';
      if (next) {
        const nextPrefix = next.patterns.map((p) => `(?:${p}[:.)]|\\(${p}\\)|\\(${p}\\)\\.)`).join('|');
        lookahead = `(?=(?:^|\\n|\\s+)(?:${nextPrefix})|(?:^|\\n|\\s+)${correctDelimiter}|$)`;
      } else {
        lookahead = `(?=(?:^|\\n|\\s+)${correctDelimiter}|$)`;
      }

      const optRegex = new RegExp(`(?:^|\\n|\\s+)(?:${curPrefix})\\s*([\\s\\S]*?)${lookahead}`, 'i');
      const optMatch = optionsBody.match(optRegex);
      let optText = optMatch ? optMatch[1].trim() : '';

      // Clean trailing correct answer tags if any got captured
      optText = optText.replace(/(?:CORRECT|නිවැරදි|පිළිතුර|Ans|Answer)\s*[:.][\s\S]*$/i, '').trim();

      if (!optText) {
        questionErrors.push(`Option ${cur.key} is missing or empty`);
      }

      options.push({
        key: cur.key,
        text: optText,
      });
    }

    // Extract Correct Answer (Supports: CORRECT: A/B/C/D/E or 1/2/3/4/5 or (අ)-(ඉ) or නිවැරදි: ...)
    const correctMatch = blockText.match(
      /(?:CORRECT(?:\s*ANSWER)?|නිවැරදි\s*පිළිතුර|නිවැරදි\s*අංකය|නිවැරදි|පිළිතුර|Ans|Answer)\s*[:.\s]+\(?([A-Ea-e1-5අආඇඈඉඊ])\)?/i
    );

    let rawCorrect = correctMatch ? correctMatch[1].toUpperCase() : '';
    let correctAnswer = '';

    // Map 1-5 and Sinhala letters to A-E
    if (['A', '1', 'අ'].includes(rawCorrect)) correctAnswer = 'A';
    else if (['B', '2', 'ආ'].includes(rawCorrect)) correctAnswer = 'B';
    else if (['C', '3', 'ඇ'].includes(rawCorrect)) correctAnswer = 'C';
    else if (['D', '4', 'ඈ'].includes(rawCorrect)) correctAnswer = 'D';
    else if (['E', '5', 'ඉ', 'ඊ'].includes(rawCorrect)) correctAnswer = 'E';

    if (!correctAnswer) {
      correctAnswer = 'A';
      questionErrors.push(`Correct answer (CORRECT) not specified - defaulted to 'A'`);
    }

    // Extract optional Explanation
    const explanationMatch = blockText.match(
      /(?:EXPLANATION|විස්තරය|පැහැදිලි\s*කිරීම|පැහැදිලිකිරීම)\s*[:.]\s*([\s\S]*?)(?=(?:^|\n)\s*(?:TOPIC|මාතෘකාව|QUESTION|Q|ප්‍රශ්නය|\d+[\s.:)])\s*|$)/i
    );
    const explanation = explanationMatch ? explanationMatch[1].trim() : '';

    parsedQuestions.push({
      questionNumber: qNum,
      topicName: questionTopic || 'General',
      questionType: 'MCQ',
      questionText,
      options,
      correctAnswer,
      acceptableAnswers: [],
      marks: 1,
      explanation,
      errors: questionErrors,
    });
  }

  // Summary validation errors
  const invalidCount = parsedQuestions.filter((q) => q.errors.length > 0).length;
  if (invalidCount > 0) {
    validationErrors.push(`Found ${invalidCount} questions with warnings`);
  }

  // Ensure all selection (MCQ) questions are continuous first, followed strictly by all Short Answer questions
  const mcqs = parsedQuestions.filter((q) => q.questionType !== 'SHORT_ANSWER');
  const shortAnswers = parsedQuestions.filter((q) => q.questionType === 'SHORT_ANSWER');
  const orderedParsedQuestions = [...mcqs, ...shortAnswers].map((q, idx) => ({
    ...q,
    questionNumber: idx + 1,
  }));

  return {
    subjectName: subjectName || 'General',
    defaultTopicName: defaultTopicName || 'General',
    parsedQuestions: orderedParsedQuestions,
    validationErrors,
  };
}

export async function parseQuizPdf(pdfBuffer: Buffer): Promise<PdfParseResult> {
  // 1. Primary AI Extractor: Use Gemini Multimodal AI for high-accuracy Sinhala font and question extraction
  try {
    const geminiResult = await extractQuizPdfWithGemini(pdfBuffer);
    if (geminiResult && geminiResult.parsedQuestions && geminiResult.parsedQuestions.length > 0) {
      console.log(`[parseQuizPdf] Successfully parsed PDF using Gemini AI (${geminiResult.parsedQuestions.length} questions).`);
      return geminiResult;
    }
  } catch (geminiError: any) {
    console.warn('[parseQuizPdf] Gemini AI extraction encountered an error, falling back to local extractor:', geminiError?.message);
  }

  // 2. Fallback Extractor: Layout-aware PDF page render to preserve exact words, spacing, and numbers
  const uint8Data = new Uint8Array(pdfBuffer.buffer, pdfBuffer.byteOffset, pdfBuffer.length);

  // Layout-aware PDF page render to preserve exact words, spacing, and numbers
  const options = {
    pagerender: (pageData: any) => {
      return pageData
        .getTextContent({ normalizeWhitespace: false, disableCombineTextItems: false })
        .then((textContent: any) => {
          let lastY: number | null = null;
          let lastX: number | null = null;
          let lastWidth: number | null = null;
          let text = '';

          // Sort text items by Y (top to bottom) and X (left to right)
          const items = [...textContent.items].sort((a: any, b: any) => {
            const yDiff = b.transform[5] - a.transform[5];
            if (Math.abs(yDiff) > 3) return yDiff;
            return a.transform[4] - b.transform[4];
          });

          for (const item of items) {
            const currentY = item.transform[5];
            const currentX = item.transform[4];
            const currentWidth = item.width || 0;

            if (lastY === null) {
              text += item.str;
            } else if (Math.abs(currentY - lastY) > 3) {
              // New line
              text += '\n' + item.str;
            } else {
              // Same line: insert space if gap between items
              const prevEnd = (lastX ?? 0) + (lastWidth ?? 0);
              if (currentX - prevEnd > 2 && !text.endsWith(' ') && !item.str.startsWith(' ')) {
                text += ' ' + item.str;
              } else {
                text += item.str;
              }
            }
            lastY = currentY;
            lastX = currentX;
            lastWidth = currentWidth;
          }
          return text;
        });
    },
  };

  const data = await pdfParse(uint8Data as any, options);
  return parseQuizText(data.text || '');
}


