import { Request, Response, NextFunction } from 'express';
import { AiTemplate, IAiTemplate } from '../models/AiTemplate.js';
import { PdfImport } from '../models/PdfImport.js';
import { generateQuizWithGemini, IQuizGenerationTemplateOptions } from '../ai/geminiQuizGenerator.js';
import { ApiError } from '../utils/apiError.js';

const DEFAULT_PRESET_TEMPLATES: Partial<IAiTemplate>[] = [
  {
    title: 'Biology - 20 MCQs Model Paper',
    description: 'Comprehensive multiple-choice assessment based on core biological sciences curriculum.',
    subjectName: 'Biology',
    defaultTopicName: 'Cell Biology & Physiology',
    targetCategory: 'ALL',
    questionCount: 20,
    optionsCount: 5,
    marksPerQuestion: 1,
    difficulty: 'MIXED',
    language: 'ENGLISH',
    customInstructions: 'Focus on photosynthesis, cell respiration, genetics, and molecular biology. Provide concise explanations for answers.',
    isPreset: true,
  },
  {
    title: 'Chemistry - 15 MCQs Unit Test',
    description: 'Standard unit assessment covering organic, inorganic, and physical chemistry concepts.',
    subjectName: 'Chemistry',
    defaultTopicName: 'Chemical Calculations & Bonding',
    targetCategory: 'ALL',
    questionCount: 15,
    optionsCount: 5,
    marksPerQuestion: 1,
    difficulty: 'MEDIUM',
    language: 'ENGLISH',
    customInstructions: 'Include stoichiometry, equilibrium, and periodic trends. Provide step-by-step explanations for mathematical calculations.',
    isPreset: true,
  },
  {
    title: 'Physics - 15 MCQs Practical & Theory',
    description: 'Mechanics, oscillations, electricity, and applied physical principles.',
    subjectName: 'Physics',
    defaultTopicName: 'Mechanics & Dynamics',
    targetCategory: 'ALL',
    questionCount: 15,
    optionsCount: 5,
    marksPerQuestion: 1,
    difficulty: 'HARD',
    language: 'ENGLISH',
    customInstructions: 'Use LaTeX ($...$) for equations, units, and mathematical symbols. Emphasize experimental analysis and problem solving.',
    isPreset: true,
  },
  {
    title: 'Combined Mathematics - 10 MCQs Model Questions',
    description: 'Pure and applied mathematics foundational assessment.',
    subjectName: 'Combined Mathematics',
    defaultTopicName: 'Algebra & Calculus',
    targetCategory: 'ALL',
    questionCount: 10,
    optionsCount: 5,
    marksPerQuestion: 2,
    difficulty: 'MEDIUM',
    language: 'ENGLISH',
    customInstructions: 'Include series, trigonometry, and coordinate geometry. Express all formulas in LaTeX ($...$) format.',
    isPreset: true,
  },
  {
    title: 'General Science - 20 MCQs Term Assessment',
    description: 'Standard general science assessment covering matter, energy, and life systems.',
    subjectName: 'Science',
    defaultTopicName: 'Matter, Energy & Life',
    targetCategory: 'ALL',
    questionCount: 20,
    optionsCount: 4,
    marksPerQuestion: 1,
    difficulty: 'MIXED',
    language: 'ENGLISH',
    customInstructions: 'Design 4-option questions aligned with secondary school curriculum. Use concise and unambiguous language.',
    isPreset: true,
  },
];

/**
 * Get all AI Quiz Templates (seeds default presets if none exist)
 */
