import { env } from '../config/env.js';
import pdfParse from 'pdf-parse';
import { IParsedQuestionItem } from '../models/PdfImport.js';

export interface IQuizGenerationTemplateOptions {
  title?: string;
  subjectName: string;
  defaultTopicName?: string;
  targetCategory?: string; // e.g. '2027 A/L', '2026 A/L', 'ALL'
  questionFormat?: 'MCQ_ONLY' | 'SHORT_ANSWER_ONLY' | 'MIXED';
  shortAnswerCount?: number;
  questionCount: number; // e.g. 5, 10, 20, 25, 40, 50
  optionsCount: number; // 4 or 5
  marksPerQuestion: number; // 1, 2, 4
  difficulty: 'EASY' | 'MEDIUM' | 'HARD' | 'MIXED';
  language: 'SINHALA' | 'ENGLISH' | 'BILINGUAL';
  customInstructions?: string;
}

export interface IQuizGenerationResult {
  quizTitle: string;
  subjectName: string;
  defaultTopicName: string;
  parsedQuestions: IParsedQuestionItem[];
  modelUsed: string;
}

const CANDIDATE_GEMINI_MODELS = [
  'gemini-2.5-flash',
  'gemini-2.0-flash',
  'gemini-1.5-flash',
  'gemini-2.5-pro',
  'gemini-1.5-pro',
];

function cleanJsonResponse(rawText: string): string {
  let cleaned = rawText.trim();
  if (cleaned.startsWith('```json')) {
    cleaned = cleaned.replace(/^```json\s*/, '').replace(/\s*```$/, '');
  } else if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```\s*/, '').replace(/\s*```$/, '');
  }
  return cleaned.trim();
}

/**
 * Builds the comprehensive generation prompt tailored for Sri Lankan national examinations.
 */
function buildSystemPrompt(template: IQuizGenerationTemplateOptions): string {
  const qCount = Math.max(1, Math.min(template.questionCount || 10, 60));
  const optCount = template.optionsCount === 4 ? 4 : 5;
  const optKeys = optCount === 4 ? ['A', 'B', 'C', 'D'] : ['A', 'B', 'C', 'D', 'E'];
  const optKeysStr = optKeys.join(', ');

  const qFormat = template.questionFormat || 'MCQ_ONLY';
  const shortCount = Math.min(template.shortAnswerCount || Math.max(1, Math.floor(qCount / 3)), qCount);

  const formatDirective =
    qFormat === 'SHORT_ANSWER_ONLY'
      ? `Generate exactly ${qCount} SHORT ANSWER QUESTIONS. Students must write concise, factual answers (not multiple choice).`
      : qFormat === 'MIXED'
      ? `Generate a balanced mix of questions: exactly ${qCount - shortCount} Multiple Choice Questions (MCQs) AND ${shortCount} Short Answer Questions (where students must write their answer).`
      : `Generate exactly ${qCount} Multiple Choice Questions (MCQs) with ${optCount} options each (${optKeysStr}).`;

  const languageDirective =
    template.language === 'SINHALA'
      ? 'Output ALL questions, options, answers, and explanations in standard, grammatically flawless Sri Lankan Unicode SINHALA.'
      : template.language === 'BILINGUAL'
      ? 'Output questions with key terms provided in both English and Sinhala.'
      : 'Output ALL questions, options, answers, and explanations in standard academic ENGLISH.';

  return `You are an elite Senior Chief Examiner and Academic Assessment Specialist specialized in modern educational curriculum examinations.

YOUR MISSION:
${formatDirective}
All questions must be based strictly on the provided SYLLABUS / STUDY MATERIAL and the following TEMPLATE SPECIFICATIONS:

SPECIFICATIONS:
- Subject: ${template.subjectName}
- Unit / Topic: ${template.defaultTopicName || 'Curriculum Syllabus Unit'}
- Target Batch / Level: ${template.targetCategory || 'General Examination'}
- Total Questions: ${qCount}
- Marks per Question: ${template.marksPerQuestion || 1}
- Difficulty Level: ${template.difficulty || 'MIXED'}
- Language Requirement: ${languageDirective}
${template.customInstructions ? `- Special Directives: ${template.customInstructions}` : ''}

QUESTION FORMAT RULES:
1. For MULTIPLE CHOICE QUESTIONS (MCQ):
   - "questionType": "MCQ"
   - Must have exactly ${optCount} options labeled: ${optKeysStr}.
   - "correctAnswer": Exactly one letter ('${optKeys.join("' or '")}').
2. For SHORT ANSWER QUESTIONS (SHORT_ANSWER):
   - "questionType": "SHORT_ANSWER"
   - "options": [] (empty array)
   - "correctAnswer": Exact model/expected scientific answer (e.g. "Photosynthesis" or "Carbon Dioxide")
   - "acceptableAnswers": Array of alternative acceptable answers, spellings, synonyms, abbreviations (e.g. ["Photosynthesis", "photosynthesis", "CO2"])
3. DETAILED EXPLANATION:
   - Provide a clear, comprehensive explanation ("explanation") for why the answer is correct and key points students should remember.
4. Keep mathematical/scientific expressions in LaTeX notation (e.g. $E = mc^2$, $H_2O$, $v = u + at$).

OUTPUT FORMAT:
Respond with ONLY a single valid JSON object adhering strictly to this schema:
{
  "quizTitle": "${template.title || `${template.subjectName} - Model Quiz`}",
  "subjectName": "${template.subjectName}",
  "defaultTopicName": "${template.defaultTopicName || 'General'}",
  "parsedQuestions": [
    {
      "questionNumber": 1,
      "questionType": "MCQ",
      "topicName": "${template.defaultTopicName || 'General'}",
      "questionText": "Question text...",
      "options": [
        ${optKeys.map((k) => `{ "key": "${k}", "text": "Option ${k}..." }`).join(',\n        ')}
      ],
      "correctAnswer": "A",
      "marks": ${template.marksPerQuestion || 1},
      "explanation": "Detailed explanation..."
    }
  ]
}`;
}

