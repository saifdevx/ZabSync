/** The grade points supplied in szabist-student-tools.zip, kept separate from UI. */
export const GRADE_SCALE = [
  { grade: 'A+', min: 90, points: 4 },
  { grade: 'A', min: 85, points: 3.75 },
  { grade: 'A-', min: 80, points: 3.5 },
  { grade: 'B+', min: 75, points: 3.25 },
  { grade: 'B', min: 70, points: 3 },
  { grade: 'B-', min: 66, points: 2.75 },
  { grade: 'C+', min: 63, points: 2.5 },
  { grade: 'C', min: 60, points: 2 },
  { grade: 'C-', min: 55, points: 1.5 },
  { grade: 'F', min: 0, points: 0 },
] as const;
export type Grade = (typeof GRADE_SCALE)[number]['grade'];
export interface CourseInput {
  name: string;
  credits: string | number;
  mode: 'marks' | 'grade';
  marks?: string | number;
  grade?: string;
}
function numeric(value: unknown, label: string): number {
  if (
    value === null ||
    value === undefined ||
    typeof value === 'boolean' ||
    String(value).trim() === ''
  )
    throw new Error(`Enter ${label}.`);
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`Enter a valid number for ${label}.`);
  return number;
}
export function gradeFromMarks(value: unknown) {
  const marks = numeric(value, 'a percentage');
  if (marks < 0 || marks > 100) throw new Error('Percentage must be between 0 and 100.');
  // Unlike the reference's integer-only lookup, decimal marks have no gaps between bands.
  return GRADE_SCALE.find((band) => marks >= band.min)!;
}
export function calculateGpa(
  courses: CourseInput[],
  previous?: { credits: string | number; cgpa: string | number },
) {
  if (!Array.isArray(courses) || !courses.length || courses.length > 40)
    throw new Error('Add between 1 and 40 courses.');
  let totalCredits = 0,
    totalPoints = 0;
  const results = courses.map((course, index) => {
    const name = course.name.trim() || `Course ${index + 1}`;
    const credits = numeric(course.credits, `credit hours for ${name}`);
    if (credits <= 0 || credits > 12)
      throw new Error(`Credit hours for ${name} must be above 0 and at most 12.`);
    const band =
      course.mode === 'grade'
        ? GRADE_SCALE.find(
            (entry) =>
              entry.grade ===
              String(course.grade || '')
                .trim()
                .toUpperCase(),
          )
        : gradeFromMarks(course.marks);
    if (!band) throw new Error(`Choose a supported grade for ${name}.`);
    totalCredits += credits;
    totalPoints += credits * band.points;
    return {
      name,
      credits,
      grade: band.grade,
      points: band.points,
      weightedPoints: credits * band.points,
    };
  });
  let priorCredits = 0,
    priorPoints = 0;
  if (previous) {
    priorCredits = numeric(previous.credits, 'previous completed credit hours');
    const cgpa = numeric(previous.cgpa, 'your previous CGPA');
    if (priorCredits < 0 || priorCredits > 1000)
      throw new Error('Previous credit hours must be between 0 and 1000.');
    if (cgpa < 0 || cgpa > 4) throw new Error('Previous CGPA must be between 0 and 4.');
    priorPoints = priorCredits * cgpa;
  }
  return {
    totalCredits,
    totalPoints,
    gpa: totalPoints / totalCredits,
    cumulativeCredits: priorCredits + totalCredits,
    cgpa: (priorPoints + totalPoints) / (priorCredits + totalCredits),
    courses: results,
  };
}

export interface CoverInput {
  studentName: string;
  regNumber: string;
  teacherName: string;
  subjectName: string;
  semester: string;
  section: string;
  assignmentNumber: string;
  submissionDate: string;
  kind: 'Assignment' | 'Quiz';
}
export function validateCover(input: CoverInput): CoverInput {
  const clean = (value: unknown, label: string, max: number) => {
    const text = String(value ?? '')
      .normalize('NFC')
      .replace(/[\u0000-\u001f\u007f]/g, ' ')
      .trim();
    if (!text || text.length > max) throw new Error(`${label} must contain 1–${max} characters.`);
    return text;
  };
  const value: CoverInput = {
    studentName: clean(input.studentName, 'Student name', 70),
    regNumber: clean(input.regNumber, 'Roll number', 20),
    teacherName: clean(input.teacherName, 'Teacher name', 70),
    subjectName: clean(input.subjectName, 'Subject name', 90),
    semester: clean(input.semester, 'Semester', 2),
    section: clean(input.section, 'Section', 2).toUpperCase(),
    assignmentNumber: clean(input.assignmentNumber, 'Document number', 3),
    submissionDate: clean(input.submissionDate, 'Submission date', 10),
    kind: input.kind,
  };
  if (!/^(?:[1-9]|1[0-2])$/.test(value.semester))
    throw new Error('Choose a semester between 1 and 12.');
  if (!/^[A-Z]{1,2}$/.test(value.section))
    throw new Error('Enter the section letter, for example D.');
  if (!/^[1-9]\d{0,2}$/.test(value.assignmentNumber))
    throw new Error('Document number must be between 1 and 999.');
  if (!['Assignment', 'Quiz'].includes(value.kind)) throw new Error('Choose Assignment or Quiz.');
  const date = new Date(`${value.submissionDate}T12:00:00Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value.submissionDate) ||
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value.submissionDate
  )
    throw new Error('Choose a valid submission date.');
  return value;
}
export function formatCoverDate(value: string) {
  return new Date(`${value}T12:00:00Z`)
    .toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: 'Asia/Karachi',
    })
    .replace(/(\w+) (\d{4})$/, '$1, $2');
}
export function coverFilename(input: CoverInput) {
  const safe = (value: string) =>
    value
      .replace(/[^a-zA-Z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'student';
  return `${input.kind}-${safe(input.assignmentNumber)}-${safe(input.regNumber)}.docx`;
}
