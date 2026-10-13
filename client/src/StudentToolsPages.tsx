import { useState, type FormEvent } from 'react';
import {
  Calculator,
  Check,
  Download,
  FileText,
  LoaderCircle,
  Plus,
  RotateCcw,
  Trash2,
  WifiOff,
} from 'lucide-react';
import { useAuth, errorMessage } from './auth';
import { EmptyState, ErrorNotice } from './components';
import { enrolledClasses } from './permissions';
import { useSite } from './site';
import {
  calculateGpa,
  coverFilename,
  formatCoverDate,
  GRADE_SCALE,
  validateCover,
  type CoverInput,
  type CourseInput,
} from './student-tools';

function ToolHeading({
  title,
  description,
  icon: Icon,
}: {
  title: string;
  description: string;
  icon: typeof FileText;
}) {
  return (
    <header className="tool-heading">
      <div className="tool-heading-icon">
        <Icon size={25} />
      </div>
      <div>
        <span className="eyebrow">YOUR STUDENT TOOLKIT</span>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      <span className="tool-local-badge">
        <WifiOff size={14} /> Works offline after setup
      </span>
    </header>
  );
}
function saveDownload(bytes: Uint8Array, name: string) {
  const file = new Blob([new Uint8Array(bytes)], {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export function FrontPagePage() {
  const auth = useAuth(),
    site = useSite();
  const section = enrolledClasses(auth.me)[0];
  const [form, setForm] = useState<CoverInput>(() => ({
    studentName: auth.me?.user.displayName || '',
    regNumber: auth.me?.user.email.split('@')[0] || '',
    teacherName: '',
    subjectName: '',
    semester: String(section?.semester || ''),
    section: section?.section.replace(/^[0-9]+/, '') || '',
    assignmentNumber: '1',
    submissionDate: '',
    kind: 'Assignment',
  }));
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [downloaded, setDownloaded] = useState('');
  if (site.settings?.features.frontPage !== true)
    return (
      <EmptyState icon={<FileText size={28} />} title="Front page is paused">
        The owner has turned this tool off for now.
      </EmptyState>
    );
  const change = (key: keyof CoverInput, value: string) => {
    setForm((old) => ({ ...old, [key]: value }));
    setDownloaded('');
    setError('');
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    setDownloaded('');
    try {
      const value = validateCover(form);
      const response = await fetch('/templates/assignment-cover.docx', { cache: 'force-cache' });
      if (!response.ok)
        throw new Error('The template is unavailable. Reconnect and refresh ZabSync once.');
      const template = await response.arrayBuffer();
      if (template.byteLength > 1024 * 1024)
        throw new Error('The template could not be loaded safely. Refresh the app.');
      const { buildCoverDocx } = await import('./cover-docx');
      const bytes = await buildCoverDocx(template, value);
      const filename = coverFilename(value);
      saveDownload(bytes, filename);
      setDownloaded(filename);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="student-tool-page">
      <ToolHeading
        title="Front page"
        description="Fill in the details. Your university cover is ready in Word."
        icon={FileText}
      />
      <div className="student-tools-grid">
        <section className="tool-panel">
          <div className="tool-panel-heading">
            <span className="tool-step">01</span>
            <div>
              <h2>Make it yours</h2>
              <p>Your details stay on this device.</p>
            </div>
          </div>
          <form className="form-stack" onSubmit={submit}>
            <div className="tool-form-row">
              <label>
                Student name
                <input
                  required
                  maxLength={70}
                  autoComplete="name"
                  value={form.studentName}
                  onChange={(e) => change('studentName', e.target.value)}
                  placeholder="Your full name"
                />
              </label>
              <label>
                Roll / registration number
                <input
                  required
                  maxLength={20}
                  value={form.regNumber}
                  onChange={(e) => change('regNumber', e.target.value)}
                  placeholder="2412339"
                />
              </label>
            </div>
            <label>
              Subject name
              <input
                required
                maxLength={90}
                value={form.subjectName}
                onChange={(e) => change('subjectName', e.target.value)}
                placeholder="Operating Systems"
              />
            </label>
            <label>
              Submitted to
              <input
                required
                maxLength={70}
                value={form.teacherName}
                onChange={(e) => change('teacherName', e.target.value)}
                placeholder="Teacher’s name"
              />
            </label>
            <div className="tool-form-row">
              <label>
                Semester
                <select
                  required
                  value={form.semester}
                  onChange={(e) => change('semester', e.target.value)}
                >
                  <option value="">Choose semester</option>
                  {Array.from({ length: 12 }, (_, i) => (
                    <option key={i + 1} value={i + 1}>
                      {i + 1}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Section letter
                <input
                  required
                  maxLength={2}
                  pattern="[A-Za-z]{1,2}"
                  value={form.section}
                  onChange={(e) => change('section', e.target.value.toUpperCase())}
                  placeholder="D"
                />
              </label>
            </div>
            <div className="tool-form-row">
              <label>
                Document type
                <select value={form.kind} onChange={(e) => change('kind', e.target.value)}>
                  <option>Assignment</option>
                  <option>Quiz</option>
                </select>
              </label>
              <label>
                Number
                <input
                  required
                  type="number"
                  min={1}
                  max={999}
                  step={1}
                  value={form.assignmentNumber}
                  onChange={(e) => change('assignmentNumber', e.target.value)}
                />
              </label>
            </div>
            <label>
              Submission date
              <input
                required
                type="date"
                value={form.submissionDate}
                onChange={(e) => change('submissionDate', e.target.value)}
              />
            </label>
            <ErrorNotice message={error} />
            <button className="button button-primary button-full" disabled={busy}>
              {busy ? <LoaderCircle className="spin" size={18} /> : <Download size={18} />}{' '}
              {busy ? 'Preparing your document…' : 'Download Word document'}
            </button>
            {downloaded && (
              <p className="tool-success" role="status">
                <Check size={17} /> Prepared {downloaded}. Check your browser’s downloads.
              </p>
            )}
            <p className="tool-note">
              Uses the supplied BSCS cover, including its university header, footer and page border.
              You can edit the downloaded Word file.
            </p>
          </form>
        </section>
        <aside className="tool-preview-panel">
          <div className="tool-panel-heading">
            <span className="tool-step">02</span>
            <div>
              <h2>Your cover details</h2>
              <p>The downloaded file uses the original template.</p>
            </div>
          </div>
          <div className="cover-preview" aria-label="Cover details preview">
            <div className="cover-preview-university">
              <img src="/branding/szabist-horizontal.png" alt="SZABIST" />
              <span>COMPUTER SCIENCE DEPARTMENT</span>
            </div>
            <h3>{form.subjectName || 'Your subject'}</h3>
            <strong>
              {form.kind} # {form.assignmentNumber || '1'}
            </strong>
            <p>
              Last date of Submission:{' '}
              {/^\d{4}-\d{2}-\d{2}$/.test(form.submissionDate)
                ? formatCoverDate(form.submissionDate)
                : 'Choose a date'}
            </p>
            <dl>
              <dt>Submitted To</dt>
              <dd>{form.teacherName || 'Teacher name'}</dd>
              <dt>Student Name</dt>
              <dd>{form.studentName || 'Your name'}</dd>
              <dt>Reg Number</dt>
              <dd>{form.regNumber || 'Your roll number'}</dd>
            </dl>
            <footer>
              <span>
                BSCS – {form.semester || '…'}
                {form.section || '…'}
              </span>
              <span>SZABIST-ISB</span>
            </footer>
          </div>
          <p className="tool-note">
            This is a details preview. Word applies the exact layout from your provided template.
          </p>
        </aside>
      </div>
    </div>
  );
}

type CourseRow = CourseInput & { id: number };
const emptyCourse = (id: number): CourseRow => ({
  id,
  name: '',
  credits: '',
  mode: 'marks',
  marks: '',
  grade: 'A+',
});
export function CgpaPage() {
  const site = useSite();
  const [courses, setCourses] = useState<CourseRow[]>([emptyCourse(1)]);
  const [mode, setMode] = useState<'marks' | 'grade'>('marks');
  const [includePrevious, setIncludePrevious] = useState(false);
  const [previousCredits, setPreviousCredits] = useState(''),
    [previousCgpa, setPreviousCgpa] = useState('');
  const [result, setResult] = useState<ReturnType<typeof calculateGpa> | null>(null),
    [error, setError] = useState('');
  if (site.settings?.features.cgpa !== true)
    return (
      <EmptyState icon={<Calculator size={28} />} title="CGPA calculator is paused">
        The owner has turned this tool off for now.
      </EmptyState>
    );
  const invalidate = () => {
    setResult(null);
    setError('');
  };
  const update = (id: number, key: keyof CourseInput, value: string) => {
    setCourses((old) =>
      old.map((course) => (course.id === id ? { ...course, [key]: value } : course)),
    );
    invalidate();
  };
  const calculate = (event: FormEvent) => {
    event.preventDefault();
    setError('');
    try {
      setResult(
        calculateGpa(
          courses.map((course) => ({ ...course, mode })),
          includePrevious ? { credits: previousCredits, cgpa: previousCgpa } : undefined,
        ),
      );
    } catch (reason) {
      setResult(null);
      setError(errorMessage(reason));
    }
  };
  return (
    <div className="student-tool-page">
      <ToolHeading
        title="CGPA calculator"
        description="Plan your semester, one subject at a time."
        icon={Calculator}
      />
      <div className="student-tools-grid gpa-tools-grid">
        <section className="tool-panel">
          <div className="tool-panel-heading">
            <span className="tool-step">01</span>
            <div>
              <h2>This semester</h2>
              <p>Calculate from percentages or letter grades.</p>
            </div>
          </div>
          <div className="tool-segmented" role="group" aria-label="Calculation input">
            <button
              className={mode === 'marks' ? 'active' : ''}
              type="button"
              onClick={() => {
                setMode('marks');
                invalidate();
              }}
            >
              Percentage
            </button>
            <button
              className={mode === 'grade' ? 'active' : ''}
              type="button"
              onClick={() => {
                setMode('grade');
                invalidate();
              }}
            >
              Letter grade
            </button>
          </div>
          <form className="form-stack" onSubmit={calculate}>
            <div className="gpa-course-rows">
              {courses.map((course, index) => (
                <fieldset className="gpa-course" key={course.id}>
                  <legend>Subject {index + 1}</legend>
                  <div className="gpa-course-fields">
                    <label className="gpa-subject-name">
                      Subject name
                      <input
                        maxLength={80}
                        value={course.name}
                        placeholder={`Subject ${index + 1}`}
                        onChange={(e) => update(course.id, 'name', e.target.value)}
                      />
                    </label>
                    <label>
                      Credit hours
                      <input
                        required
                        inputMode="decimal"
                        type="number"
                        min={0.5}
                        max={12}
                        step={0.5}
                        value={course.credits}
                        placeholder="3"
                        onChange={(e) => update(course.id, 'credits', e.target.value)}
                      />
                    </label>
                    {mode === 'marks' ? (
                      <label>
                        Percentage
                        <input
                          required
                          inputMode="decimal"
                          type="number"
                          min={0}
                          max={100}
                          step="any"
                          value={course.marks}
                          placeholder="85"
                          onChange={(e) => update(course.id, 'marks', e.target.value)}
                        />
                      </label>
                    ) : (
                      <label>
                        Grade
                        <select
                          value={course.grade}
                          onChange={(e) => update(course.id, 'grade', e.target.value)}
                        >
                          {GRADE_SCALE.map((band) => (
                            <option key={band.grade}>{band.grade}</option>
                          ))}
                        </select>
                      </label>
                    )}
                    <button
                      type="button"
                      className="icon-button gpa-remove"
                      disabled={courses.length === 1}
                      aria-label={`Remove subject ${index + 1}`}
                      onClick={() => {
                        setCourses((old) => old.filter((item) => item.id !== course.id));
                        invalidate();
                      }}
                    >
                      <Trash2 size={17} />
                    </button>
                  </div>
                </fieldset>
              ))}
            </div>
            <button
              type="button"
              className="button button-secondary"
              disabled={courses.length >= 40}
              onClick={() => {
                setCourses((old) => [
                  ...old,
                  emptyCourse(Math.max(...old.map((item) => item.id)) + 1),
                ]);
                invalidate();
              }}
            >
              <Plus size={17} /> Add subject
            </button>
            <div className="gpa-previous">
              <label className="gpa-checkbox">
                <input
                  type="checkbox"
                  checked={includePrevious}
                  onChange={(e) => {
                    setIncludePrevious(e.target.checked);
                    invalidate();
                  }}
                />
                <span>
                  <strong>Include previous semesters</strong>
                  <small>Use your completed credit hours and current CGPA.</small>
                </span>
              </label>
              {includePrevious && (
                <div className="tool-form-row">
                  <label>
                    Previous completed credits
                    <input
                      required
                      inputMode="decimal"
                      type="number"
                      min={0}
                      max={1000}
                      step="any"
                      value={previousCredits}
                      onChange={(e) => {
                        setPreviousCredits(e.target.value);
                        invalidate();
                      }}
                    />
                  </label>
                  <label>
                    Previous CGPA
                    <input
                      required
                      inputMode="decimal"
                      type="number"
                      min={0}
                      max={4}
                      step="any"
                      value={previousCgpa}
                      onChange={(e) => {
                        setPreviousCgpa(e.target.value);
                        invalidate();
                      }}
                    />
                  </label>
                </div>
              )}
            </div>
            <ErrorNotice message={error} />
            <div className="tool-form-actions">
              <button
                type="button"
                className="button button-quiet"
                onClick={() => {
                  setCourses([emptyCourse(1)]);
                  setPreviousCredits('');
                  setPreviousCgpa('');
                  setIncludePrevious(false);
                  invalidate();
                }}
              >
                <RotateCcw size={16} /> Reset
              </button>
              <button className="button button-primary">
                <Calculator size={17} /> Calculate {includePrevious ? 'CGPA' : 'GPA'}
              </button>
            </div>
          </form>
        </section>
        <aside className="gpa-results-column">
          <section className="gpa-result-panel" aria-live="polite">
            <span className="eyebrow">YOUR SEMESTER AT A GLANCE</span>
            <span className="gpa-value">
              {result ? result.gpa.toFixed(2) : '—'}
              <small>/ 4.00</small>
            </span>
            <p>Semester GPA</p>
            <div className="gpa-result-meta">
              <div>
                <span>Credit hours</span>
                <strong>{result ? Number(result.totalCredits.toFixed(2)) : '—'}</strong>
              </div>
              <div>
                <span>{includePrevious ? 'Updated CGPA' : 'Quality points'}</span>
                <strong>
                  {result ? (includePrevious ? result.cgpa : result.totalPoints).toFixed(2) : '—'}
                </strong>
              </div>
            </div>
          </section>
          <section className="tool-panel grade-scale-panel">
            <h2>Grade scale</h2>
            <p className="tool-note">The scale from your supplied calculator.</p>
            <table className="grade-scale">
              <thead>
                <tr>
                  <th>Grade</th>
                  <th>Percentage</th>
                  <th>Points</th>
                </tr>
              </thead>
              <tbody>
                {GRADE_SCALE.map((band, index) => (
                  <tr key={band.grade}>
                    <td>
                      <span
                        className={`grade-pill grade-${index < 3 ? 'high' : index < 6 ? 'mid' : 'low'}`}
                      >
                        {band.grade}
                      </span>
                    </td>
                    <td>{index === 0 ? '90–100' : `${band.min}–<${GRADE_SCALE[index - 1].min}`}</td>
                    <td>{band.points.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </aside>
      </div>
      {result && (
        <section className="tool-panel gpa-breakdown">
          <h2>Your calculation</h2>
          <div className="tool-table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Subject</th>
                  <th>Credits</th>
                  <th>Grade</th>
                  <th>Quality points</th>
                </tr>
              </thead>
              <tbody>
                {result.courses.map((course, index) => (
                  <tr key={index}>
                    <td>{course.name}</td>
                    <td>{course.credits}</td>
                    <td>{course.grade}</td>
                    <td>{course.weightedPoints.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="tool-note">
            GPA = total quality points ÷ credit hours. Cumulative GPA weights both previous and
            current credit hours; it does not average semester GPAs equally. No grades are sent to
            the server. Repeated courses and transcript-specific adjustments are not included.
          </p>
        </section>
      )}
    </div>
  );
}