/**
 * Validates and sanitizes questions generated by the AI model.
 */
function sanitizeGeneratedQuestions(
  rawObj: any,
  template: IQuizGenerationTemplateOptions
): {
  quizTitle: string;
  subjectName: string;
  defaultTopicName: string;
  parsedQuestions: IParsedQuestionItem[];
} {
  const quizTitle =
    typeof rawObj.quizTitle === 'string' && rawObj.quizTitle.trim()
      ? rawObj.quizTitle.trim()
      : template.title || `${template.subjectName || 'Assessment'} - Model Quiz`;

  const subjectName =
    typeof rawObj.subjectName === 'string' && rawObj.subjectName.trim()
      ? rawObj.subjectName.trim()
      : template.subjectName || 'General';

  const defaultTopicName =
    typeof rawObj.defaultTopicName === 'string' && rawObj.defaultTopicName.trim()
      ? rawObj.defaultTopicName.trim()
      : template.defaultTopicName || 'General';

  const rawQuestions = Array.isArray(rawObj.parsedQuestions) ? rawObj.parsedQuestions : [];
  const parsedQuestions: IParsedQuestionItem[] = [];

  const optCount = template.optionsCount === 4 ? 4 : 5;
  const allowedKeys = optCount === 4 ? ['A', 'B', 'C', 'D'] : ['A', 'B', 'C', 'D', 'E'];

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
      (!rawOptions.length && template.questionFormat === 'SHORT_ANSWER_ONLY');

    if (isShortAnswer) {
      const correctAnswer = typeof q.correctAnswer === 'string' ? q.correctAnswer.trim() : '';
      const acceptableAnswers = Array.isArray(q.acceptableAnswers)
        ? q.acceptableAnswers.map((s: any) => String(s).trim()).filter(Boolean)
        : [];
      const marks = typeof q.marks === 'number' && q.marks > 0 ? q.marks : template.marksPerQuestion || 1;
      const explanation = typeof q.explanation === 'string' ? q.explanation.trim() : '';

      parsedQuestions.push({
        questionNumber: qNum,
        questionType: 'SHORT_ANSWER',
        topicName,
        questionText,
        options: [],
        correctAnswer,
        acceptableAnswers,
        marks,
        explanation,
        errors: [],
      });
      continue;
    }

    const options: { key: string; text: string; imageUrl?: string }[] = [];

    for (let j = 0; j < allowedKeys.length; j++) {
      const key = allowedKeys[j];
      const optMatch = rawOptions.find(
        (o: any) => o && typeof o.key === 'string' && o.key.trim().toUpperCase() === key
      ) || rawOptions[j];

      let text = '';
      if (optMatch && typeof optMatch.text === 'string') {
        text = optMatch.text.trim();
      } else if (typeof optMatch === 'string') {
        text = optMatch.trim();
      }

      if (!text) {
        text = `Option ${key}`;
      }

      options.push({ key, text });
    }

    let correctAnswer =
      typeof q.correctAnswer === 'string' ? q.correctAnswer.trim().toUpperCase() : 'A';
    if (!allowedKeys.includes(correctAnswer)) {
      correctAnswer = 'A';
    }

    const marks = typeof q.marks === 'number' && q.marks > 0 ? q.marks : template.marksPerQuestion || 1;
    const explanation = typeof q.explanation === 'string' ? q.explanation.trim() : '';

    parsedQuestions.push({
      questionNumber: qNum,
      questionType: 'MCQ',
      topicName,
      questionText,
      options,
      correctAnswer,
      marks,
      explanation,
      errors: [],
    });
  }

  // Ensure all selection (MCQ) questions are continuous first, followed strictly by all Short Answer questions
  const mcqQuestions = parsedQuestions.filter((q) => q.questionType !== 'SHORT_ANSWER');
  const shortAnswerQuestions = parsedQuestions.filter((q) => q.questionType === 'SHORT_ANSWER');
  const orderedQuestions = [...mcqQuestions, ...shortAnswerQuestions].map((q, idx) => ({
    ...q,
    questionNumber: idx + 1,
  }));

  return {
    quizTitle,
    subjectName,
    defaultTopicName,
    parsedQuestions: orderedQuestions,
  };
}

