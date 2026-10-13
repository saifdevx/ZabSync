import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  BookOpen,
  ChevronDown,
  ExternalLink,
  LifeBuoy,
  Search,
  Send,
  Sparkles,
} from 'lucide-react';
import { errorMessage, useAuth } from './auth';
import { EmptyState, ErrorNotice, Modal, Pagination, Spinner, formatDate } from './components';
import { queryString, useApi, useDebounced } from './hooks';
import { useSite } from './site';
import { HELP_CATEGORIES, type HelpArticle, type HelpCategory } from './help-types';

interface AssistantStatus {
  enabled: boolean;
  message: string;
  remainingToday?: number;
}
interface AssistantAnswer {
  answer: string;
  sources: { id: string; title: string; sourceUrl: string | null }[];
  remainingToday?: number;
}

function ArticleBody({ article }: { article: HelpArticle }) {
  return (
    <div className="help-article-body">
      <p>{article.body}</p>
      <div className="help-article-meta">
        <span>Updated {formatDate(article.updatedAt)}</span>
        {article.sourceUrl && (
          <a href={article.sourceUrl} target="_blank" rel="noopener noreferrer">
            View original source <ExternalLink size={13} />
          </a>
        )}
      </div>
    </div>
  );
}
function SourceArticle({ id, onClose }: { id: string; onClose: () => void }) {
  const article = useApi<{ article: HelpArticle }>(`/help/${id}`);
  return (
    <Modal title={article.data?.article.title || 'Approved source'} onClose={onClose}>
      {article.loading ? (
        <Spinner />
      ) : article.error ? (
        <ErrorNotice message={article.error} />
      ) : (
        article.data && <ArticleBody article={article.data.article} />
      )}
    </Modal>
  );
}