export async function getAiTemplates(req: Request, res: Response, next: NextFunction) {
  try {
    let templates = await AiTemplate.find().sort({ isPreset: -1, createdAt: -1 });

    if (templates.length === 0) {
      // Seed initial preset templates
      await AiTemplate.insertMany(DEFAULT_PRESET_TEMPLATES);
      templates = await AiTemplate.find().sort({ isPreset: -1, createdAt: -1 });
    }

    res.json({
      success: true,
      data: templates,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Create a new custom AI Quiz Template
 */
export async function createAiTemplate(req: Request, res: Response, next: NextFunction) {
  try {
    const adminId = req.user!.userId;
    const {
      title,
      description,
      subjectName,
      defaultTopicName,
      targetCategory,
      questionFormat,
      shortAnswerCount,
      questionCount,
      optionsCount,
      marksPerQuestion,
      difficulty,
      language,
      customInstructions,
    } = req.body;

    if (!title || !title.trim()) {
      throw new ApiError(400, 'Template title is required', 'INVALID_DATA');
    }

    if (!subjectName || !subjectName.trim()) {
      throw new ApiError(400, 'Subject is required', 'INVALID_DATA');
    }

    const template = await AiTemplate.create({
      title: title.trim(),
      description: description || '',
      subjectName: subjectName.trim(),
      defaultTopicName: (defaultTopicName || '').trim(),
      targetCategory: (targetCategory || 'ALL').trim(),
      questionFormat: questionFormat || 'MCQ_ONLY',
      shortAnswerCount: Number(shortAnswerCount) || 0,
      questionCount: Number(questionCount) || 10,
      optionsCount: Number(optionsCount) === 4 ? 4 : 5,
      marksPerQuestion: Number(marksPerQuestion) || 1,
      difficulty: difficulty || 'MIXED',
      language: language || 'SINHALA',
      customInstructions: customInstructions || '',
      isPreset: false,
      createdById: adminId,
    });

    res.status(201).json({
      success: true,
      message: 'Template saved successfully',
      data: template,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Update an existing AI Quiz Template
 */
export async function updateAiTemplate(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    const {
      title,
      description,
      subjectName,
      defaultTopicName,
      targetCategory,
      questionFormat,
      shortAnswerCount,
      questionCount,
      optionsCount,
      marksPerQuestion,
      difficulty,
      language,
      customInstructions,
    } = req.body;

    const template = await AiTemplate.findById(id);
    if (!template) {
      throw new ApiError(404, 'Template not found', 'NOT_FOUND');
    }

    if (title) template.title = title.trim();
    if (description !== undefined) template.description = description;
    if (subjectName) template.subjectName = subjectName.trim();
    if (defaultTopicName !== undefined) template.defaultTopicName = defaultTopicName.trim();
    if (targetCategory !== undefined) template.targetCategory = targetCategory.trim();
    if (questionFormat !== undefined) template.questionFormat = questionFormat;
    if (shortAnswerCount !== undefined) template.shortAnswerCount = Number(shortAnswerCount);
    if (questionCount) template.questionCount = Number(questionCount);
    if (optionsCount) template.optionsCount = Number(optionsCount) === 4 ? 4 : 5;
    if (marksPerQuestion) template.marksPerQuestion = Number(marksPerQuestion);
    if (difficulty) template.difficulty = difficulty;
    if (language) template.language = language;
    if (customInstructions !== undefined) template.customInstructions = customInstructions;

    await template.save();

    res.json({
      success: true,
      message: 'Template updated successfully',
      data: template,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Delete a custom AI Quiz Template
 */
export async function deleteAiTemplate(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    const template = await AiTemplate.findById(id);
    if (!template) {
      throw new ApiError(404, 'Template not found', 'NOT_FOUND');
    }

    if (template.isPreset) {
      throw new ApiError(400, 'Preset templates cannot be deleted', 'CANNOT_DELETE');
    }

    await AiTemplate.findByIdAndDelete(id);

    res.json({
      success: true,
      message: 'Template deleted successfully',
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Generate questions automatically using AI from uploaded syllabus document / text + template
 */
export async function generateQuizWithAi(req: Request, res: Response, next: NextFunction) {
  try {
    const adminId = req.user!.userId;
    const syllabusFile = req.file;
    const {
      title,
      subjectName,
      defaultTopicName,
      targetCategory,
      questionFormat,
      shortAnswerCount,
      questionCount,
      optionsCount,
      marksPerQuestion,
      difficulty,
      language,
      customInstructions,
      syllabusText,
    } = req.body;

    if (!subjectName || !subjectName.trim()) {
      throw new ApiError(400, 'Subject name is required', 'INVALID_DATA');
    }

    if (!syllabusFile && (!syllabusText || !syllabusText.trim())) {
      throw new ApiError(
        400,
        'Please upload a syllabus PDF or provide syllabus notes/text',
        'NO_SYLLABUS_CONTENT'
      );
    }

    const templateOptions: IQuizGenerationTemplateOptions = {
      title: (title || '').trim(),
      subjectName: subjectName.trim(),
      defaultTopicName: (defaultTopicName || '').trim(),
      targetCategory: (targetCategory || 'ALL').trim(),
      questionFormat: questionFormat || 'MCQ_ONLY',
      shortAnswerCount: Number(shortAnswerCount) || 0,
      questionCount: Math.max(1, Math.min(Number(questionCount) || 10, 60)),
      optionsCount: Number(optionsCount) === 4 ? 4 : 5,
      marksPerQuestion: Number(marksPerQuestion) || 1,
      difficulty: difficulty || 'MIXED',
      language: language || 'SINHALA',
      customInstructions: customInstructions || '',
    };

    const genResult = await generateQuizWithGemini(
      templateOptions,
      syllabusFile ? syllabusFile.buffer : undefined,
      syllabusFile ? syllabusFile.mimetype : undefined,
      syllabusText
    );

    // Save as a PdfImport document so admin can review, edit, and convert to quiz smoothly
    const pdfImport = await PdfImport.create({
      filename: syllabusFile ? syllabusFile.originalname : `${genResult.quizTitle}.ai_quiz`,
      subjectName: genResult.subjectName,
      topicName: genResult.defaultTopicName,
      parsedQuestions: genResult.parsedQuestions,
      validationErrors: [],
      status: 'PARSED',
      createdById: adminId,
    });

    res.json({
      success: true,
      message: `${genResult.parsedQuestions.length} questions generated successfully via AI`,
      data: {
        pdfImportId: pdfImport._id,
        quizTitle: genResult.quizTitle,
        subjectName: genResult.subjectName,
        defaultTopicName: genResult.defaultTopicName,
        parsedQuestions: genResult.parsedQuestions,
        modelUsed: genResult.modelUsed,
        pdfImport,
      },
    });
  } catch (err) {
    next(err);
  }
}
