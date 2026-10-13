import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import JSZip from 'jszip';
import {
  calculateGpa,
  coverFilename,
  formatCoverDate,
  gradeFromMarks,
  GRADE_SCALE,
  validateCover,
  type CoverInput,
} from '../client/src/student-tools.ts';
import { buildCoverDocx } from '../client/src/cover-docx.ts';

const sample: CoverInput = {
  studentName: 'Ayesha Ahmed',
  regNumber: '2412339',
  subjectName: 'Operating Systems',
  teacherName: 'Dr. Sara Ahmed',
  semester: '5',
  section: 'D',
  assignmentNumber: '1',
  submissionDate: '2026-10-20',
  kind: 'Assignment',
};
test('supplied integer grade bands and decimal boundaries produce defined, unchanged points', () => {
  for (const band of GRADE_SCALE) assert.equal(gradeFromMarks(band.min).points, band.points);
  for (let mark = 0; mark <= 100; mark++) assert.ok(gradeFromMarks(mark));
  assert.equal(gradeFromMarks(89.5).grade, 'A');
  assert.equal(gradeFromMarks(54.99).grade, 'F');
  assert.equal(gradeFromMarks(100).grade, 'A+');
  for (const invalid of ['', ' ', undefined, null, -1, 101, NaN, Infinity])
    assert.throws(() => gradeFromMarks(invalid));
});
test('semester and cumulative GPA use credit weighting without premature rounding', () => {
  const result = calculateGpa(
    [
      { name: 'Operating Systems', credits: 3, mode: 'marks', marks: 91 },
      { name: 'Lab', credits: 1, mode: 'grade', grade: 'C' },
    ],
    { credits: 20, cgpa: 3 },
  );
  assert.equal(result.totalCredits, 4);
  assert.equal(result.totalPoints, 14);
  assert.equal(result.gpa, 3.5);
  assert.equal(result.cgpa, 74 / 24);
  assert.notEqual(result.cgpa, (3 + 3.5) / 2);
  assert.equal(calculateGpa([{ name: '', credits: 3, mode: 'marks', marks: 0 }]).gpa, 0);
  assert.throws(() => calculateGpa([{ name: '', credits: 0, mode: 'marks', marks: 90 }]));
  assert.throws(() => calculateGpa([{ name: '', credits: '', mode: 'marks', marks: 90 }]));
  assert.throws(() => calculateGpa([{ name: '', credits: 3, mode: 'marks', marks: '' }]));
  assert.throws(() => calculateGpa([{ name: '', credits: 3, mode: 'grade', grade: 'X' }]));
  assert.throws(() => calculateGpa([], { credits: 0, cgpa: 0 }));
});
test('cover validation rejects impossible dates and keeps download filenames safe', () => {
  assert.equal(formatCoverDate('2026-10-20'), '20 October, 2026');
  assert.throws(() => validateCover({ ...sample, submissionDate: '2026-02-31' }));
  assert.throws(() => validateCover({ ...sample, semester: '0' }));
  assert.throws(() => validateCover({ ...sample, section: '5D' }));
  assert.equal(
    coverFilename({ ...sample, regNumber: '../../2412339' }),
    'Assignment-1-2412339.docx',
  );
});
test('Word output retains original template assets/layout and fills only intended content', async () => {
  const original = await readFile(
    new URL('../client/public/templates/assignment-cover.docx', import.meta.url),
  );
  const template = await JSZip.loadAsync(original);
  const generated = await JSZip.loadAsync(await buildCoverDocx(original, sample));
  for (const [path, entry] of Object.entries(template.files)) {
    if (entry.dir || ['word/document.xml', 'word/footer1.xml', 'docProps/core.xml'].includes(path))
      continue;
    assert.deepEqual(
      await generated.file(path)!.async('uint8array'),
      await entry.async('uint8array'),
      `Preserve ${path}`,
    );
  }
  const body = await generated.file('word/document.xml')!.async('string');
  assert.match(body, /Operating Systems/);
  assert.match(body, /Ayesha Ahmed/);
  assert.match(body, /Dr\. Sara Ahmed/);
  assert.match(body, /2412339/);
  assert.match(body, /20 October, 2026/);
  assert.match(body, /Assignment # 1 /);
  assert.equal((body.match(/<w:pgBorders\b/g) || []).length, 1);
  assert.doesNotMatch(body, /<w:t[^>]*>Name<\/w:t>|<w:t[^>]*>00000<\/w:t>|11 November, 2022/);
  const footer = await generated.file('word/footer1.xml')!.async('string');
  assert.match(footer, /BSCS – 5D/);
  assert.match(footer, /SZABIST-ISB/);
});
test('user text is XML-escaped; Quiz preserves the same cover structure', async () => {
  const original = await readFile(
    new URL('../client/public/templates/assignment-cover.docx', import.meta.url),
  );
  const generated = await JSZip.loadAsync(
    await buildCoverDocx(original, {
      ...sample,
      kind: 'Quiz',
      assignmentNumber: '2',
      studentName: 'A & B <C>',
      subjectName: 'A long descriptive subject title for advanced database systems',
    }),
  );
  const body = await generated.file('word/document.xml')!.async('string');
  assert.match(body, /A &amp; B &lt;C&gt;/);
  assert.match(body, /Quiz # 2 /);
  assert.match(body, /w:val="32"/);
  const footer = await generated.file('word/footer1.xml')!.async('string');
  assert.match(footer, /…/);
});
