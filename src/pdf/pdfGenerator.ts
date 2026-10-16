import PDFDocument from 'pdfkit';
import path from 'path';
import fs from 'fs';

export function getFontPath(fontName: string): string | null {
  const filenames = [
    fontName + '.ttf',
    fontName === 'NotoSansSinhala-Regular' ? 'NotoSansSinhala.ttf' : '',
    fontName === 'NotoSansSinhala' ? 'NotoSansSinhala-Regular.ttf' : '',
    fontName === 'Arial' ? 'arial.ttf' : '',
    fontName === 'Arial-Bold' ? 'arialbd.ttf' : '',
  ].filter(Boolean);

  const baseDirs = [
    path.join(__dirname, '../assets/fonts'),
    path.join(__dirname, '../../src/assets/fonts'),
    path.join(process.cwd(), 'src/assets/fonts'),
    path.join(process.cwd(), 'dist/assets/fonts'),
    path.join(process.cwd(), 'backend/src/assets/fonts'),
    path.join(process.cwd(), 'backend/dist/assets/fonts'),
    'C:/Windows/Fonts',
  ];

  for (const filename of filenames) {
    for (const dir of baseDirs) {
      const p = path.join(dir, filename);
      if (fs.existsSync(p)) {
        return p;
      }
    }
  }
  return null;
}

export function getSinhalaFontPath(variant: 'regular' | 'bold' = 'regular'): string | null {
  if (variant === 'bold') {
    return getFontPath('NotoSansSinhala-Bold') || getFontPath('NotoSansSinhala-Regular') || getFontPath('NotoSansSinhala');
  }
  return getFontPath('NotoSansSinhala-Regular') || getFontPath('NotoSansSinhala') || getFontPath('NotoSansSinhala-Bold');
}

export function getArialFontPath(variant: 'regular' | 'bold' = 'regular'): string | null {
  if (variant === 'bold') {
    return getFontPath('Arial-Bold') || getFontPath('Arial');
  }
  return getFontPath('Arial') || getFontPath('Arial-Bold');
}

export interface QuizReportData {
  quizTitle: string;
  quizNumber?: number;
  subjectName: string;
  targetCategory?: string;
  durationMinutes?: number;
  totalQuestions?: number;
  totalMarks?: number;
  dateStr: string;
  generatedDateStr?: string;
  status?: string;
  isQuizEnded?: boolean;
  isMcqEnded?: boolean;
  scheduledSriLankanEndTime?: string;

  // Executive Summary / Overall KPIs
  totalRegistered: number;
  totalParticipants: number;
  completedAttempts: number;
  completionRate: number;
  averageScore: number;
  medianScore?: number;
  highestScore: number;
  highestPercentage?: number;
  lowestScore: number;
  lowestPercentage?: number;
  passRate: number;
  passCount?: number;
  distinctionRate?: number;
  distinctionCount?: number;

  // Time metrics
  avgTimeSeconds?: number;
  minTimeSeconds?: number;
  maxTimeSeconds?: number;

  // G.C.E. A/L Standard Grade Classification
  gradeBreakdown?: Array<{
    grade: string;
    name: string;
    count: number;
    percentage: number;
    color?: string;
  }>;

  // Score Distribution Histogram (5 tiers)
  scoreBuckets?: Array<{
    range: string;
    count: number;
    percentage?: number;
    label?: string;
    description?: string;
  }>;

  // A/L Batch Category Performance Comparison
  batchStats?: Array<{
    batchName: string;
    participantCount: number;
    averageScore: number;
    passRate: number;
  }>;

  // Provincial Performance
  provinceStats?: Array<{
    provinceName: string;
    participantCount: number;
    averageScore: number;
    passRate: number;
  }>;

  // Question-Level Diagnostics
  hardestQuestion?: {
    questionNumber: number;
    accuracyRate: number;
    totalAttempts: number;
    correctCount: number;
    questionText: string;
    correctAnswer?: string;
  } | null;
  easiestQuestion?: {
    questionNumber: number;
    accuracyRate: number;
    totalAttempts: number;
    correctCount: number;
    questionText: string;
    correctAnswer?: string;
  } | null;
  questionStats?: Array<{
    questionNumber: number;
    marks?: number;
    totalAttempts: number;
    correctCount: number;
    accuracyRate: number;
    difficultyRating?: 'EASY' | 'MODERATE' | 'HARD';
    questionText?: string;
    correctAnswer?: string;
  }>;

  // Topic Performance (if any)
  topicStats?: Array<{
    topicName: string;
    questionCount: number;
    averagePercentage: number;
  }>;

  // Dual Assessment / Essay Paper (if hasEssay)
  hasEssay?: boolean;
  essayStats?: {
    totalSubmissions: number;
    markedCount: number;
    pendingCount: number;
    essayTotalMarks: number;
    averageMarks: number;
    averagePercentage: number;
    highestMarks: number;
    highestPercentage: number;
    lowestMarks: number;
    lowestPercentage: number;
    passRate: number;
    passCount: number;
    distinctionCount: number;
    gradeBreakdown?: Array<{
      grade: string;
      name: string;
      count: number;
      percentage: number;
      color?: string;
    }>;
    scoreBuckets?: Array<{
      range: string;
      count: number;
      percentage?: number;
    }>;
  } | null;

  fullPaperStats?: {
    totalParticipants: number;
    totalMarks: number;
    averageScore: number;
    averagePercentage: number;
    medianPercentage?: number;
    highestScore: number;
    highestPercentage: number;
    lowestScore: number;
    lowestPercentage: number;
    passRate: number;
    passCount: number;
    distinctionCount: number;
    gradeBreakdown?: Array<{
      grade: string;
      name: string;
      count: number;
      percentage: number;
      color?: string;
    }>;
    scoreBuckets?: Array<{
      range: string;
      count: number;
      percentage?: number;
    }>;
    markComparison?: {
      mcqTotalMarks: number;
      essayTotalMarks: number;
      mcqAverageScore: number;
      mcqAveragePercentage: number;
      essayAverageScore: number;
      essayAveragePercentage: number;
      mcqWeightPercentage: number;
      essayWeightPercentage: number;
    };
  } | null;

  // Leaderboards
  topRankers: Array<{
    rank: number | null;
    fullName: string;
    school: string;
    districtName: string;
    provinceName?: string;
    score: number;
    percentage: number;
    timeTakenStr: string;
  }>;

  fullPaperTopRankers?: Array<{
    rank: number | null;
    fullName: string;
    school: string;
    districtName: string;
    mcqScore: number;
    essayScore: number;
    totalScore: number;
    totalMarks: number;
    percentage: number;
    timeTakenStr?: string;
  }>;
}

export interface MonthlyReportData {
  title: string;
  year: number;
  month: number;
  totalQuizzes: number;
  totalParticipants: number;
  totalAttempts: number;
  averagePercentage: number;
  topStudents: Array<{
    rank: number;
    fullName: string;
    school: string;
    districtName: string;
    quizzesTaken: number;
    averagePercentage: number;
  }>;
  subjectBreakdown: Array<{
    subjectName: string;
    quizCount: number;
    averagePercentage: number;
  }>;
}

