import { fromSriLankanInputString, formatSriLankanTimePeriod, formatSriLankanTime } from './sriLankanTime.js';

export interface IParsedWindow {
  startTime: Date;
  endTime: Date;
  label?: string;
}

export function parseScheduleWindows(rawWindows: any[]): IParsedWindow[] {
  if (!Array.isArray(rawWindows) || rawWindows.length === 0) {
    return [];
  }

  const parsed: IParsedWindow[] = [];

  for (const w of rawWindows) {
    if (!w || !w.startTime || !w.endTime) continue;

    let s: Date;
    if (w.startTime instanceof Date) {
      s = w.startTime;
    } else if (typeof w.startTime === 'string' && (w.startTime.includes('Z') || w.startTime.includes('+'))) {
      s = new Date(w.startTime);
    } else if (typeof w.startTime === 'string') {
      s = fromSriLankanInputString(w.startTime);
    } else {
      s = new Date(w.startTime);
    }

    let e: Date;
    if (w.endTime instanceof Date) {
      e = w.endTime;
    } else if (typeof w.endTime === 'string' && (w.endTime.includes('Z') || w.endTime.includes('+'))) {
      e = new Date(w.endTime);
    } else if (typeof w.endTime === 'string') {
      e = fromSriLankanInputString(w.endTime);
    } else {
      e = new Date(w.endTime);
    }

    if (!isNaN(s.getTime()) && !isNaN(e.getTime()) && e > s) {
      parsed.push({
        startTime: s,
        endTime: e,
        label: w.label ? String(w.label).trim() : undefined,
      });
    }
  }

  // Sort chronologically by startTime
  parsed.sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
  return parsed;
}

export interface IQuizWindowStatus {
  hasMultipleWindows: boolean;
  windows: IParsedWindow[];
  firstStartTime: Date;
  mcqFinalEndTime: Date;
  finalEndTime: Date;
  isMcqEnded: boolean;
  isCurrentlyOpen: boolean;
  currentWindow: IParsedWindow | null;
  nextWindow: IParsedWindow | null;
  isBetweenWindows: boolean;
  isEnded: boolean;
  isUpcoming: boolean;
  hasEssay?: boolean;
  essayDeadline?: Date | null;
}

