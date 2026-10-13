# Approved Help and optional AI

Checkpoint 4 includes a working owner-managed guide without requiring a model subscription. Students can search published articles about ZabSync, the university and the developer. The owner creates drafts, adds sources and publishes reviewed information through **Master Admin → Help articles**. Only app-behavior examples are seeded; no university policies or developer biography are invented.

University articles require an HTTPS source link. The owner is responsible for checking the source and updating time-sensitive information. The app does not scrape the university site automatically, ingest private class files or expose draft articles to students. See [CHECKPOINT_4_HELP](CHECKPOINT_4_HELP.md) for the article API and workflow.

## Optional assistant design

When configured, the assistant finds up to six matching published articles locally. A bounded OpenAI Responses request selects zero to three approved article IDs. The server then supplies the published wording itself, with source links. A free-form model answer is not displayed.

This is intentionally an approved-answer assistant. A question outside the knowledge collection receives an honest no-answer response. Punctuation-only, stop-word-only and unmatched searches make no model request. Questions can be 3–1,000 characters. Students can continue ordinary guide search after their model allowance is exhausted.

Provider requests contain the question and bounded excerpts of published help. They do not include the student's email, account ID, chat history, private resources or academic records. Questions and answers are not stored as a conversation history in ZabSync. The request uses `store:false`; consult OpenAI's current data controls for the separate provider-side processing/retention terms rather than treating this flag as a universal zero-retention guarantee.

## Enable only after the free guide is useful

Set these private backend environment values, restart, and verify the integration in a separate Firebase staging environment:

```dotenv
HELP_AI_ENABLED=true
OPENAI_API_KEY=YOUR_PRIVATE_API_KEY
OPENAI_MODEL=YOUR_SUPPORTED_MODEL_ID
HELP_AI_USER_DAILY=5
HELP_AI_GLOBAL_DAILY=100
```

The model must support the Responses API and strict JSON-schema structured output. There is no hidden default model. Select a currently supported model and review its actual pricing before enabling it. API use is separate from the local guide. Never put the key in a `VITE_` variable, frontend bundle, Developer article or shared ZIP.

The defaults permit **5 requests per student/day and 100 across the app/day**, measured using Asia/Karachi dates. Both budgets are reserved together in a SQL write transaction before the provider call. A timed-out or failed attempt still counts because the provider may already have processed it. There is no automatic retry. A request has a 25-second network timeout, bounded input/response sizes and a 512-output-token ceiling. These are usage controls, not an exact monetary billing cap; also set provider budget alerts and monitor actual usage.

Master Admin can disable the Help feature immediately through App controls. Set `HELP_AI_ENABLED=false` to turn off only the optional provider integration while preserving published guide search. Maintenance blocks ordinary user mutations and assistant requests. Demo identities cannot use the paid adapter.

## Before release

Test the real chosen model, configured usage limits, ordinary and unrelated questions, timeout handling, source unpublishing during a request and the disabled state. The source ZIP's provider tests use controlled responses and have made no paid call to your account. If a provider/model cannot support the configured schema, the app returns an unavailable message and retains free guide access.

Official references: [Responses API migration and storage](https://developers.openai.com/api/docs/guides/migrate-to-responses), [structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses).