/**
 * Executes the generation workflow using Gemini Multimodal AI.
 */
export async function generateQuizWithGemini(
  template: IQuizGenerationTemplateOptions,
  syllabusBuffer?: Buffer,
  syllabusMimeType?: string,
  syllabusText?: string
): Promise<IQuizGenerationResult> {
  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured in backend environment.');
  }

  const systemPrompt = buildSystemPrompt(template);

  // Build Gemini contents payload
  const contentsParts: any[] = [];

  // Case 1: Syllabus PDF buffer provided
  if (syllabusBuffer && syllabusBuffer.length > 0) {
    const isPdf =
      syllabusMimeType === 'application/pdf' ||
      (!syllabusMimeType && syllabusBuffer.slice(0, 5).toString('ascii').startsWith('%PDF'));

    if (isPdf) {
      if (syllabusBuffer.length <= 20 * 1024 * 1024) {
        // Send directly as inline PDF to Gemini multimodal
        contentsParts.push({
          inlineData: {
            mimeType: 'application/pdf',
            data: syllabusBuffer.toString('base64'),
          },
        });
      } else {
        // Extract text via pdf-parse if buffer exceeds inline limit
        try {
          const parsed = await pdfParse(syllabusBuffer);
          const truncatedText = parsed.text.slice(0, 150000); // 150k characters
          contentsParts.push({
            text: `ATTACHED SYLLABUS / CURRICULUM TEXT:\n\n${truncatedText}`,
          });
        } catch (e: any) {
          console.warn('[GeminiQuizGenerator] pdf-parse fallback failed:', e?.message);
        }
      }
    } else {
      // Treat buffer as plain text
      const extractedText = syllabusBuffer.toString('utf-8').slice(0, 150000);
      contentsParts.push({
        text: `ATTACHED SYLLABUS / STUDY NOTES DOCUMENT:\n\n${extractedText}`,
      });
    }
  }

  // Case 2: Pasted raw syllabus text / topic notes
  if (syllabusText && syllabusText.trim()) {
    contentsParts.push({
      text: `SYLLABUS TOPIC NOTES & LESSON MATERIALS PROVIDED BY TEACHER:\n\n${syllabusText.trim()}`,
    });
  }

  // Add the prompt instruction
  contentsParts.push({
    text: systemPrompt,
  });

  const requestBody = {
    contents: [
      {
        parts: contentsParts,
      },
    ],
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0.25, // Slight temperature for creative and varied questions while staying strictly factual
    },
  };

  let lastError: Error | null = null;

  for (const model of CANDIDATE_GEMINI_MODELS) {
    try {
      const modelPath = model.startsWith('models/') ? model : `models/${model}`;
      const url = `https://generativelanguage.googleapis.com/v1beta/${modelPath}:generateContent?key=${apiKey}`;

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.warn(
          `[GeminiQuizGenerator] Model ${model} returned HTTP ${response.status}: ${errorText.slice(0, 250)}`
        );
        lastError = new Error(`Gemini API error (${response.status}): ${errorText.slice(0, 200)}`);
        continue;
      }

      const responseJson: any = await response.json();
      const rawText = responseJson.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!rawText) {
        console.warn(`[GeminiQuizGenerator] Model ${model} returned empty candidate text.`);
        continue;
      }

      const cleaned = cleanJsonResponse(rawText);
      const parsed = JSON.parse(cleaned);
      const sanitized = sanitizeGeneratedQuestions(parsed, template);

      if (sanitized.parsedQuestions.length > 0) {
        console.log(
          `[GeminiQuizGenerator] Successfully generated ${sanitized.parsedQuestions.length} questions for "${sanitized.subjectName}" using model ${model}.`
        );
        return {
          ...sanitized,
          modelUsed: model,
        };
      }
    } catch (err: any) {
      console.warn(`[GeminiQuizGenerator] Error calling model ${model}:`, err.message);
      lastError = err;
    }
  }

  console.warn('[GeminiQuizGenerator] Gemini models failed or not found. Falling back to Test AI Generator.');
  return generateFallbackQuizQuestions(template);
}

