# Front page and GPA/CGPA — Checkpoint 4

These two sidebar tools use ZabSync's own interface. The supplied `szabist-student-tools.zip` was used to recover its Word template, replacement rules and grade scale. The compiled reference site's frontend, analytics and service configuration are not included in ZabSync.

## Word front page

`client/public/templates/assignment-cover.docx` is the original template from the supplied ZIP. The form in `StudentToolsPages.tsx` calls `cover-docx.ts` with the student's entered details and downloads an ordinary `.docx` file. It does not upload the details or generated document to the server, Drive or R2.

| Form value               | Output                                                                     |
| ------------------------ | -------------------------------------------------------------------------- |
| Work type and number     | Assignment/Quiz number in the existing heading                             |
| Subject                  | Existing course-title position, with the source's length-based font sizing |
| Teacher and student name | Existing name lines in their original order                                |
| Roll number              | Existing registration-number placeholder                                   |
| Date                     | Source-style day, month name and year                                      |
| Semester and section     | Existing BSCS footer                                                       |

The source template's BSCS label, university artwork, marks fields and layout are retained. Its total-marks value is **03**; this checkpoint does not add an unrequested grading/marks editor or invent other degree templates. The generator escapes XML, validates fields and dates, removes the original author metadata from generated documents, and keeps the rest of the template package intact. It preserves the source's page-border behavior. Long subject titles use the original font-size rule rather than flowing onto an extra page in the checked samples.

The unchanged source uses floating artwork in its header. In the available LibreOffice renderer, that artwork partly overlaps the long university heading. The same placement exists in the supplied template; this checkpoint preserves it instead of redesigning the required output. Check the template in your usual Microsoft Word before release. If you want that source layout changed, provide an approved clean template or confirm the intended header arrangement in Checkpoint 5. The form and field-generation tests do not establish identical rendering across every Word/mobile office application.

`examples/Assignment-1-2412339.docx` is a generated sample with fictional student/teacher details. Automated checks compare unmodified ZIP members, required substitutions, XML escaping, date validation and file naming. Normal and long-subject examples were rendered as one page for layout review.

## GPA/CGPA

The grade bands below come from the supplied calculator code. They have **not** been independently established as the university's current official grading policy. Confirm them before presenting the result as an official academic calculation.

| Marks from | Marks below     | Grade | Grade points |
| ---------- | --------------- | ----- | ------------ |
| 90         | — (maximum 100) | A+    | 4.00         |
| 85         | 90              | A     | 3.75         |
| 80         | 85              | A−    | 3.50         |
| 75         | 80              | B+    | 3.25         |
| 70         | 75              | B     | 3.00         |
| 66         | 70              | B−    | 2.75         |
| 63         | 66              | C+    | 2.50         |
| 60         | 63              | C     | 2.00         |
| 55         | 60              | C−    | 1.50         |
| 0          | 55              | F     | 0.00         |

The reference code had gaps for decimal marks between integer bands. ZabSync applies each lower threshold continuously up to the next threshold: **89.5 is A, 3.75 points**. A blank mark is invalid; an entered zero is a valid F. Marks must be 0–100, and each course must have positive credit hours. Up to 40 courses are supported per calculation.

Semester GPA is `sum(grade points × course credits) / sum(course credits)`. Cumulative GPA is `(previous CGPA × previous credits + current quality points) / (previous credits + current credits)`. The calculation keeps precision until display. For example, a 3-credit A+ course and a 1-credit B course produce `(3×4 + 1×3)/4 = 3.75`, not the unweighted average 3.50.

The tool does not import transcripts, handle university-specific repeat/withdrawal/replacement rules, save grades to an account or submit them anywhere. Previous CGPA is only as accurate as the figure entered. A rounded previous CGPA may introduce a small difference from an official transcript computed from complete quality points.

## Offline and feature controls

The compiled public service-worker bundle includes the template. After the app shell is prepared, the form and calculator work locally within an authorized saved session. A first-ever visit without the required cached assets cannot generate a document. The app downloads and generates the Word file in the browser; whether a phone opens it immediately or saves it is controlled by that browser/operating system.

The owner can enable/disable **Front page** and **CGPA calculator** through App controls. Such switches are checked online and reflected in saved access on refresh; an already disconnected device cannot receive a new switch value instantly.