function parseFlexDate(val: any): Date | null {
  if (!val) return null;
  if (val instanceof Date) return isNaN(val.getTime()) ? null : val;
  if (typeof val === 'string') {
    if (val.includes('Z') || val.includes('+')) {
      const d = new Date(val);
      return isNaN(d.getTime()) ? null : d;
    }
    const d = fromSriLankanInputString(val);
    return isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : d;
}

export function getQuizWindowStatus(
  quiz: {
    status: string;
    startTime?: Date | string;
    endTime?: Date | string;
    scheduleWindows?: any[];
    hasEssay?: boolean;
    essayQuestionPaperFileId?: any;
    essayQuestionPaperFilename?: string;
    essayStartTime?: Date | string;
    essayEndTime?: Date | string;
    essayDurationMinutes?: number;
  },
  now = new Date()
): IQuizWindowStatus {
  const windows = parseScheduleWindows(quiz.scheduleWindows || []);
  const hasMultipleWindows = windows.length > 1;

  let baseStartTime: Date;
  let baseEndTime: Date;

  if (windows.length === 0) {
    baseStartTime = parseFlexDate(quiz.startTime) || now;
    baseEndTime = parseFlexDate(quiz.endTime) || new Date(now.getTime() + 86400000);
  } else {
    baseStartTime = windows[0].startTime;
    baseEndTime = windows[windows.length - 1].endTime;
  }

  // Essay timing evaluation:
  // If a quiz has an essay, the entire examination remains a LIVE examination until the essay deadline
  const hasEssay = Boolean(
    quiz.hasEssay ||
    quiz.essayQuestionPaperFileId ||
    (quiz as any).essayQuestionPaperFilename
  );

  let essayDeadline: Date | null = null;
  if (hasEssay) {
    essayDeadline = parseFlexDate(quiz.essayEndTime);
    if (!essayDeadline) {
      const durMins =
        typeof quiz.essayDurationMinutes === 'number' && quiz.essayDurationMinutes > 0
          ? quiz.essayDurationMinutes
          : 120;
      const essayStart = parseFlexDate(quiz.essayStartTime) || baseEndTime;
      essayDeadline = new Date(essayStart.getTime() + durMins * 60 * 1000);
    }
  }

  const mcqFinalEndTime = baseEndTime;
  const isMcqEnded = now >= mcqFinalEndTime || quiz.status === 'ARCHIVED';

  // Authoritative final end time of the entire examination (including essay deadline)
  const finalEndTime =
    hasEssay && essayDeadline && essayDeadline.getTime() > baseEndTime.getTime()
      ? essayDeadline
      : baseEndTime;

  const isEnded = now >= finalEndTime || quiz.status === 'ARCHIVED';
  const isUpcoming = !isEnded && now < baseStartTime && quiz.status !== 'ARCHIVED';

  let isCurrentlyOpen = false;
  let currentWindow: IParsedWindow | null = null;
  let nextWindow: IParsedWindow | null = null;
  let isBetweenWindows = false;

  if (isEnded || quiz.status === 'ARCHIVED' || quiz.status === 'DRAFT') {
    isCurrentlyOpen = false;
    currentWindow = null;
    nextWindow = null;
    isBetweenWindows = false;
  } else if (hasEssay && essayDeadline && essayDeadline.getTime() > baseEndTime.getTime()) {
    // When paper has an essay, the entire quiz examination remains LIVE until essay deadline!
    if (now >= baseStartTime && now < finalEndTime) {
      isCurrentlyOpen = true;
      // If within a scheduled MCQ window, keep it; otherwise define current window to finalEndTime
      const matched = windows.find((w) => now >= w.startTime && now < w.endTime);
      currentWindow = matched || {
        startTime: baseStartTime,
        endTime: finalEndTime,
        label: 'Full Paper Live Examination',
      };
      nextWindow = null;
      isBetweenWindows = false;
    } else {
      isCurrentlyOpen = false;
      currentWindow = null;
      nextWindow = now < baseStartTime ? { startTime: baseStartTime, endTime: finalEndTime } : null;
      isBetweenWindows = false;
    }
  } else if (windows.length === 0) {
    isCurrentlyOpen = !isEnded && now >= baseStartTime && now < baseEndTime && quiz.status !== 'ARCHIVED' && quiz.status !== 'DRAFT';
    currentWindow = isCurrentlyOpen ? { startTime: baseStartTime, endTime: baseEndTime } : null;
    nextWindow = isUpcoming ? { startTime: baseStartTime, endTime: baseEndTime } : null;
    isBetweenWindows = false;
  } else {
    // Standard windows without extended essay
    currentWindow = !isEnded
      ? windows.find((w) => now >= w.startTime && now < w.endTime) || null
      : null;
    isCurrentlyOpen = Boolean(currentWindow) && !isEnded && quiz.status !== 'ARCHIVED' && quiz.status !== 'DRAFT';
    nextWindow = !isEnded && !isCurrentlyOpen
      ? windows.find((w) => now < w.startTime) || null
      : null;
    isBetweenWindows = !isEnded && !isCurrentlyOpen && now >= baseStartTime && Boolean(nextWindow);
  }

  return {
    hasMultipleWindows,
    windows: windows.length > 0 ? windows : [{ startTime: baseStartTime, endTime: finalEndTime }],
    firstStartTime: baseStartTime,
    mcqFinalEndTime,
    finalEndTime,
    isMcqEnded,
    isCurrentlyOpen,
    currentWindow,
    nextWindow,
    isBetweenWindows,
    isEnded,
    isUpcoming,
    hasEssay,
    essayDeadline,
  };
}