function cleanMathAndText(text?: string): string {
  if (!text) return '';
  return text
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/\$\$(.*?)\$\$/g, '$1')
    .replace(/\$(.*?)\$/g, '$1')
    .replace(/\\frac\{([^}]+)\}\{([^}]+)\}/g, '$1/$2')
    .replace(/\\sqrt\{([^}]+)\}/g, '√($1)')
    .replace(/\\times/g, '×')
    .replace(/\\div/g, '÷')
    .replace(/\\pm/g, '±')
    .replace(/\\leq/g, '≤')
    .replace(/\\geq/g, '≥')
    .replace(/\\neq/g, '≠')
    .replace(/\\degree/g, '°')
    .replace(/\\rightarrow/g, '→')
    .replace(/\\[a-zA-Z]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function formatSeconds(seconds?: number): string {
  if (seconds === undefined || seconds === null || seconds <= 0) return '-';
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  if (mins === 0) return `${secs}s`;
  return `${mins}m ${secs}s`;
}

export function generateQuizReportPdf(data: QuizReportData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 36, size: 'A4' });
      const buffers: Buffer[] = [];

      doc.on('data', (chunk) => buffers.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(buffers)));

      const regFont = getSinhalaFontPath('regular');
      const boldFont = getSinhalaFontPath('bold');
      if (regFont) doc.registerFont('SinhalaRegular', regFont);
      if (boldFont) doc.registerFont('SinhalaBold', boldFont);

      const setFont = (isBold = false) => {
        if (isBold && boldFont) doc.font('SinhalaBold');
        else if (regFont) doc.font('SinhalaRegular');
        else doc.font(isBold ? 'Helvetica-Bold' : 'Helvetica');
      };

      const pageWidth = 595.28;
      const margin = 36;
      const contentWidth = pageWidth - margin * 2; // 523.28 pt
      const contentMaxY = 770;

      let pageNum = 1;

      const drawProgressBar = (x: number, y: number, w: number, h: number, pct: number, fillHex: string, bgHex = '#E2E8F0') => {
        doc.roundedRect(x, y, w, h, 2).fill(bgHex);
        const clampedPct = Math.max(0, Math.min(100, pct || 0));
        const fillW = Math.round((clampedPct / 100) * w);
        if (fillW > 0) {
          doc.roundedRect(x, y, fillW, h, 2).fill(fillHex);
        }
      };

      const cleanTitle = (data.quizTitle || '').replace(/^(quiz\s*#\d+\s*[-:]?\s*)+/i, '').trim();
      const displayTitle = data.quizNumber ? `Quiz #${data.quizNumber} - ${cleanTitle}` : cleanTitle;

      const drawPageFooter = () => {
        doc.rect(margin, 780, contentWidth, 0.5).fill('#CBD5E1');
        setFont(false);
        doc.fillColor('#64748B').fontSize(7);
        doc.text('Official Academic Diagnostic Report (Confidential)', margin, 784, { width: 250, lineBreak: false });
        doc.text(`Page ${pageNum}`, margin + 230, 784, { width: 64, align: 'center', lineBreak: false });
        doc.text(`Report Date: ${data.generatedDateStr || data.dateStr}`, margin + 300, 784, { width: contentWidth - 300, align: 'right', lineBreak: false });
      };

      const addNewPage = () => {
        drawPageFooter();
        doc.addPage();
        pageNum++;
        // Running Top Header
        doc.rect(margin, 16, contentWidth, 14).fill('#F8FAFC');
        doc.rect(margin, 30, contentWidth, 0.5).fill('#CBD5E1');
        setFont(false);
        doc.fillColor('#64748B').fontSize(7).text(
          `Online Examination Portal | Quiz #${data.quizNumber || 1} — ${displayTitle} | Diagnostic Report`,
          margin + 4,
          20,
          { width: contentWidth - 8, lineBreak: false, ellipsis: true }
        );
        return 42;
      };

      // =========================================================================
      // PAGE 1: Executive Overview, Macro KPIs, Grades & Score Distribution
      // =========================================================================

      // 1. Executive Header Banner
      const headerH = 78;
      doc.roundedRect(margin, margin, contentWidth, headerH, 6).fill('#0F172A');
      doc.roundedRect(margin, margin, 4, headerH, 2).fill('#2563EB');

      setFont(false);
      doc.fillColor('#94A3B8').fontSize(7.5).text('Online Examination & Assessment Portal  |  Academic Diagnostic Report', margin + 14, margin + 8);

      setFont(true);
      doc.fillColor('#FFFFFF').fontSize(13.5).text(displayTitle, margin + 14, margin + 22, {
        width: contentWidth - 140,
        ellipsis: true,
        lineBreak: false,
      });

      // Badges Strip inside header
      setFont(false);
      doc.fillColor('#CBD5E1').fontSize(8).text(
        `Subject: ${data.subjectName}   |   Batch: ${data.targetCategory || 'All Students'}   |   Duration: ${data.durationMinutes || 0}m   |   Questions: ${data.totalQuestions || 0}   |   Total Marks: ${data.totalMarks || 100}`,
        margin + 14,
        margin + 44,
        { width: contentWidth - 140, ellipsis: true, lineBreak: false }
      );

      // Date & Status badge on top right
      doc.roundedRect(pageWidth - margin - 120, margin + 12, 110, 48, 4).fillAndStroke('#1E293B', '#334155');
      setFont(false);
      doc.fillColor('#94A3B8').fontSize(7.5).text('Exam Date:', pageWidth - margin - 114, margin + 18, { width: 98, lineBreak: false });
      setFont(true);
      doc.fillColor('#FFFFFF').fontSize(8.5).text(data.dateStr || '-', pageWidth - margin - 114, margin + 29, { width: 98, lineBreak: false, ellipsis: true });
      const isCompleted = data.isQuizEnded !== false;
      const statusBg = isCompleted ? '#065F46' : '#92400E';
      const statusText = isCompleted ? 'Completed' : 'Live Session';
      doc.roundedRect(pageWidth - margin - 114, margin + 43, 98, 12, 3).fill(statusBg);
      doc.fillColor('#FFFFFF').fontSize(7).text(statusText, pageWidth - margin - 114, margin + 45.5, { width: 98, align: 'center', lineBreak: false });

      // 2. Executive 6 KPI Summary Cards Grid
      let y = margin + headerH + 10;
      const kpiGap = 5;
      const cardW = Math.floor((contentWidth - kpiGap * 5) / 6); // ~83 pt each
      const cardH = 50;

      const kpis = [
        {
          label: 'Participants',
          val: `${data.totalParticipants || 0}`,
          sub: 'Candidates',
          color: '#0F172A',
        },
        {
          label: 'Average Score',
          val: `${Number(data.averageScore || 0).toFixed(1)}%`,
          sub: `Median: ${data.medianScore !== undefined ? `${data.medianScore}%` : '-'}`,
          color: '#2563EB',
        },
        {
          label: 'Highest Score',
          val: `${data.highestScore || 0}`,
          sub: `${data.highestPercentage ?? 0}% (Max)`,
          color: '#059669',
        },
        {
          label: 'Lowest Score',
          val: `${data.lowestScore || 0}`,
          sub: `${data.lowestPercentage ?? 0}% (Min)`,
          color: '#DC2626',
        },
        {
          label: 'Pass Rate',
          val: `${Number(data.passRate || 0).toFixed(1)}%`,
          sub: `${data.passCount ?? 0} Passed (≥35%)`,
          color: '#7C3AED',
        },
        {
          label: 'Distinctions',
          val: `${data.distinctionRate ?? 0}%`,
          sub: `${data.distinctionCount ?? 0} A Grades`,
          color: '#059669',
        },
      ];

      kpis.forEach((k, idx) => {
        const x = margin + idx * (cardW + kpiGap);
        doc.roundedRect(x, y, cardW, cardH, 5).fillAndStroke('#F8FAFC', '#E2E8F0');
        setFont(false);
        doc.fillColor('#64748B').fontSize(7.5).text(k.label, x + 2, y + 6, { width: cardW - 4, align: 'center', lineBreak: false, ellipsis: true });
        setFont(true);
        doc.fillColor(k.color).fontSize(12).text(k.val, x + 2, y + 18, { width: cardW - 4, align: 'center', lineBreak: false, ellipsis: true });
        setFont(false);
        doc.fillColor('#94A3B8').fontSize(6.5).text(k.sub, x + 2, y + 34, { width: cardW - 4, align: 'center', lineBreak: false, ellipsis: true });
      });

      y += cardH + 8;

      // 3. Exam Time Diagnostics Strip
      doc.roundedRect(margin, y, contentWidth, 20, 4).fillAndStroke('#F1F5F9', '#CBD5E1');
      setFont(false);
      doc.fillColor('#475569').fontSize(7);
      const timeCols = [
        `Average Time: ${formatSeconds(data.avgTimeSeconds)}`,
        `Fastest: ${formatSeconds(data.minTimeSeconds)}`,
        `Slowest: ${formatSeconds(data.maxTimeSeconds)}`,
        `Allocated: ${data.durationMinutes || 0}m`,
      ];
      const timeColW = contentWidth / 4;
      timeCols.forEach((tc, idx) => {
        doc.text(tc, margin + idx * timeColW + 4, y + 6, { width: timeColW - 8, lineBreak: false, ellipsis: true });
      });

      y += 28;

      // 4. Standard Grade Classification Table & Bars
      setFont(true);
      doc.fillColor('#0F172A').fontSize(10.5).text('Standard Academic Grade Classification', margin, y);
      setFont(false);
      doc.fillColor('#64748B').fontSize(7.5).text('A (≥75%), B (65-74%), C (50-64%), S (35-49%), F (<35%)', margin + 295, y + 2, { align: 'right', width: contentWidth - 295, lineBreak: false });

      y += 16;
      const gradeHeaderH = 18;
      doc.roundedRect(margin, y, contentWidth, gradeHeaderH, 3).fill('#1E3A8A');
      setFont(true);
      doc.fillColor('#FFFFFF').fontSize(8);
      doc.text('Grade', margin + 8, y + 5, { width: 50, lineBreak: false });
      doc.text('Criteria / Score Range', margin + 65, y + 5, { width: 155, lineBreak: false });
      doc.text('Count', margin + 225, y + 5, { width: 50, align: 'center', lineBreak: false });
      doc.text('Percentage (%)', margin + 285, y + 5, { width: 55, align: 'center', lineBreak: false });
      doc.text('Visual Distribution', margin + 355, y + 5, { width: 160, lineBreak: false });

      y += gradeHeaderH;
      const grades = data.gradeBreakdown && data.gradeBreakdown.length > 0 ? data.gradeBreakdown : [
        { grade: 'A', name: 'Distinction (A ≥ 75%)', count: 0, percentage: 0, color: '#059669' },
        { grade: 'B', name: 'Very Good (B: 65-74%)', count: 0, percentage: 0, color: '#2563EB' },
        { grade: 'C', name: 'Credit Pass (C: 50-64%)', count: 0, percentage: 0, color: '#7C3AED' },
        { grade: 'S', name: 'Ordinary Pass (S: 35-49%)', count: 0, percentage: 0, color: '#D97706' },
        { grade: 'F', name: 'Fail (F: < 35%)', count: 0, percentage: 0, color: '#DC2626' },
      ];

      const gradeRowH = 16;
      grades.forEach((g, idx) => {
        const bg = idx % 2 === 0 ? '#F8FAFC' : '#FFFFFF';
        doc.rect(margin, y, contentWidth, gradeRowH).fill(bg);
        doc.rect(margin, y, contentWidth, gradeRowH).strokeColor('#E2E8F0').lineWidth(0.5).stroke();

        const color = g.color || (g.grade === 'A' ? '#059669' : g.grade === 'B' ? '#2563EB' : g.grade === 'C' ? '#7C3AED' : g.grade === 'S' ? '#D97706' : '#DC2626');

        // Grade Badge
        doc.roundedRect(margin + 8, y + 3, 20, 10, 2).fill(color);
        setFont(true);
        doc.fillColor('#FFFFFF').fontSize(7.5).text(g.grade, margin + 8, y + 4, { width: 20, align: 'center', lineBreak: false });

        setFont(false);
        doc.fillColor('#0F172A').fontSize(7.5).text(g.name || `Grade ${g.grade}`, margin + 34, y + 4.5, {
          width: 185,
          lineBreak: false,
          ellipsis: true,
        });
        setFont(true);
        doc.fillColor('#0F172A').fontSize(8).text(`${g.count || 0}`, margin + 225, y + 4, { width: 50, align: 'center', lineBreak: false });
        doc.fillColor(color).fontSize(8).text(`${g.percentage || 0}%`, margin + 285, y + 4, { width: 55, align: 'center', lineBreak: false });

        // Visual bar
        drawProgressBar(margin + 355, y + 4.5, 120, 7, g.percentage || 0, color);
        setFont(false);
        doc.fillColor('#64748B').fontSize(7).text(`${g.percentage || 0}%`, margin + 482, y + 4.5, { width: 35, lineBreak: false });

        y += gradeRowH;
      });

      // Stacked Proportional Distribution Band across all 5 grades
      y += 4;
      doc.roundedRect(margin, y, contentWidth, 7, 2).fill('#E2E8F0');
      let stackX = margin;
      grades.forEach((g) => {
        const segW = Math.round(((g.percentage || 0) / 100) * contentWidth);
        if (segW > 0) {
          const c = g.color || (g.grade === 'A' ? '#059669' : g.grade === 'B' ? '#2563EB' : g.grade === 'C' ? '#7C3AED' : g.grade === 'S' ? '#D97706' : '#DC2626');
          doc.rect(stackX, y, segW, 7).fill(c);
          stackX += segW;
        }
      });

      y += 18;

      // 5. Score Distribution Histogram (5 Tiers)
      setFont(true);
      doc.fillColor('#0F172A').fontSize(10.5).text('Score Distribution Histogram', margin, y);
      setFont(false);
      doc.fillColor('#64748B').fontSize(7.5).text('Candidate score concentration across 5 tiers', margin + 295, y + 2, { align: 'right', width: contentWidth - 295, lineBreak: false });

      y += 16;
      doc.roundedRect(margin, y, contentWidth, gradeHeaderH, 3).fill('#334155');
      setFont(true);
      doc.fillColor('#FFFFFF').fontSize(8);
      doc.text('Score Range', margin + 8, y + 5, { width: 80, lineBreak: false });
      doc.text('Category', margin + 95, y + 5, { width: 140, lineBreak: false });
      doc.text('Candidates', margin + 240, y + 5, { width: 50, align: 'center', lineBreak: false });
      doc.text('Percentage (%)', margin + 295, y + 5, { width: 55, align: 'center', lineBreak: false });
      doc.text('Histogram Bar', margin + 360, y + 5, { width: 155, lineBreak: false });

      y += gradeHeaderH;
      const buckets = data.scoreBuckets && data.scoreBuckets.length > 0 ? data.scoreBuckets : [
        { range: '0 - 20%', count: 0, percentage: 0, description: 'Needs Remedial Focus' },
        { range: '21 - 40%', count: 0, percentage: 0, description: 'Developing' },
        { range: '41 - 60%', count: 0, percentage: 0, description: 'Average Pass' },
        { range: '61 - 80%', count: 0, percentage: 0, description: 'Merit Pass' },
        { range: '81 - 100%', count: 0, percentage: 0, description: 'High Distinction' },
      ];

      const bucketColors = ['#DC2626', '#EA580C', '#D97706', '#2563EB', '#059669'];

      buckets.forEach((b, idx) => {
        const bg = idx % 2 === 0 ? '#F8FAFC' : '#FFFFFF';
        doc.rect(margin, y, contentWidth, gradeRowH).fill(bg);
        doc.rect(margin, y, contentWidth, gradeRowH).strokeColor('#E2E8F0').lineWidth(0.5).stroke();

        const pct = data.totalParticipants > 0 ? Math.round((b.count / data.totalParticipants) * 100) : (b.percentage || 0);

        setFont(true);
        doc.fillColor('#0F172A').fontSize(7.5).text(b.range, margin + 8, y + 4.5, { width: 80, lineBreak: false });
        setFont(false);
        doc.fillColor('#475569').fontSize(7.5).text(b.description || b.label || '-', margin + 95, y + 4.5, {
          width: 140,
          lineBreak: false,
          ellipsis: true,
        });
        setFont(true);
        doc.fillColor('#0F172A').fontSize(8).text(`${b.count || 0}`, margin + 240, y + 4, { width: 50, align: 'center', lineBreak: false });
        doc.fillColor(bucketColors[idx] || '#2563EB').fontSize(8).text(`${pct}%`, margin + 295, y + 4, { width: 55, align: 'center', lineBreak: false });

        drawProgressBar(margin + 360, y + 4.5, 120, 7, pct, bucketColors[idx] || '#2563EB');
        setFont(false);
        doc.fillColor('#64748B').fontSize(7).text(`${pct}%`, margin + 488, y + 4.5, { width: 32, lineBreak: false });

        y += gradeRowH;
      });

      // 6. Batch Breakdown (if space allows on Page 1)
      if (data.batchStats && data.batchStats.length > 0 && y + 60 < contentMaxY) {
        y += 16;
        setFont(true);
        doc.fillColor('#0F172A').fontSize(10.5).text('Batch Performance Breakdown', margin, y);
        y += 14;

        doc.roundedRect(margin, y, contentWidth, 16, 2).fill('#4F46E5');
        setFont(true);
        doc.fillColor('#FFFFFF').fontSize(7.5);
        doc.text('Batch Category', margin + 8, y + 4, { width: 175, lineBreak: false });
        doc.text('Candidates', margin + 190, y + 4, { width: 90, align: 'center', lineBreak: false });
        doc.text('Average %', margin + 290, y + 4, { width: 100, align: 'center', lineBreak: false });
        doc.text('Pass Rate %', margin + 400, y + 4, { width: 110, align: 'center', lineBreak: false });

        y += 16;
        data.batchStats.forEach((bs, idx) => {
          const bg = idx % 2 === 0 ? '#F8FAFC' : '#FFFFFF';
          doc.rect(margin, y, contentWidth, 15).fill(bg);
          doc.rect(margin, y, contentWidth, 15).strokeColor('#E2E8F0').lineWidth(0.5).stroke();

          setFont(true);
          doc.fillColor('#0F172A').fontSize(7.5).text(bs.batchName || 'General', margin + 8, y + 3.5, { width: 175, lineBreak: false, ellipsis: true });
          setFont(false);
          doc.fillColor('#475569').fontSize(7.5).text(`${bs.participantCount || 0}`, margin + 190, y + 3.5, { width: 90, align: 'center', lineBreak: false });
          setFont(true);
          doc.fillColor('#2563EB').fontSize(7.5).text(`${bs.averageScore || 0}%`, margin + 290, y + 3.5, { width: 100, align: 'center', lineBreak: false });
          doc.fillColor('#059669').fontSize(7.5).text(`${bs.passRate || 0}%`, margin + 400, y + 3.5, { width: 110, align: 'center', lineBreak: false });

          y += 15;
        });
      }

      // =========================================================================
      // PAGE 2: Question-Level Diagnostics & Item Analysis
      // =========================================================================
      y = addNewPage();

      setFont(true);
      doc.fillColor('#0F172A').fontSize(12).text('Question Item Diagnostic Analysis', margin, y);
      setFont(false);
      doc.fillColor('#64748B').fontSize(7.5).text(
        'Success rates, difficulty indices, and item performance metrics across all questions',
        margin,
        y + 14
      );

      y += 26;

      // Spotlight Highlights Cards: Hardest & Easiest
      if (data.hardestQuestion || data.easiestQuestion) {
        const spotCardW = Math.floor((contentWidth - 10) / 2); // 256 pt each
        const spotCardH = 74;

        // Hardest Question Card (Left)
        if (data.hardestQuestion) {
          const hq = data.hardestQuestion;
          doc.roundedRect(margin, y, spotCardW, spotCardH, 5).fillAndStroke('#FEF2F2', '#FECACA');
          doc.roundedRect(margin, y, spotCardW, 3, 2).fill('#DC2626');

          setFont(true);
          doc.fillColor('#B91C1C').fontSize(8.5).text('★ Most Challenging Question', margin + 10, y + 8, { width: spotCardW - 20, lineBreak: false, ellipsis: true });
          doc.fillColor('#991B1B').fontSize(10.5).text(
            `Question #${hq.questionNumber}   —   Accuracy: ${hq.accuracyRate}%`,
            margin + 10,
            y + 21,
            { width: spotCardW - 20, lineBreak: false, ellipsis: true }
          );

          setFont(false);
          doc.fillColor('#7F1D1D').fontSize(7.5).text(
            `Attempts: ${hq.totalAttempts}   |   Correct: ${hq.correctCount}   |   Answer Key: ${hq.correctAnswer || '-'}`,
            margin + 10,
            y + 35,
            { width: spotCardW - 20, lineBreak: false, ellipsis: true }
          );

          const qSnippet = cleanMathAndText(hq.questionText).slice(0, 95);
          doc.fillColor('#374151').fontSize(7).text(`"${qSnippet}${qSnippet.length >= 95 ? '...' : ''}"`, margin + 10, y + 48, {
            width: spotCardW - 20,
            lineBreak: false,
            ellipsis: true,
          });
        }

        // Easiest Question Card (Right)
        if (data.easiestQuestion) {
          const eq = data.easiestQuestion;
          const eqX = margin + spotCardW + 10;
          doc.roundedRect(eqX, y, spotCardW, spotCardH, 5).fillAndStroke('#ECFDF5', '#A7F3D0');
          doc.roundedRect(eqX, y, spotCardW, 3, 2).fill('#059669');

          setFont(true);
          doc.fillColor('#047857').fontSize(8.5).text('★ Highest Mastery Question', eqX + 10, y + 8, { width: spotCardW - 20, lineBreak: false, ellipsis: true });
          doc.fillColor('#065F46').fontSize(10.5).text(
            `Question #${eq.questionNumber}   —   Accuracy: ${eq.accuracyRate}%`,
            eqX + 10,
            y + 21,
            { width: spotCardW - 20, lineBreak: false, ellipsis: true }
          );

          setFont(false);
          doc.fillColor('#064E3B').fontSize(7.5).text(
            `Attempts: ${eq.totalAttempts}   |   Correct: ${eq.correctCount}   |   Answer Key: ${eq.correctAnswer || '-'}`,
            eqX + 10,
            y + 35,
            { width: spotCardW - 20, lineBreak: false, ellipsis: true }
          );

          const eqSnippet = cleanMathAndText(eq.questionText).slice(0, 95);
          doc.fillColor('#374151').fontSize(7).text(`"${eqSnippet}${eqSnippet.length >= 95 ? '...' : ''}"`, eqX + 10, y + 48, {
            width: spotCardW - 20,
            lineBreak: false,
            ellipsis: true,
          });
        }

        y += spotCardH + 12;
      }

      // Comprehensive Question Item Analysis Table
      if (data.questionStats && data.questionStats.length > 0) {
        setFont(true);
        doc.fillColor('#0F172A').fontSize(10).text(`Complete Question Item Accuracy Registry (${data.questionStats.length} Questions)`, margin, y);
        y += 14;

        const drawQuestionTableHeader = (currentY: number) => {
          doc.roundedRect(margin, currentY, contentWidth, 18, 3).fill('#4338CA');
          setFont(true);
          doc.fillColor('#FFFFFF').fontSize(7.5);
          doc.text('#', margin + 4, currentY + 5, { width: 24, align: 'center', lineBreak: false });
          doc.text('Question Summary', margin + 32, currentY + 5, { width: 168, lineBreak: false });
          doc.text('Marks', margin + 205, currentY + 5, { width: 30, align: 'center', lineBreak: false });
          doc.text('Attempts', margin + 238, currentY + 5, { width: 44, align: 'center', lineBreak: false });
          doc.text('Correct', margin + 284, currentY + 5, { width: 40, align: 'center', lineBreak: false });
          doc.text('Accuracy %', margin + 326, currentY + 5, { width: 62, align: 'center', lineBreak: false });
          doc.text('Difficulty', margin + 392, currentY + 5, { width: 52, align: 'center', lineBreak: false });
          doc.text('Visual Metric', margin + 448, currentY + 5, { width: 70, lineBreak: false });
          return currentY + 18;
        };

        y = drawQuestionTableHeader(y);
        const qRowH = 16;

        data.questionStats.forEach((qs, idx) => {
          if (y + qRowH > contentMaxY) {
            y = addNewPage();
            y = drawQuestionTableHeader(y);
          }

          const bg = idx % 2 === 0 ? '#F8FAFC' : '#FFFFFF';
          doc.rect(margin, y, contentWidth, qRowH).fill(bg);
          doc.rect(margin, y, contentWidth, qRowH).strokeColor('#E2E8F0').lineWidth(0.5).stroke();

          // Q#
          setFont(true);
          doc.fillColor('#0F172A').fontSize(7.5).text(`Q${qs.questionNumber}`, margin + 4, y + 4, { width: 24, align: 'center', lineBreak: false });

          // Summary
          setFont(false);
          const qText = cleanMathAndText(qs.questionText).slice(0, 45);
          doc.fillColor('#334155').fontSize(7).text(qText || `Question ${qs.questionNumber}`, margin + 32, y + 4.5, {
            width: 168,
            ellipsis: true,
            lineBreak: false,
          });

          // Marks
          doc.fillColor('#475569').fontSize(7.5).text(`${qs.marks || 1}`, margin + 205, y + 4, { width: 30, align: 'center', lineBreak: false });

          // Total attempts
          doc.text(`${qs.totalAttempts || 0}`, margin + 238, y + 4, { width: 44, align: 'center', lineBreak: false });

          // Correct count
          doc.fillColor('#059669').text(`${qs.correctCount || 0}`, margin + 284, y + 4, { width: 40, align: 'center', lineBreak: false });

          // Accuracy Rate with color
          const diffColor = qs.accuracyRate >= 70 ? '#059669' : qs.accuracyRate >= 40 ? '#D97706' : '#DC2626';
          setFont(true);
          doc.fillColor(diffColor).fontSize(7.5).text(`${qs.accuracyRate || 0}%`, margin + 326, y + 4, { width: 62, align: 'center', lineBreak: false });

          // Difficulty pill
          const diffLabel = qs.accuracyRate >= 70 ? 'EASY' : qs.accuracyRate >= 40 ? 'MODERATE' : 'HARD';
          const diffBg = qs.accuracyRate >= 70 ? '#D1FAE5' : qs.accuracyRate >= 40 ? '#FEF3C7' : '#FEE2E2';
          doc.roundedRect(margin + 394, y + 3, 48, 10, 2).fill(diffBg);
          setFont(true);
          doc.fillColor(diffColor).fontSize(6.5).text(diffLabel, margin + 394, y + 4, { width: 48, align: 'center', lineBreak: false });

          // Visual bar
          drawProgressBar(margin + 448, y + 4.5, 66, 6, qs.accuracyRate || 0, diffColor);

          y += qRowH;
        });
      }

      // =========================================================================
      // PAGE 3 (or next): Provincial Performance & Dual Assessment / Essay
      // =========================================================================

      // Provincial Performance Table
      if (data.provinceStats && data.provinceStats.length > 0) {
        if (y + 140 > contentMaxY) {
          y = addNewPage();
        } else {
          y += 18;
        }

        setFont(true);
        doc.fillColor('#0F172A').fontSize(10.5).text('Provincial Performance Breakdown', margin, y);
        y += 14;

        doc.roundedRect(margin, y, contentWidth, 18, 3).fill('#0284C7');
        setFont(true);
        doc.fillColor('#FFFFFF').fontSize(8);
        doc.text('Province', margin + 10, y + 5, { width: 165, lineBreak: false });
        doc.text('Participants', margin + 180, y + 5, { width: 100, align: 'center', lineBreak: false });
        doc.text('Average %', margin + 290, y + 5, { width: 110, align: 'center', lineBreak: false });
        doc.text('Pass Rate %', margin + 405, y + 5, { width: 108, align: 'center', lineBreak: false });

        y += 18;
        const provRowH = 16;
        data.provinceStats.forEach((p, idx) => {
          if (y + provRowH > contentMaxY) {
            y = addNewPage();
          }

          const bg = idx % 2 === 0 ? '#F8FAFC' : '#FFFFFF';
          doc.rect(margin, y, contentWidth, provRowH).fill(bg);
          doc.rect(margin, y, contentWidth, provRowH).strokeColor('#E2E8F0').lineWidth(0.5).stroke();

          setFont(true);
          doc.fillColor('#0F172A').fontSize(8).text(p.provinceName || '-', margin + 10, y + 4, { width: 165, lineBreak: false, ellipsis: true });
          setFont(false);
          doc.fillColor('#475569').fontSize(8).text(`${p.participantCount || 0}`, margin + 180, y + 4, { width: 100, align: 'center', lineBreak: false });
          setFont(true);
          doc.fillColor('#0284C7').fontSize(8).text(`${p.averageScore || 0}%`, margin + 290, y + 4, { width: 110, align: 'center', lineBreak: false });
          doc.fillColor('#059669').fontSize(8).text(`${p.passRate || 0}%`, margin + 405, y + 4, { width: 108, align: 'center', lineBreak: false });

          y += provRowH;
        });
      }

      // Dual Assessment & Essay Paper Diagnostics (if hasEssay)
      if (data.hasEssay && (data.essayStats || data.fullPaperStats)) {
        if (y + 190 > contentMaxY) {
          y = addNewPage();
        } else {
          y += 18;
        }

        setFont(true);
        doc.fillColor('#0F172A').fontSize(11).text('Dual Assessment & Essay Paper Diagnostics', margin, y);
        setFont(false);
        doc.fillColor('#64748B').fontSize(7.5).text('Integrated performance analytics across MCQ Assessment and Written Essay Papers', margin, y + 13);

        y += 24;

        if (data.essayStats) {
          const es = data.essayStats;
          const eKpiW = Math.floor((contentWidth - 15) / 4);
          const eKpis = [
            { label: 'Submissions Received', val: `${es.totalSubmissions}`, sub: 'Uploads Received', color: '#6D28D9' },
            { label: 'Evaluated Papers', val: `${es.markedCount}`, sub: 'Evaluated by Panel', color: '#059669' },
            { label: 'Pending Evaluation', val: `${es.pendingCount}`, sub: 'Pending Review', color: '#D97706' },
            { label: 'Average Essay Score', val: `${es.averageMarks}`, sub: `${es.averagePercentage}% of ${es.essayTotalMarks}`, color: '#6D28D9' },
          ];

          eKpis.forEach((ek, idx) => {
            const ex = margin + idx * (eKpiW + 5);
            doc.roundedRect(ex, y, eKpiW, 46, 4).fillAndStroke('#F5F3FF', '#DDD6FE');
            setFont(false);
            doc.fillColor('#5B21B6').fontSize(7.5).text(ek.label, ex + 2, y + 5, { width: eKpiW - 4, align: 'center' });
            setFont(true);
            doc.fillColor(ek.color).fontSize(12).text(ek.val, ex + 2, y + 16, { width: eKpiW - 4, align: 'center' });
            setFont(false);
            doc.fillColor('#7C3AED').fontSize(6.5).text(ek.sub, ex + 2, y + 32, { width: eKpiW - 4, align: 'center' });
          });

          y += 54;
        }

        // Section Weight Comparison Table
        if (data.fullPaperStats?.markComparison) {
          const mc = data.fullPaperStats.markComparison;
          doc.roundedRect(margin, y, contentWidth, 16, 2).fill('#7C3AED');
          setFont(true);
          doc.fillColor('#FFFFFF').fontSize(7.5);
          doc.text('Assessment Component', margin + 8, y + 4, { width: 170, lineBreak: false, ellipsis: true });
          doc.text('Max Marks', margin + 180, y + 4, { width: 70, align: 'center', lineBreak: false });
          doc.text('Weight', margin + 255, y + 4, { width: 80, align: 'center', lineBreak: false });
          doc.text('Average', margin + 340, y + 4, { width: 80, align: 'center', lineBreak: false });
          doc.text('Average %', margin + 425, y + 4, { width: 90, align: 'center', lineBreak: false });

          y += 16;
          const rows = [
            { name: 'Component 1: MCQ Assessment', max: mc.mcqTotalMarks, w: `${mc.mcqWeightPercentage}%`, avg: mc.mcqAverageScore, pct: `${mc.mcqAveragePercentage}%` },
            { name: 'Component 2: Written Essay Paper', max: mc.essayTotalMarks, w: `${mc.essayWeightPercentage}%`, avg: mc.essayAverageScore, pct: `${mc.essayAveragePercentage}%` },
            { name: 'Composite: Full Examination Paper', max: data.fullPaperStats.totalMarks, w: '100%', avg: data.fullPaperStats.averageScore, pct: `${data.fullPaperStats.averagePercentage}%` },
          ];

          rows.forEach((r, idx) => {
            const bg = idx === 2 ? '#FEF3C7' : idx % 2 === 0 ? '#F8FAFC' : '#FFFFFF';
            doc.rect(margin, y, contentWidth, 15).fill(bg);
            doc.rect(margin, y, contentWidth, 15).strokeColor('#E2E8F0').lineWidth(0.5).stroke();

            setFont(idx === 2);
            doc.fillColor('#0F172A').fontSize(7.5).text(r.name, margin + 8, y + 3.5, { width: 170, lineBreak: false, ellipsis: true });
            doc.text(`${r.max}`, margin + 180, y + 3.5, { width: 70, align: 'center', lineBreak: false });
            doc.text(r.w, margin + 255, y + 3.5, { width: 80, align: 'center', lineBreak: false });
            doc.fillColor(idx === 2 ? '#B45309' : '#4338CA').text(`${r.avg}`, margin + 340, y + 3.5, { width: 80, align: 'center', lineBreak: false });
            doc.text(r.pct, margin + 425, y + 3.5, { width: 90, align: 'center', lineBreak: false });

            y += 15;
          });
        }
      }

      // =========================================================================
      // PAGE 4 (or next): Official Leaderboards & Rankings
      // =========================================================================

      // 1. MCQ Quiz Merit Leaderboard
      if (data.topRankers && data.topRankers.length > 0) {
        if (y + 160 > contentMaxY) {
          y = addNewPage();
        } else {
          y += 20;
        }

        const topSectionTitle = data.isQuizEnded === false
          ? 'Official MCQ Leaderboard (Note: Ranks finalize after exam session closes)'
          : 'Official MCQ Examination Leaderboard';

        setFont(true);
        doc.fillColor('#0F172A').fontSize(11).text(topSectionTitle, margin, y, { width: contentWidth, lineBreak: false, ellipsis: true });
        y += 14;

        const drawMcqLeaderboardHeader = (currentY: number) => {
          doc.roundedRect(margin, currentY, contentWidth, 18, 3).fill('#2563EB');
          setFont(true);
          doc.fillColor('#FFFFFF').fontSize(8);
          doc.text('Rank', margin + 6, currentY + 5, { width: 34, align: 'center', lineBreak: false });
          doc.text('Student Name', margin + 44, currentY + 5, { width: 146, lineBreak: false, ellipsis: true });
          doc.text('School / Institute', margin + 195, currentY + 5, { width: 130, lineBreak: false, ellipsis: true });
          doc.text('District', margin + 330, currentY + 5, { width: 74, lineBreak: false, ellipsis: true });
          doc.text('Score', margin + 408, currentY + 5, { width: 55, align: 'center', lineBreak: false });
          doc.text('Time', margin + 468, currentY + 5, { width: 50, align: 'center', lineBreak: false });
          return currentY + 18;
        };

        y = drawMcqLeaderboardHeader(y);
        const rankRowH = 16;

        data.topRankers.slice(0, 20).forEach((r, idx) => {
          if (y + rankRowH > contentMaxY) {
            y = addNewPage();
            y = drawMcqLeaderboardHeader(y);
          }

          const bg = idx % 2 === 0 ? '#F8FAFC' : '#FFFFFF';
          doc.rect(margin, y, contentWidth, rankRowH).fill(bg);
          doc.rect(margin, y, contentWidth, rankRowH).strokeColor('#E2E8F0').lineWidth(0.5).stroke();

          setFont(true);
          const rankText = r.rank ? `#${r.rank}` : idx < 3 ? `★${idx + 1}` : `${idx + 1}`;
          doc.fillColor('#D97706').fontSize(7.5).text(rankText, margin + 6, y + 4, { width: 34, align: 'center', lineBreak: false });

          doc.fillColor('#0F172A').fontSize(7.5).text(r.fullName, margin + 44, y + 4, { width: 146, lineBreak: false, ellipsis: true });
          setFont(false);
          doc.fillColor('#475569').fontSize(7).text(r.school, margin + 195, y + 4.5, { width: 130, lineBreak: false, ellipsis: true });
          doc.text(r.districtName || '-', margin + 330, y + 4.5, { width: 74, lineBreak: false, ellipsis: true });
          setFont(true);
          doc.fillColor('#2563EB').fontSize(7.5).text(`${r.score} (${r.percentage}%)`, margin + 408, y + 4, { width: 55, align: 'center', lineBreak: false });
          setFont(false);
          doc.fillColor('#64748B').fontSize(7).text(r.timeTakenStr, margin + 468, y + 4.5, { width: 50, align: 'center', lineBreak: false });

          y += rankRowH;
        });
      }

      // 2. Full Paper Composite Leaderboard (if hasEssay)
      if (data.hasEssay && data.fullPaperTopRankers && data.fullPaperTopRankers.length > 0) {
        if (y + 160 > contentMaxY) {
          y = addNewPage();
        } else {
          y += 20;
        }

        setFont(true);
        doc.fillColor('#0F172A').fontSize(11).text('Full Paper Composite Leaderboard (MCQ + Essay)', margin, y, { width: contentWidth, lineBreak: false, ellipsis: true });
        y += 14;

        const drawFullPaperHeader = (currentY: number) => {
          doc.roundedRect(margin, currentY, contentWidth, 18, 3).fill('#D97706');
          setFont(true);
          doc.fillColor('#FFFFFF').fontSize(8);
          doc.text('Rank', margin + 6, currentY + 5, { width: 34, align: 'center', lineBreak: false });
          doc.text('Student Name', margin + 44, currentY + 5, { width: 136, lineBreak: false, ellipsis: true });
          doc.text('School / Institute', margin + 185, currentY + 5, { width: 120, lineBreak: false, ellipsis: true });
          doc.text('District', margin + 310, currentY + 5, { width: 65, lineBreak: false, ellipsis: true });
          doc.text('MCQ + Essay', margin + 380, currentY + 5, { width: 70, align: 'center', lineBreak: false });
          doc.text('Total (%)', margin + 455, currentY + 5, { width: 63, align: 'center', lineBreak: false });
          return currentY + 18;
        };

        y = drawFullPaperHeader(y);
        const fpRowH = 16;

        data.fullPaperTopRankers.slice(0, 20).forEach((r, idx) => {
          if (y + fpRowH > contentMaxY) {
            y = addNewPage();
            y = drawFullPaperHeader(y);
          }

          const bg = idx % 2 === 0 ? '#FEF3C7' : '#FFFFFF';
          doc.rect(margin, y, contentWidth, fpRowH).fill(bg);
          doc.rect(margin, y, contentWidth, fpRowH).strokeColor('#FDE68A').lineWidth(0.5).stroke();

          setFont(true);
          const rankText = r.rank ? `#${r.rank}` : `${idx + 1}`;
          doc.fillColor('#B45309').fontSize(7.5).text(rankText, margin + 6, y + 4, { width: 34, align: 'center', lineBreak: false });

          doc.fillColor('#0F172A').fontSize(7.5).text(r.fullName, margin + 44, y + 4, { width: 136, lineBreak: false, ellipsis: true });
          setFont(false);
          doc.fillColor('#475569').fontSize(7).text(r.school, margin + 185, y + 4.5, { width: 120, lineBreak: false, ellipsis: true });
          doc.text(r.districtName || '-', margin + 310, y + 4.5, { width: 65, lineBreak: false, ellipsis: true });
          doc.fillColor('#78350F').fontSize(7.5).text(`${r.mcqScore} + ${r.essayScore}`, margin + 380, y + 4, { width: 70, align: 'center', lineBreak: false });
          setFont(true);
          doc.fillColor('#059669').fontSize(7.5).text(`${r.totalScore} (${r.percentage}%)`, margin + 455, y + 4, { width: 63, align: 'center', lineBreak: false });

          y += fpRowH;
        });
      }

      // Final Footer on last page
      drawPageFooter();
      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

export function generateMonthlyReportPdf(data: MonthlyReportData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 40, size: 'A4' });
      const buffers: Buffer[] = [];

      doc.on('data', (chunk) => buffers.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(buffers)));

      const regFont = getSinhalaFontPath('regular');
      const boldFont = getSinhalaFontPath('bold');
      if (regFont) doc.registerFont('SinhalaRegular', regFont);
      if (boldFont) doc.registerFont('SinhalaBold', boldFont);

      if (boldFont) {
        doc.font(boldFont);
      } else if (regFont) {
        doc.font(regFont);
      } else {
        doc.font('Helvetica');
      }

      // Banner
      doc.rect(0, 0, 595, 80).fill('#0F172A');
      doc.fillColor('#FFFFFF').fontSize(20).text('Monthly Examination Analytics Report', 40, 20);
      doc.fontSize(12).fillColor('#94A3B8').text(`Year: ${data.year} - Month: ${data.month}`, 40, 48);

      let y = 100;
      doc.fillColor('#0F172A').fontSize(14).text(`Overall Monthly Statistics (${data.year}/${data.month})`, 40, y);
      y += 25;

      const cards = [
        { label: 'Total Exams', val: `${data.totalQuizzes}` },
        { label: 'Total Candidates', val: `${data.totalParticipants}` },
        { label: 'Total Attempts', val: `${data.totalAttempts}` },
        { label: 'Average Score', val: `${data.averagePercentage.toFixed(1)}%` },
      ];

      cards.forEach((c, idx) => {
        const x = 40 + idx * 128;
        doc.rect(x, y, 120, 55).fillAndStroke('#F1F5F9', '#CBD5E1');
        doc.fillColor('#475569').fontSize(9).text(c.label, x + 5, y + 8, { width: 110, align: 'center' });
        doc.fillColor('#10B981').fontSize(14).text(c.val, x + 5, y + 28, { width: 110, align: 'center' });
      });

      y += 75;

      doc.fillColor('#0F172A').fontSize(13).text('Subject Performance Breakdown', 40, y);
      y += 20;

      doc.rect(40, y, 515, 20).fill('#334155');
      doc.fillColor('#FFFFFF').fontSize(9);
      doc.text('Subject', 45, y + 5, { width: 250, lineBreak: false, ellipsis: true });
      doc.text('Total Exams', 300, y + 5, { width: 130, align: 'center', lineBreak: false });
      doc.text('Average Score', 440, y + 5, { width: 110, align: 'center', lineBreak: false });

      y += 20;
      data.subjectBreakdown.forEach((s, idx) => {
        const bg = idx % 2 === 0 ? '#F8FAFC' : '#FFFFFF';
        doc.rect(40, y, 515, 18).fill(bg);
        doc.fillColor('#0F172A');
        doc.text(s.subjectName, 45, y + 4, { width: 250, lineBreak: false, ellipsis: true });
        doc.text(`${s.quizCount}`, 300, y + 4, { width: 130, align: 'center', lineBreak: false });
        doc.text(`${s.averagePercentage.toFixed(1)}%`, 440, y + 4, { width: 110, align: 'center', lineBreak: false });
        y += 18;
      });

      // Footer
      doc.fontSize(8).fillColor('#94A3B8').text('© Online Examination & Assessment System', 40, 780, { align: 'center' });

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

