import { env } from '../config/env.js';
import { PdfParseResult, ParsedQuestion, ParsedOption } from './pdfParser.js';

const CANDIDATE_MODELS = [
  'models/gemini-3.8-flash',
  'models/gemini-3.5-flash-lite',
  'models/gemini-3.1-pro-preview',
  'models/gemini-flash-latest',
  'models/gemini-3-flash-preview',
];

const EXTRACTION_PROMPT = `You are an expert OCR and Examination Paper parser specialized in Sri Lankan National Curriculum exam papers (G.C.E. O/L and A/L, scholarship exams, and school term tests).

CRUCIAL INSTRUCTION FOR SINHALA FONTS:
Many Sri Lankan exam papers use non-Unicode legacy Sinhala fonts (such as FM-Abhaya, FM-Malithi, DL-Manel, Kaputa, etc.) or distorted/subsetted Sinhala fonts where normal text extractors extract gibberish (e.g., 'm%Yak', 'úoHdj', 'f;dr;=re', question marks, or broken letters).
Your job is to visually read the Sinhala characters on the page, accurately decode all vowels, signs, and ligatures:
- Kombuwa (ෙ) correctly attached before the consonant
- Deergha kombuwa (ේ), kombuwa ha aepilla (ෛ), kombuwa ha gayanukitta (ෞ)
- Aepilla (ැ, ෑ)
- Ispilla (ි, ී)
- Paapilla (ු, ූ, ෘ, ෲ)
- Al-lakuna (්)
- Bandi akuru and complex ligatures (ක්‍ෂ, ඥ, ඤ, ඳ, ඬ, ඟ, ඹ, ත්‍ව, ද්‍ර, ශ්‍ර, ප්‍ර, etc.)
- Output clean, grammatically correct, modern standard Unicode Sinhala text (ශ්‍රී ලංකා සම්මත යුනිකෝඩ් සිංහල).
- If the paper is in English or Tamil, output clear English/Tamil Unicode text.
- Preserve any mathematical or scientific expressions, keeping equations or formulas in LaTeX notation (e.g., $E = mc^2$, $H_2O$, $\\frac{a}{b}$).

Extract EVERY question in the document (supports both Multiple Choice Questions and Short Answer questions / කෙටි පිළිතුරු ප්‍රශ්න):
- questionNumber: sequential number (1, 2, 3...)
- questionType: "MCQ" for multiple choice questions, or "SHORT_ANSWER" for questions requiring a short written answer (single word, phrase, value, or definition)
- topicName: specific curriculum topic or subject sub-unit if specified or inferable from question content (e.g., ජීව විද්‍යාව, රසායන විද්‍යාව, භෞතික විද්‍යාව, සාමාන්‍ය දැනීම, etc.)
- questionText: complete question stem in clear Unicode Sinhala
- options: array of options for MCQ (empty [] for SHORT_ANSWER questions). Each option must have 'key' ('A', 'B', 'C', 'D', and 'E' if 5 options exist) and 'text' (the option's content in Sinhala Unicode). If original paper has options numbered 1, 2, 3, 4, 5 or (1), (2), (3), (4), (5) or (අ), (ආ), (ඇ), (ඈ), map them sequentially to keys A, B, C, D, E.
- correctAnswer: For MCQ, extract the correct letter key ('A', 'B', 'C', 'D', 'E'). For SHORT_ANSWER, provide the concise, standard model answer (in Sinhala Unicode, English, or standard scientific term).
- acceptableAnswers: For SHORT_ANSWER, array of acceptable synonyms and transliterations (e.g., Sinhala Unicode, English name, and Singlish phonetic forms such as ["ප්‍රභාසංස්ලේෂණය", "photosynthesis", "prahasansleshana"]). For MCQ, an empty array [].
- marks: 1 (or as indicated in the paper)
- explanation: a clear, concise Sinhala explanation describing why the selected answer is correct.

Respond with a single valid JSON object following this schema:
{
  "subjectName": "Subject name in Sinhala (e.g. විද්‍යාව, ගණිතය, ඉතිහාසය, etc.)",
  "defaultTopicName": "Main topic or unit name in Sinhala",
  "parsedQuestions": [
    {
      "questionNumber": 1,
      "questionType": "MCQ",
      "topicName": "Sub-topic",
      "questionText": "ප්‍රශ්නය...",
      "options": [
        { "key": "A", "text": "පිළිතුර A..." },
        { "key": "B", "text": "පිළිතුර B..." },
        { "key": "C", "text": "පිළිතුර C..." },
        { "key": "D", "text": "පිළිතුර D..." }
      ],
      "correctAnswer": "A",
      "acceptableAnswers": [],
      "marks": 1,
      "explanation": "පැහැදිලි කිරීම...",
      "errors": []
    }
  ],
  "validationErrors": []
}`;

