/** Checkpoint 4 migration 12. Counters contain no questions, answers, API keys or prompts. */
export const helpAssistantMigration = [
  `CREATE TABLE IF NOT EXISTS help_ai_usage (
    day TEXT NOT NULL, scope TEXT NOT NULL, requests INTEGER NOT NULL DEFAULT 0 CHECK(requests>=0),
    PRIMARY KEY(day,scope)
  )`,
];