function generateFallbackQuizQuestions(template: IQuizGenerationTemplateOptions): IQuizGenerationResult {
  const qCount = Math.max(1, Math.min(template.questionCount || 10, 50));
  const optCount = template.optionsCount === 4 ? 4 : 5;
  const allowedKeys = optCount === 4 ? ['A', 'B', 'C', 'D'] : ['A', 'B', 'C', 'D', 'E'];
  const subject = template.subjectName || 'General Subject';
  const topic = template.defaultTopicName || 'Core Principles';

  const sampleQuestions = [
    {
      q: 'Which of the following statements represents the most accurate scientific principle?',
      opts: [
        'Systematic formulation of testable hypotheses based on empirical observations',
        'Drawing definitive conclusions without verifying boundary conditions',
        'Assuming correlation implies direct and exclusive causation',
        'Rejecting repeatable experimental evidence in favor of anecdotal claims',
        'All scientific models remain permanently immutable regardless of new data',
      ],
      correct: 'A',
      exp: 'The scientific method relies upon formulating testable hypotheses supported by verifiable, empirical data.',
    },
    {
      q: 'In dynamic systems analysis, what is the primary role of a negative feedback mechanism?',
      opts: [
        'Maintaining stability and homeostasis within defined operational thresholds',
        'Exponentially accelerating deviation away from equilibrium states',
        'Eliminating all energy transfer across system boundaries entirely',
        'Maximizing entropy and disorder within isolated closed structures',
        'Causing instantaneous system failure under minimal perturbation',
      ],
      correct: 'A',
      exp: 'Negative feedback operates counter to disturbances, restoring the system toward a steady-state equilibrium.',
    },
    {
      q: 'What is recognized as the foundational initial step in systematic problem-solving frameworks?',
      opts: [
        'Designing immediate experimental intervention protocols',
        'Precise problem identification, scoping, and boundary definition',
        'Prematurely selecting implementation tools before diagnosing root causes',
        'Generating final summary reports before data validation',
        'Calculating probability distributions without raw dataset verification',
      ],
      correct: 'B',
      exp: 'Clearly defining the problem and its parameters ensures all downstream analytical steps are focused and valid.',
    },
  ];

  const parsedQuestions: IParsedQuestionItem[] = [];
  for (let i = 0; i < qCount; i++) {
    const qNum = i + 1;
    const sample = sampleQuestions[i % sampleQuestions.length];
    const options = allowedKeys.map((key, kIdx) => ({
      key,
      text: sample.opts[kIdx] || `Option ${key}`,
    }));

    parsedQuestions.push({
      questionNumber: qNum,
      questionType: 'MCQ',
      topicName: topic,
      questionText: `${sample.q} (${subject} - Question ${qNum})`,
      options,
      correctAnswer: allowedKeys.includes(sample.correct) ? sample.correct : 'A',
      marks: template.marksPerQuestion || 1,
      explanation: sample.exp,
      errors: [],
    });
  }

  return {
    quizTitle: template.title || `${subject} - Practice Quiz`,
    subjectName: subject,
    defaultTopicName: topic,
    parsedQuestions,
    modelUsed: 'Test AI Generator',
  };
}