function cleanJsonResponse(rawText: string): string {
  let cleaned = rawText.trim();
  if (cleaned.startsWith('```json')) {
    cleaned = cleaned.replace(/^```json\s*/, '').replace(/\s*```$/, '');
  } else if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```\s*/, '').replace(/\s*```$/, '');
  }
  return cleaned.trim();
}

function sanitizeParsedResult(rawObj: any): PdfParseResult {
  const subjectName = typeof rawObj.subjectName === 'string' && rawObj.subjectName.trim()
    ? rawObj.subjectName.trim()
    : 'General';

  const defaultTopicName = typeof rawObj.defaultTopicName === 'string' && rawObj.defaultTopicName.trim()
    ? rawObj.defaultTopicName.trim()
    : 'General';

  const validationErrors: string[] = Array.isArray(rawObj.validationErrors)
    ? rawObj.validationErrors.filter((e: any) => typeof e === 'string')
    : [];

  const parsedQuestions: ParsedQuestion[] = [];
  const rawQuestions = Array.isArray(rawObj.parsedQuestions) ? rawObj.parsedQuestions : [];

  for (let i = 0; i < rawQuestions.length; i++) {
    const q = rawQuestions[i];
    if (!q || typeof q !== 'object') continue;

    const qNum = typeof q.questionNumber === 'number' ? q.questionNumber : i + 1;
    const questionText = typeof q.questionText === 'string' ? q.questionText.trim() : '';
    if (!questionText) continue;

    const topicName = typeof q.topicName === 'string' && q.topicName.trim()
      ? q.topicName.trim()
      : defaultTopicName;

    const rawOptions = Array.isArray(q.options) ? q.options : [];
    const isShortAnswer =
      q.questionType === 'SHORT_ANSWER' ||
      (rawOptions.length === 0 && typeof q.correctAnswer === 'string' && q.correctAnswer.length > 0);
    const questionType: 'MCQ' | 'SHORT_ANSWER' = isShortAnswer ? 'SHORT_ANSWER' : 'MCQ';

    const options: ParsedOption[] = [];
    let correctAnswer = '';
    let acceptableAnswers: string[] = [];

    if (questionType === 'SHORT_ANSWER') {
      correctAnswer = typeof q.correctAnswer === 'string' ? q.correctAnswer.trim() : '';
      acceptableAnswers = Array.isArray(q.acceptableAnswers)
        ? q.acceptableAnswers.map((a: any) => String(a).trim()).filter(Boolean)
        : [];
    } else {
      const defaultKeys = ['A', 'B', 'C', 'D', 'E'];
      for (let optIdx = 0; optIdx < Math.min(rawOptions.length, 5); optIdx++) {
        const opt = rawOptions[optIdx];
        const key = (opt && typeof opt.key === 'string' && opt.key.trim().toUpperCase())
          ? opt.key.trim().toUpperCase()
          : defaultKeys[optIdx];
        const text = (opt && typeof opt.text === 'string') ? opt.text.trim() : '';

        options.push({ key, text });
      }

      correctAnswer = typeof q.correctAnswer === 'string' ? q.correctAnswer.trim().toUpperCase() : 'A';
      if (!['A', 'B', 'C', 'D', 'E'].includes(correctAnswer)) {
        if (['1', 'අ'].includes(correctAnswer)) correctAnswer = 'A';
        else if (['2', 'ආ'].includes(correctAnswer)) correctAnswer = 'B';
        else if (['3', 'ඇ'].includes(correctAnswer)) correctAnswer = 'C';
        else if (['4', 'ඈ'].includes(correctAnswer)) correctAnswer = 'D';
        else if (['5', 'ඉ', 'ඊ'].includes(correctAnswer)) correctAnswer = 'E';
        else correctAnswer = 'A';
      }
    }

    const marks = typeof q.marks === 'number' && q.marks > 0 ? q.marks : 1;
    const explanation = typeof q.explanation === 'string' ? q.explanation.trim() : '';
    const imageUrl = typeof q.imageUrl === 'string' ? q.imageUrl.trim() : '';
    const imageCaption = typeof q.imageCaption === 'string' ? q.imageCaption.trim() : '';
    const errors: string[] = Array.isArray(q.errors) ? q.errors.filter((e: any) => typeof e === 'string') : [];

    parsedQuestions.push({
      questionNumber: qNum,
      topicName,
      questionType,
      questionText,
      imageUrl: imageUrl || undefined,
      imageCaption: imageCaption || undefined,
      options,
      correctAnswer,
      acceptableAnswers,
      marks,
      explanation,
      errors,
    });
  }

  // Ensure all selection (MCQ) questions are continuous first, followed strictly by all Short Answer questions
  const mcqs = parsedQuestions.filter((q) => q.questionType !== 'SHORT_ANSWER');
  const shortAnswers = parsedQuestions.filter((q) => q.questionType === 'SHORT_ANSWER');
  const orderedQuestions = [...mcqs, ...shortAnswers].map((q, idx) => ({
    ...q,
    questionNumber: idx + 1,
  }));

  return {
    subjectName,
    defaultTopicName,
    parsedQuestions: orderedQuestions,
    validationErrors,
  };
}

