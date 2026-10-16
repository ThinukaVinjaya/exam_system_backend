import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

export interface IShortAnswerEvalItem {
  questionId: string;
  questionText: string;
  expectedAnswer: string;
  acceptableAnswers?: string[];
  studentAnswer: string;
  marks: number;
}

export interface IShortAnswerEvalResult {
  isCorrect: boolean;
  marksAwarded: number;
  feedback: string;
}

const CANDIDATE_GEMINI_MODELS = [
  'gemini-2.5-flash',
  'gemini-2.0-flash',
  'gemini-1.5-flash',
  'gemini-flash-latest',
];

/**
 * Normalizes a text string for quick comparison:
 * lowercase, removes accents/excess whitespace, removes standard punctuation, and strips zero-width chars.
 */
function normalizeText(str: string): string {
  if (!str) return '';
  return str
    .toLowerCase()
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?"'’]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Computes Levenshtein distance between two strings.
 */
function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  return matrix[b.length][a.length];
}

/**
 * Computes a normalized similarity score between 0.0 and 1.0.
 */
function calculateSimilarity(str1: string, str2: string): number {
  if (!str1 || !str2) return 0;
  if (str1 === str2) return 1;
  const maxLen = Math.max(str1.length, str2.length);
  if (maxLen === 0) return 1;
  const dist = levenshteinDistance(str1, str2);
  return 1 - dist / maxLen;
}

/**
 * Deterministic local match check before calling Gemini.
 * Checks exact match, substring inclusion, fuzzy distance, or acceptable answers list.
 */
function checkLocalMatch(
  studentAnswer: string,
  expectedAnswer: string,
  acceptableAnswers: string[] = []
): { matched: boolean; isCorrect: boolean; isSimilar?: boolean } {
  const normStudent = normalizeText(studentAnswer);
  if (!normStudent) {
    return { matched: true, isCorrect: false };
  }

  const allExpected = [expectedAnswer, ...acceptableAnswers]
    .filter(Boolean)
    .map(normalizeText);

  // 1. Exact match with any expected answer
  for (const exp of allExpected) {
    if (exp && (normStudent === exp || exp.split(' / ').includes(normStudent))) {
      return { matched: true, isCorrect: true };
    }
  }

  // 2. High string similarity (automatic similar answer detection for typos / minor inflections)
  for (const exp of allExpected) {
    if (!exp) continue;
    if (exp.length >= 4 && normStudent.length >= 4) {
      const sim = calculateSimilarity(normStudent, exp);
      const dist = levenshteinDistance(normStudent, exp);
      if (sim >= 0.85 || dist <= 1) {
        return { matched: true, isCorrect: true, isSimilar: true };
      }
    }

    // 3. Token containment (e.g. "carbon dioxide gas" vs "carbon dioxide" or "හරිතලව පටකය" vs "හරිතලව")
    if (exp.length >= 5 && normStudent.length >= 5) {
      if (normStudent.includes(exp) || exp.includes(normStudent)) {
        return { matched: true, isCorrect: true, isSimilar: true };
      }
    }
  }

  return { matched: false, isCorrect: false };
}

/**
 * Evaluates a batch of short answers using Gemini Multilingual AI with Sinhala, English,
 * and Singlish (phonetic Sinhala in Latin letters) comprehension.
 */
