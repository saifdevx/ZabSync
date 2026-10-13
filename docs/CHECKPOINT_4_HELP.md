# Checkpoint 4 — approved help and the optional assistant

## What students see

The **Help** page contains searchable published help articles, grouped into Using ZabSync, University information, and Developer & updates. Articles show their update date and, when supplied, the original HTTPS source link. The design uses ZabSync's own components and colors. Text is rendered as text, not executable HTML.

Seven initial articles explain existing application behavior: eligible accounts, one pinned section with multiple subjects, role permissions, subject chat modes, offline access, personal reminders, and the Developer page. These are application instructions derived from the approved project requirements. **No admissions rules, examination policy, fee amount, university timetable, campus announcement, or personal developer biography is invented.** University and Developer categories begin without factual articles until the owner supplies approved material.

Students and Class Admins cannot edit or publish help. The owner manages articles under `/admin/help`, with title, category, plain-text answer, source URL, and draft/published visibility. University articles require a complete original HTTPS source link. Drafts remain owner-only. Removing an article immediately excludes it from student and assistant retrieval. Restoring it returns it as a draft for review, even if it was published before removal.

Search is ordinary indexed/filterable SQL text retrieval, without paid embedding or search services. The content is bounded to 500 records including trash and 12,000 characters per article. A source URL is attribution, not automatic proof that an article is current: the owner must review the source before publishing policy changes. The server never fetches arbitrary source URLs as part of saving an article.

## Assistant boundary

The optional assistant has a separate capability endpoint and provider adapter. With no configured provider, it displays an unavailable state while the help library remains functional. Asking a question cannot enable the provider or set its model, key, server endpoint, prompt, or role.

The public route accepts a trimmed question of 3–1,000 characters and rejects unknown request fields. It forwards only the authenticated actor and question to the internal adapter. The adapter is responsible for selecting approved material and enforcing its configured account/global spending limits. The route accepts a bounded answer and up to 12 article IDs, re-reads those IDs as currently published/nondeleted, and returns only their approved titles/source links. If a selected source is no longer published, the response conflicts instead of including revoked material.

The root `help-assistant.ts` implementation supplies the optional model/provider and budget policy. Consult that module and its setup documentation for the exact configured limit values. Do not characterize a mock-provider test as a live OpenAI setup, and do not infer that a ChatGPT subscription supplies API credits. With paid assistance disabled, approved FAQ search continues without model usage.

The page clears its transient question/answer state across account changes and cancels obsolete client requests. Neither the articles module nor UI stores a student's question or chat history in the database. The articles module reads only `help_articles`; it never feeds student profiles, class memberships, personal files, subject conversations, or owner secrets into knowledge retrieval.

## Source/API contracts

- Schema migration 11: `helpMigration` from `server/help-migration.ts`.
- Route registration: `registerHelpRoutes(app, context, { assistant? })` from `server/help.ts`.
- Reusable retrieval: `searchPublishedHelp(db, { q?, category?, limit?, offset? })` returns `{ articles, total }` for published/nondeleted articles only.
- Student page: `HelpPage` from `client/src/HelpPage.tsx`, route `/help`.
- Owner panel: `AdminHelpPanel` from `client/src/AdminHelpPanel.tsx`, route `/admin/help` behind the owner route guard.
- Shared types: `client/src/help-types.ts`; styles: `client/src/help.css` imported at the main entry point.
- `GET /api/help?q=&category=&limit=&offset=` — published search.
- `GET /api/help/:id` — one currently published article.
- `GET /api/help/assistant-status` — assistant availability and optional remaining allowance.
- `POST /api/help/ask` — `{ question }`; requires the help feature and normal writable state.
- `GET /api/admin/help?q=&category=&status=&deleted=&limit=&offset=` — owner draft/published/trash list.
- `POST /api/admin/help` — `{ title, category, body, sourceUrl, status }`.
- `PATCH /api/admin/help/:id` — the same full form plus the current `version`.
- `DELETE /api/admin/help/:id` — `{ version }`, move to trash.
- `POST /api/admin/help/:id/restore` — `{ version }`, restore as draft.

`HelpAssistant` adapter:

```ts
interface HelpAssistant {
  status(actor: CurrentUser): Promise<{
    enabled: boolean;
    message: string;
    remainingToday?: number;
  }>;
  answer(
    actor: CurrentUser,
    question: string,
  ): Promise<{
    answer: string;
    sourceIds: string[];
    remainingToday?: number;
  }>;
}
```

The owner may continue curating drafts while the public help feature is turned off. The help feature flag closes student retrieval and questions, not the owner's editing panel. All edits re-check the authoritative owner role inside their SQL transaction and use optimistic versions to prevent silently overwriting another edit.

## Verification

The dedicated HTTP integration tests cover source requirements, malformed URLs, student/Class Admin write rejection, draft isolation, published output, stale versions, trash/restore behavior, default-disabled assistance, malformed question rejection, and feature controls. The rendered UI journey separately checks actual search/accordion and subject-chat controls against the real local API. Live cloud model and mobile browser behavior require the release configuration and real devices.