/**
 * Extracts multiple choice questions from a PDF buffer using Gemini Multimodal AI.
 * Iterates through candidate Gemini models if any model is busy or rate-limited.
 */
export async function extractQuizPdfWithGemini(pdfBuffer: Buffer): Promise<PdfParseResult | null> {
  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey) {
    console.warn('[GeminiExtractor] No GEMINI_API_KEY configured. Skipping Gemini extraction.');
    return null;
  }

  // Google Gemini API inlineData payload limit is 20MB
  if (pdfBuffer.length > 20 * 1024 * 1024) {
    console.warn(`[GeminiExtractor] PDF buffer (${(pdfBuffer.length / (1024 * 1024)).toFixed(2)} MB) exceeds 20MB Gemini payload limit.`);
    return null;
  }

  const base64Pdf = pdfBuffer.toString('base64');

  const requestBody = {
    contents: [
      {
        parts: [
          {
            inlineData: {
              mimeType: 'application/pdf',
              data: base64Pdf,
            },
          },
          { text: EXTRACTION_PROMPT },
        ],
      },
    ],
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0.1,
    },
  };

  for (const model of CANDIDATE_MODELS) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/${model}:generateContent?key=${apiKey}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.warn(`[GeminiExtractor] Model ${model} returned status ${response.status}: ${errorText.slice(0, 200)}`);
        // If 503 or 404, try next candidate model
        continue;
      }

      const responseJson: any = await response.json();
      const rawText = responseJson.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!rawText) {
        console.warn(`[GeminiExtractor] Model ${model} returned empty content.`);
        continue;
      }

      const cleaned = cleanJsonResponse(rawText);
      const parsed = JSON.parse(cleaned);
      const result = sanitizeParsedResult(parsed);

      if (result.parsedQuestions.length > 0) {
        console.log(`[GeminiExtractor] Successfully extracted ${result.parsedQuestions.length} Sinhala questions using ${model}.`);
        return result;
      }
    } catch (err: any) {
      console.warn(`[GeminiExtractor] Error calling model ${model}:`, err.message);
    }
  }

  return null;
}

/**
 * Extracts multiple choice questions from pasted raw text (including legacy Sinhala fonts) using Gemini AI.
 */
export async function extractQuizTextWithGemini(rawText: string): Promise<PdfParseResult | null> {
  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey || !rawText.trim()) {
    return null;
  }

  const textPrompt = `${EXTRACTION_PROMPT}\n\nRAW EXAMINATION TEXT TO PARSE:\n${rawText}`;

  const requestBody = {
    contents: [
      {
        parts: [{ text: textPrompt }],
      },
    ],
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0.1,
    },
  };

  for (const model of CANDIDATE_MODELS) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/${model}:generateContent?key=${apiKey}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        continue;
      }

      const responseJson: any = await response.json();
      const textOutput = responseJson.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!textOutput) continue;

      const cleaned = cleanJsonResponse(textOutput);
      const parsed = JSON.parse(cleaned);
      const result = sanitizeParsedResult(parsed);

      if (result.parsedQuestions.length > 0) {
        console.log(`[GeminiExtractor] Successfully parsed ${result.parsedQuestions.length} questions from text using ${model}.`);
        return result;
      }
    } catch (err: any) {
      console.warn(`[GeminiExtractor] Text error with ${model}:`, err.message);
    }
  }

  return null;
}
