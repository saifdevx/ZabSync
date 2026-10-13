# Checkpoint 4 — cost and scaling plan

**Planning date: 12 October 2026. Currency: USD.** These are budgets, not provider quotes or a guarantee that 1,000 users fit a given server. Taxes, exchange rates, domains, backup destinations, Android publication and optional AI are separate. Check dashboards before paying or enabling overages.

## Services and allowances

| Service                 | Starting choice                                                                                                                                                                                                                                        | What can increase spending                                                                 |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| Render web/API          | Free evaluation; `0.5c-512mb` (legacy Starter) reference $7/month; `1c-2g` (legacy Standard) reference $25/month. [Pricing](https://render.com/pricing).                                                                                               | Compute, outbound downloads, additional workers/cron and builds. Confirm live prices.      |
| Turso/libSQL            | Free: 5 GB, 500 million rows read and 10 million written monthly. [Pricing](https://turso.tech/pricing).                                                                                                                                               | Storage, row activity, retention and enabled overages. Paid prices depend on billing term. |
| Firebase Authentication | Email/social sign-in fits the no-cost range here. Identity Platform Spark allows 3,000 daily active users; Blaze includes 50,000 monthly active users for these providers. [Official limits](https://firebase.google.com/docs/auth#identity-platform). | Other providers, SMS, higher usage or additional Firebase products. No SMS is needed.      |
| R2 Standard             | Free: 10 GB-month, one million Class A and ten million Class B operations/month. Extra storage $0.015/GB-month. [Pricing](https://developers.cloudflare.com/r2/pricing/).                                                                              | Storage/operations above allowances; other storage classes have different terms.           |
| Google Drive            | Resource originals consume the uploader's account storage. [Storage guide](GOOGLE_DRIVE_STORAGE.md).                                                                                                                                                   | Their storage plan, API quotas/download limits and account continuity.                     |
| Help/AI                 | Approved help search has no model charge. Start with paid AI disabled.                                                                                                                                                                                 | A separate model API; apply account/global limits and provider alerts.                     |

Render Free sleeps when idle and loses filesystem changes on restarts. Use remote SQL/R2 for hosted evaluation; dependable reminders require an always-running service. [Free-service limitations](https://render.com/docs/free).

Render renamed compute plans in August 2026 without changing the corresponding prices; legacy names remain supported. See [current compute names](https://render.com/docs/compute-plans). A workspace plan and its individual compute service are separate billable concepts.

## Monthly budgets to plan around

| Scenario                      | Allowance                       | Assumptions                                                                                                        |
| ----------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Local development             | **$0 infrastructure**           | Existing computer/internet, demo mode.                                                                             |
| Hosted evaluation             | **$0 within allowances**        | Light traffic, tolerated cold starts, no timely-reminder promise.                                                  |
| First 50 students             | **$7–15 plus variable usage**   | One small paid service; auth/SQL/R2 within free allowances; low downloads; AI off.                                 |
| Toward 1,000 registered users | **$25–70+ plus variable usage** | Larger web service if measured, possible database/worker/backup allowance; limited simultaneous chat/file traffic. |

The last row is a budget to validate, not tested capacity. Registered accounts and simultaneous video downloaders are different workloads.

**Downloads may dominate cost.** For example, 1,000 students downloading twenty 10 MB documents monthly generate approximately **200 GB of outbound file traffic**, before retries, pages and videos. Both Drive and R2 downloads pass through Render for authorization. Free R2 egress does not remove the host's own bandwidth meter. Explicit offline copies reduce repeat downloads.

The app's base-store ceiling is 8 GiB, below R2's 10 GB allowance, with durable reservations. It is not a provider billing cap: untracked objects, separate backups and operations still count. The owner usage view measures tracked application objects. At 50 GB-month of R2 Standard storage, storage above the free allowance is approximately **$0.60/month**, before operations and rounding.

## Grow from measurements

Start with one paid Node service, nearby remote libSQL, R2 images and Drive resources. Keep pagination and quotas. Chat polls every 30 seconds while visible: 100 concurrently open chats already mean approximately 12,000 polls/hour before other requests. Watch database reads and mobile network use.

Review response times/errors, memory, upload temporary disk, provider quotas, storage growth, reminder backlog and backups. Investigate at roughly 70–80% sustained quota use. Increase compute when measured; optimize hot queries and polling before adding processes. Multiple instances also need shared rate-limit, connection-pool and worker review. Chat/reminder SQL controls are shared, but not every HTTP limiter is distributed.

Before campus-wide rollout, test representative concurrent reads, uploads, downloads, chat and reminders in staging. Establish acceptable latency and recovery behavior before raising caps. Review bills monthly and rehearse restoration. Preserve Drive ownership during representative changes: buying server capacity cannot recover a deleted personal file.