export async function evaluateShortAnswersBatch(
  items: IShortAnswerEvalItem[]
): Promise<Map<string, IShortAnswerEvalResult>> {
  const results = new Map<string, IShortAnswerEvalResult>();
  if (!items || items.length === 0) return results;

  const toEvaluateViaAi: IShortAnswerEvalItem[] = [];

  // 1. Run quick local check
  for (const item of items) {
    const studentText = (item.studentAnswer || '').trim();
    if (!studentText) {
      results.set(item.questionId, {
        isCorrect: false,
        marksAwarded: 0,
        feedback: 'Unanswered',
      });
      continue;
    }

    const local = checkLocalMatch(studentText, item.expectedAnswer, item.acceptableAnswers);
    if (local.matched) {
      results.set(item.questionId, {
        isCorrect: local.isCorrect,
        marksAwarded: local.isCorrect ? item.marks : 0,
        feedback: local.isCorrect
          ? local.isSimilar
            ? 'Correct (Automatically detected equivalent answer)'
            : 'Correct (Direct Match)'
          : 'Incorrect',
      });
    } else {
      toEvaluateViaAi.push(item);
    }
  }

  if (toEvaluateViaAi.length === 0) {
    return results;
  }

  // 2. Call Gemini AI for semantic multilingual evaluation
  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey) {
    // If no API key configured, fallback to fuzzy similarity & token comparison
    for (const item of toEvaluateViaAi) {
      const studentNorm = normalizeText(item.studentAnswer);
      const allExp = [item.expectedAnswer, ...(item.acceptableAnswers || [])].map(normalizeText).filter(Boolean);
      let isClose = false;
      for (const exp of allExp) {
        if (exp.length >= 3 && studentNorm.length >= 3) {
          const sim = calculateSimilarity(studentNorm, exp);
          const dist = levenshteinDistance(studentNorm, exp);
          if (sim >= 0.75 || dist <= 2 || studentNorm.includes(exp) || exp.includes(studentNorm)) {
            isClose = true;
            break;
          }
        }
      }
      results.set(item.questionId, {
        isCorrect: isClose,
        marksAwarded: isClose ? item.marks : 0,
        feedback: isClose
          ? 'Correct (Equivalent answer)'
          : 'Incorrect',
      });
    }
    return results;
  }

  const promptItems = toEvaluateViaAi.map((item, idx) => ({
    id: item.questionId,
    itemNumber: idx + 1,
    questionText: item.questionText,
    expectedAnswer: item.expectedAnswer,
    acceptableAlternatives: item.acceptableAnswers || [],
    studentAnswer: item.studentAnswer,
    maxMarks: item.marks,
  }));

  const systemInstruction = `You are an expert bilingual Examination Evaluator for Sri Lankan National Curricula (G.C.E. O/L and A/L).
Your job is to mark student short answers for scientific, mathematical, and general curriculum questions.

CRITICAL SIMILARITY DETECTION MANDATE:
The admin provides the primary model answer (and optional synonyms). As the AI evaluator, you MUST AUTOMATICALLY DETECT SIMILAR ANSWERS in the student's submission:
1. Typographical & Spelling Errors: Minor typos or misspellings in English (e.g., "Mitochondria" vs "Mitocondria" or "Mitocondrion"), Sinhala (e.g., "ප්‍රභාසංස්ලේෂණය" vs "ප්‍රභාසංශ්ලේෂණය"), or transliterated Singlish (e.g., "prahasansleshanaya" vs "prabhasansleshanaya") MUST BE MARKED AS CORRECT (100% marks).
2. Grammatical Inflections & Suffixes: Sinhala Vibhakthi / noun inflections (e.g., "ප්‍රභාසංශ්ලේෂණය", "ප්‍රභාසංශ්ලේෂණයට", "ප්‍රභාසංශ්ලේෂණයේදී", "ක්ලෝරොෆිල් මගින්", "හිමොග්ලොබින් වේ") express the exact concept. Mark as CORRECT!
3. Synonyms & Semantic Equivalents: Even if the admin did NOT provide synonyms, if the student wrote a valid synonym, scientific term, definition, or translation (e.g. Sinhala "හරිතප්‍රද" for "Chlorophyll", "මයිටොකොන්ඩ්‍රියා" for "Mitochondria", "CO2" for "කාබන් ඩයොක්සයිඩ්"), Mark as CORRECT!
4. Phrasing Variations: If student adds context words (e.g. "කාබන් ඩයොක්සයිඩ් වායුව" when answer is "කාබන් ඩයොක්සයිඩ්", or "It is Oxygen" when answer is "Oxygen"), Mark as CORRECT!
5. Multi-Language Transliteration: Accept answers written in Sinhala Unicode, English, or Singlish (phonetic Sinhala in Latin letters).
6. If the student answer is completely incorrect or contradicts the expected answer, mark isCorrect: false, scoreRatio: 0.0.

Output a valid JSON array of evaluation objects adhering strictly to this schema:
[
  {
    "id": "questionId",
    "isCorrect": true,
    "scoreRatio": 1.0,
    "feedback": "Concise remark in Sinhala/English clarifying similarity match"
  }
]`;

  let aiSuccess = false;

  for (const modelName of CANDIDATE_GEMINI_MODELS) {
    if (aiSuccess) break;
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;
      const payload = {
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: `${systemInstruction}\n\nHere are the questions and student answers to evaluate:\n${JSON.stringify(promptItems, null, 2)}`,
              },
            ],
          },
        ],
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: 0.1,
        },
      };

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        continue;
      }

      const data = (await response.json()) as any;
      const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!rawText) continue;

      let cleanedText = rawText.trim();
      if (cleanedText.startsWith('```json')) {
        cleanedText = cleanedText.replace(/^```json\s*/, '').replace(/\s*```$/, '');
      } else if (cleanedText.startsWith('```')) {
        cleanedText = cleanedText.replace(/^```\s*/, '').replace(/\s*```$/, '');
      }

      const parsedArray = JSON.parse(cleanedText);
      if (Array.isArray(parsedArray)) {
        for (const evalItem of parsedArray) {
          const original = toEvaluateViaAi.find((x) => x.questionId === evalItem.id);
          if (!original) continue;

          const isCorr = Boolean(evalItem.isCorrect || evalItem.scoreRatio >= 0.5);
          const ratio = typeof evalItem.scoreRatio === 'number' ? Math.max(0, Math.min(1, evalItem.scoreRatio)) : isCorr ? 1 : 0;
          const marksAwarded = Math.round(original.marks * ratio * 10) / 10;

          results.set(original.questionId, {
            isCorrect: isCorr,
            marksAwarded: isCorr ? (marksAwarded > 0 ? marksAwarded : original.marks) : 0,
            feedback: evalItem.feedback || (isCorr ? 'Correct' : 'Incorrect'),
          });
        }
        aiSuccess = true;
      }
    } catch (err: any) {
      logger.warn(`Gemini short answer evaluation failed with model ${modelName}:`, err?.message || err);
    }
  }

  // 3. Fallback for any remaining un-evaluated items using fuzzy similarity
  for (const item of toEvaluateViaAi) {
    if (!results.has(item.questionId)) {
      const studentNorm = normalizeText(item.studentAnswer);
      const allExp = [item.expectedAnswer, ...(item.acceptableAnswers || [])].map(normalizeText).filter(Boolean);
      let isClose = false;
      for (const exp of allExp) {
        if (exp.length >= 3 && studentNorm.length >= 3) {
          const sim = calculateSimilarity(studentNorm, exp);
          const dist = levenshteinDistance(studentNorm, exp);
          if (sim >= 0.75 || dist <= 2 || studentNorm.includes(exp) || exp.includes(studentNorm)) {
            isClose = true;
            break;
          }
        }
      }
      results.set(item.questionId, {
        isCorrect: isClose,
        marksAwarded: isClose ? item.marks : 0,
        feedback: isClose
          ? 'Correct (Equivalent answer)'
          : 'Incorrect',
      });
    }
  }

  return results;
}