export function HelpPage() {
  const auth = useAuth(),
    site = useSite(),
    [query, setQuery] = useState(''),
    [category, setCategory] = useState<HelpCategory | ''>(''),
    [offset, setOffset] = useState(0);
  const [question, setQuestion] = useState(''),
    [answer, setAnswer] = useState<AssistantAnswer | null>(null),
    [askedQuestion, setAskedQuestion] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [sourceId, setSourceId] = useState('');
  const search = useDebounced(query),
    enabled = site.settings?.features.help !== false,
    online = !auth.offline;
  const articles = useApi<{ articles: HelpArticle[]; total: number }>(
    enabled && online ? `/help?${queryString({ q: search, category, offset, limit: 20 })}` : null,
  );
  const assistant = useApi<AssistantStatus>(enabled && online ? '/help/assistant-status' : null),
    pending = useRef<AbortController | null>(null);
  useEffect(() => setOffset(0), [search, category]);
  useEffect(() => {
    setAnswer(null);
    setQuestion('');
    setAskedQuestion('');
    setSourceId('');
    setError('');
    return () => pending.current?.abort();
  }, [auth.me?.user.id, online]);
  async function ask(e: FormEvent) {
    e.preventDefault();
    if (busy || question.trim().length < 3 || question.trim().length > 1000) return;
    const controller = new AbortController();
    pending.current?.abort();
    pending.current = controller;
    setBusy(true);
    setError('');
    setAnswer(null);
    const current = question.trim();
    try {
      const result = await auth.request<AssistantAnswer>('/help/ask', {
        method: 'POST',
        body: JSON.stringify({ question: current }),
        signal: controller.signal,
      });
      if (!controller.signal.aborted) {
        setAnswer(result);
        setAskedQuestion(current);
        assistant.reload();
      }
    } catch (e) {
      if (!controller.signal.aborted) setError(errorMessage(e));
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  if (!enabled)
    return (
      <EmptyState icon={<LifeBuoy />} title="Help is temporarily paused">
        Please check back when the owner makes this feature available.
      </EmptyState>
    );
  return (
    <div className="help-page">
      <header className="help-hero">
        <div className="help-hero-icon">
          <LifeBuoy size={26} />
        </div>
        <div>
          <span className="eyebrow">A LITTLE GUIDANCE</span>
          <h1>How can we help?</h1>
          <p>
            Find your way around ZabSync and browse approved university information, all in one
            place.
          </p>
        </div>
      </header>
      {!online ? (
        <div className="panel">
          <EmptyState icon={<BookOpen />} title="Reconnect to search help">
            Help uses the latest published information. Your saved timetable and downloaded files
            remain available in their offline views.
          </EmptyState>
        </div>
      ) : (
        <>
          <section className="help-assistant" aria-label="Approved knowledge assistant">
            <div className="help-assistant-heading">
              <span>
                <Sparkles size={19} />
              </span>
              <div>
                <h2>ZabSync assistant</h2>
                <p>
                  Questions about the university, this app, or its developer. Answers use the
                  information approved for ZabSync.
                </p>
              </div>
            </div>
            {assistant.loading ? (
              <small>Checking availability…</small>
            ) : assistant.data?.enabled ? (
              <form onSubmit={ask}>
                <label htmlFor="help-question">Your question</label>
                <textarea
                  id="help-question"
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  minLength={3}
                  maxLength={1000}
                  rows={3}
                  placeholder="For example: How do I join my subjects?"
                  disabled={busy}
                />
                <div className="help-ask-controls">
                  <small>
                    {assistant.data.remainingToday !== undefined
                      ? `${assistant.data.remainingToday} questions available today`
                      : 'Keep questions focused on ZabSync and approved university information.'}
                  </small>
                  <button
                    className="button button-primary"
                    disabled={
                      busy || question.trim().length < 3 || site.settings?.maintenance.enabled
                    }
                  >
                    <Send size={15} />
                    {busy ? 'Checking approved information…' : 'Ask'}
                  </button>
                </div>
              </form>
            ) : (
              <p className="help-assistant-status">
                {assistant.data?.message ||
                  'The assistant is unavailable right now. You can still browse the help articles below.'}
              </p>
            )}
            <ErrorNotice message={error || assistant.error} />
            {answer && (
              <div className="help-answer" aria-live="polite">
                <strong>{askedQuestion}</strong>
                <p>{answer.answer}</p>
                {answer.sources.length > 0 && (
                  <div className="help-answer-sources">
                    <span>Approved sources</span>
                    {answer.sources.map((source) => (
                      <button
                        key={source.id}
                        className="text-button"
                        onClick={() => setSourceId(source.id)}
                      >
                        {source.title}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </section>
          <section className="help-library" aria-label="Published help articles">
            <header>
              <h2>
                <BookOpen size={20} /> Browse help
              </h2>
              <label className="help-search">
                <Search size={18} />
                <input
                  aria-label="Search help"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  maxLength={160}
                  placeholder="Search by topic or keyword"
                />
              </label>
            </header>
            <div className="help-category-tabs" role="group" aria-label="Help categories">
              <button className={!category ? 'active' : ''} onClick={() => setCategory('')}>
                All topics
              </button>
              {HELP_CATEGORIES.map((item) => (
                <button
                  key={item.value}
                  className={category === item.value ? 'active' : ''}
                  onClick={() => setCategory(item.value)}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <ErrorNotice message={articles.error} retry={articles.reload} />
            {articles.loading ? (
              <Spinner label="Finding help…" />
            ) : !articles.data?.articles.length ? (
              <EmptyState icon={<Search />} title="No published information found">
                Try a shorter keyword or another topic. University policies and developer
                information appear here after the owner adds and publishes them.
              </EmptyState>
            ) : (
              <div className="help-articles">
                {articles.data.articles.map((article) => (
                  <details key={article.id} className="help-article">
                    <summary>
                      <div>
                        <span className="eyebrow">
                          {HELP_CATEGORIES.find((item) => item.value === article.category)?.label}
                        </span>
                        <h3>{article.title}</h3>
                      </div>
                      <ChevronDown size={19} />
                    </summary>
                    <ArticleBody article={article} />
                  </details>
                ))}
              </div>
            )}
            <Pagination
              offset={offset}
              limit={20}
              total={articles.data?.total || 0}
              onChange={setOffset}
            />
          </section>
        </>
      )}
      {sourceId && <SourceArticle id={sourceId} onClose={() => setSourceId('')} />}
    </div>
  );
}
