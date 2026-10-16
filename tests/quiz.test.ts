import { parseQuizPdf } from '../src/pdf/pdfParser.js';

const samplePdfText = `
SUBJECT: විද්‍යාව

TOPIC: විදුලිය

QUESTION 1:
5V voltage එකක් 2Ω resistor එකක් හරහා යවන්නේ නම් current එක (I = V/R) කොපමණද?

A: 10 A
B: 2.5 A
C: 3 A
D: 7 A

CORRECT: B


TOPIC: ශක්තිය

QUESTION 2:
වස්තුවක චාලක ශක්තිය සඳහා සූත්‍රය (E = ½mv²) කුමක්ද?

A: E = mc²
B: E = ½mv²
C: F = ma
D: P = VI

CORRECT: B
`;

jest.mock('pdf-parse', () => {
  return jest.fn().mockImplementation(() => Promise.resolve({ text: samplePdfText }));
});

describe('PDF Parser Unit Tests with Sinhala Unicode & Math', () => {
  it('should parse structured PDF text with Sinhala, English, and Superscripts/Subscripts', async () => {
    const buffer = Buffer.from('mock pdf');
    const result = await parseQuizPdf(buffer);

    expect(result.subjectName).toBe('විද්‍යාව');
    expect(result.parsedQuestions.length).toBe(2);
    expect(result.parsedQuestions[0].questionText).toContain('5V voltage');
    expect(result.parsedQuestions[0].correctAnswer).toBe('B');
    expect(result.parsedQuestions[1].questionText).toContain('E = ½mv²');
  });
});

