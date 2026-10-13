import JSZip from 'jszip';
import { formatCoverDate, validateCover, type CoverInput } from './student-tools';

function xmlEscape(value: string) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}
export function coverTitleSize(subject: string) {
  return subject.length <= 18 ? 72 : subject.length <= 30 ? 56 : subject.length <= 44 ? 40 : 32;
}
/** Preserve the original document's images, styles, margins, footer and relationships. */
export async function buildCoverDocx(
  template: ArrayBuffer | Uint8Array,
  raw: CoverInput,
): Promise<Uint8Array> {
  const input = validateCover(raw);
  const zip = await JSZip.loadAsync(template);
  const body = zip.file('word/document.xml'),
    footer = zip.file('word/footer1.xml');
  if (!body || !footer)
    throw new Error('The front-page template is incomplete. Reconnect and refresh the app.');
  let text = await body.async('string');
  let nameIndex = 0,
    regCount = 0,
    titleCount = 0,
    dateCount = 0;
  const names = [input.subjectName, input.teacherName, input.studentName];
  text = text
    .replace(/w:val="72"/g, `w:val="${coverTitleSize(input.subjectName)}"`)
    .replace(
      /(<w:t\b[^>]*>)([\s\S]*?)(<\/w:t>)/g,
      (_all, start: string, content: string, end: string) => {
        let replacement = content;
        if (content === 'Name') replacement = xmlEscape(names[nameIndex++] ?? '');
        else if (content === '00000') {
          replacement = xmlEscape(input.regNumber);
          regCount++;
        } else if (content.startsWith('Assignment #')) {
          replacement = `${input.kind} # ${input.assignmentNumber} `;
          titleCount++;
        } else if (content.startsWith('Last date of Submission:')) {
          replacement = `Last date of Submission: ${formatCoverDate(input.submissionDate)}`;
          dateCount++;
        }
        return start + replacement + end;
      },
    );
  if (nameIndex !== 3 || regCount !== 1 || titleCount !== 1 || dateCount !== 1)
    throw new Error('The cover template changed. Ask the owner to update its field mappings.');
  if (!text.includes('<w:pgBorders')) {
    const borders = `<w:pgBorders w:offsetFrom="page">${['top', 'left', 'bottom', 'right'].map((edge) => `<w:${edge} w:val="single" w:sz="12" w:space="16" w:color="000000"/>`).join('')}</w:pgBorders>`;
    text = text.replace(/(<w:pgMar\b[^>]*\/>)/, `$1${borders}`);
  }
  let footerNames = 0,
    footerClasses = 0;
  const footerXml = (await footer.async('string')).replace(
    /(<w:t\b[^>]*>)([\s\S]*?)(<\/w:t>)/g,
    (_all, start: string, content: string, end: string) => {
      let replacement = content;
      if (content === 'Name') {
        replacement = xmlEscape(
          input.subjectName.length > 36 ? `${input.subjectName.slice(0, 35)}…` : input.subjectName,
        );
        footerNames++;
      } else if (content.startsWith('BSCS')) {
        replacement = `BSCS – ${input.semester}${input.section}`;
        footerClasses++;
      }
      return start + replacement + end;
    },
  );
  if (footerNames !== 1 || footerClasses !== 1)
    throw new Error('The cover footer fields could not be found.');
  zip.file('word/document.xml', text);
  zip.file('word/footer1.xml', footerXml);
  const core = zip.file('docProps/core.xml');
  if (core)
    zip.file(
      'docProps/core.xml',
      (await core.async('string')).replace(
        /(<(?:dc:creator|cp:lastModifiedBy)\b[^>]*>)[\s\S]*?(<\/(?:dc:creator|cp:lastModifiedBy)>)/g,
        '$1$2',
      ),
    );
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