export interface RegisteredStudentPdfItem {
  fullName: string;
  school: string;
  username: string;
  email: string;
  whatsappNumber: string;
  phoneNumber?: string;
  alYear?: string;
  institute?: string;
  districtName?: string;
  provinceName?: string;
  createdAt?: Date | string;
}

export function generateRegisteredStudentsPdf(
  students: RegisteredStudentPdfItem[],
  options?: { filterCategory?: string; filterInstitute?: string }
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 35, size: 'A4', layout: 'landscape' });
      const buffers: Buffer[] = [];

      doc.on('data', (chunk) => buffers.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(buffers)));

      const regFont = getSinhalaFontPath('regular');
      const boldFont = getSinhalaFontPath('bold');
      if (regFont) doc.registerFont('SinhalaRegular', regFont);
      if (boldFont) doc.registerFont('SinhalaBold', boldFont);

      const setFont = (isBold = false) => {
        if (isBold && boldFont) doc.font('SinhalaBold');
        else if (regFont) doc.font('SinhalaRegular');
        else doc.font(isBold ? 'Helvetica-Bold' : 'Helvetica');
      };

      const pageWidth = 842;
      const pageHeight = 595;
      const margin = 35;
      const contentWidth = pageWidth - margin * 2; // 772

      const colX = {
        idx: margin,            // 35, width 28
        name: margin + 28,      // 63, width 145
        school: margin + 173,   // 208, width 120
        institute: margin + 293,// 328, width 105
        username: margin + 398, // 433, width 90
        email: margin + 488,    // 523, width 120
        whatsapp: margin + 608, // 643, width 100
        alYear: margin + 708,   // 743, width 64
      };

      const drawTableHeader = (currentY: number) => {
        doc.rect(margin, currentY, contentWidth, 22).fill('#1E3A8A');
        setFont(true);
        doc.fillColor('#FFFFFF').fontSize(8.5);
        doc.text('#', colX.idx + 2, currentY + 6, { width: 24, align: 'center' });
        doc.text('Student Name', colX.name + 4, currentY + 6, { width: 137 });
        doc.text('School', colX.school + 4, currentY + 6, { width: 112 });
        doc.text('Institute', colX.institute + 4, currentY + 6, { width: 97 });
        doc.text('Username', colX.username + 4, currentY + 6, { width: 82 });
        doc.text('Email Address', colX.email + 4, currentY + 6, { width: 112 });
        doc.text('Phone No', colX.whatsapp + 4, currentY + 6, { width: 92 });
        doc.text('Batch', colX.alYear + 2, currentY + 6, { width: 60, align: 'center' });
        return currentY + 22;
      };

      // Header Banner on Page 1
      doc.rect(0, 0, pageWidth, 68).fill('#0F172A');
      setFont(true);
      doc.fillColor('#FFFFFF').fontSize(17).text('Examination Portal — Registered Students Directory', margin, 17);
      setFont(false);
      doc.fillColor('#94A3B8').fontSize(9).text(
        'Complete Registered Student Directory & Contact Records',
        margin,
        41
      );

      // Metadata summary strip
      let y = 78;
      doc.rect(margin, y, contentWidth, 26).fillAndStroke('#F8FAFC', '#CBD5E1');
      setFont(true);
      doc.fillColor('#0F172A').fontSize(8.5);
      doc.text(`Total Students: ${students.length}`, margin + 10, y + 8);
      
      const categoryLabel = options?.filterCategory && options.filterCategory !== 'ALL'
        ? options.filterCategory
        : 'All Batches';
      doc.text(`Batch: ${categoryLabel}`, margin + 140, y + 8);

      const instituteLabel = options?.filterInstitute && options.filterInstitute !== 'ALL'
        ? options.filterInstitute
        : 'All Institutes';
      doc.text(`Institute: ${instituteLabel}`, margin + 300, y + 8);

      doc.text(`Exported: ${new Date().toLocaleDateString('si-LK')} ${new Date().toLocaleTimeString('en-US')}`, margin + 500, y + 8);

      y += 34;
      y = drawTableHeader(y);

      const rowHeight = 20;
      const maxY = pageHeight - 35;

      students.forEach((s, idx) => {
        if (y + rowHeight > maxY) {
          doc.addPage({ margin: 35, size: 'A4', layout: 'landscape' });
          y = 35;
          y = drawTableHeader(y);
        }

        const bg = idx % 2 === 0 ? '#F8FAFC' : '#FFFFFF';
        doc.rect(margin, y, contentWidth, rowHeight).fill(bg);
        doc.rect(margin, y, contentWidth, rowHeight).strokeColor('#E2E8F0').lineWidth(0.5).stroke();

        setFont(false);
        doc.fontSize(8).fillColor('#0F172A');
        doc.text(`${idx + 1}`, colX.idx + 2, y + 5, { width: 24, align: 'center', lineBreak: false });
        doc.text(s.fullName || '', colX.name + 4, y + 5, { width: 137, lineBreak: false, ellipsis: true });
        doc.text(s.school || '-', colX.school + 4, y + 5, { width: 112, lineBreak: false, ellipsis: true });

        doc.fillColor('#7C3AED'); // Purple for Institute
        doc.text(s.institute || 'None', colX.institute + 4, y + 5, { width: 97, lineBreak: false, ellipsis: true });

        doc.fillColor('#2563EB');
        doc.text(s.username || '-', colX.username + 4, y + 5, { width: 82, lineBreak: false, ellipsis: true });

        doc.fillColor('#475569');
        doc.text(s.email || '-', colX.email + 4, y + 5, { width: 112, lineBreak: false, ellipsis: true });

        const wNo = s.whatsappNumber || s.phoneNumber || '-';
        doc.fillColor('#059669'); // Emerald green for WhatsApp
        doc.text(wNo, colX.whatsapp + 4, y + 5, { width: 92, lineBreak: false, ellipsis: true });

        doc.fillColor('#4F46E5');
        doc.text(s.alYear || '-', colX.alYear + 2, y + 5, { width: 60, align: 'center', lineBreak: false });

        y += rowHeight;
      });

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

