import { useState, type FormEvent } from 'react';
import { BookOpen, ExternalLink, Pencil, Plus, RefreshCw, RotateCcw, Trash2 } from 'lucide-react';
import { errorMessage, useAuth } from './auth';
import {
  EmptyState,
  ErrorNotice,
  Modal,
  Pagination,
  Spinner,
  formatDate,
  useToast,
} from './components';
import { queryString, useApi, useDebounced } from './hooks';
import { HELP_CATEGORIES, type HelpArticle, type HelpCategory } from './help-types';

function ArticleEditor({
  article,
  onClose,
  onSaved,
}: {
  article: HelpArticle | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const auth = useAuth(),
    [title, setTitle] = useState(article?.title || ''),
    [category, setCategory] = useState<HelpCategory>(article?.category || 'app'),
    [body, setBody] = useState(article?.body || ''),
    [sourceUrl, setSourceUrl] = useState(article?.sourceUrl || ''),
    [status, setStatus] = useState<'draft' | 'published'>(article?.status || 'draft'),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await auth.request(article ? `/admin/help/${article.id}` : '/admin/help', {
        method: article ? 'PATCH' : 'POST',
        body: JSON.stringify({
          title,
          category,
          body,
          sourceUrl: sourceUrl.trim() || null,
          status,
          ...(article ? { version: article.version } : {}),
        }),
      });
      onSaved();
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={article ? 'Edit help article' : 'Add help article'}
      description="Publish only information you have checked. Drafts remain visible only to the owner."
      onClose={() => !busy && onClose()}
      wide
    >
      <form className="help-editor" onSubmit={save}>
        <label>
          Title or question
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={160}
            required
          />
        </label>
        <div className="help-editor-row">
          <label>
            Topic
            <select value={category} onChange={(e) => setCategory(e.target.value as HelpCategory)}>
              {HELP_CATEGORIES.map((item) => (
                <option value={item.value} key={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Visibility
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as 'draft' | 'published')}
            >
              <option value="draft">Draft — owner only</option>
              <option value="published">Published — signed-in users</option>
            </select>
          </label>
        </div>
        <label>
          Approved answer
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            maxLength={12000}
            rows={10}
            required
          />
          <small>
            {body.length}/12,000 characters. Plain text; no scripts, embedded pages, or invented
            details.
          </small>
        </label>
        <label>
          Original source URL {category === 'university' ? '(required)' : '(optional)'}
          <input
            type="url"
            value={sourceUrl}
            onChange={(e) => setSourceUrl(e.target.value)}
            maxLength={2000}
            required={category === 'university'}
            placeholder="https://…"
          />
          <small>
            Link to the original page. Updating a university policy? Verify its current source
            before publishing.
          </small>
        </label>
        <ErrorNotice message={error} />
        <button className="button button-primary" disabled={busy}>
          {busy ? 'Saving…' : status === 'published' ? 'Save published article' : 'Save draft'}
        </button>
      </form>
    </Modal>
  );
}

export function AdminHelpPanel() {
  const auth = useAuth(),
    toast = useToast(),
    [query, setQuery] = useState(''),
    [status, setStatus] = useState(''),
    [deleted, setDeleted] = useState(false),
    [offset, setOffset] = useState(0),
    [editing, setEditing] = useState<HelpArticle | null | undefined>(undefined),
    [removing, setRemoving] = useState<HelpArticle | null>(null),
    [busy, setBusy] = useState(''),
    [error, setError] = useState('');
  const q = useDebounced(query),
    articles = useApi<{ articles: HelpArticle[]; total: number }>(
      auth.me?.user.role === 'master'
        ? `/admin/help?${queryString({ q, status, deleted, offset, limit: 20 })}`
        : null,
    );
  async function remove() {
    if (!removing) return;
    setBusy(removing.id);
    setError('');
    try {
      await auth.request(`/admin/help/${removing.id}`, {
        method: 'DELETE',
        body: JSON.stringify({ version: removing.version }),
      });
      setRemoving(null);
      articles.reload();
      toast('Help article moved to trash.');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy('');
    }
  }
  async function restore(article: HelpArticle) {
    setBusy(article.id);
    setError('');
    try {
      await auth.request(`/admin/help/${article.id}/restore`, {
        method: 'POST',
        body: JSON.stringify({ version: article.version }),
      });
      articles.reload();
      toast('Restored as a draft for review.');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy('');
    }
  }
  if (auth.me?.user.role !== 'master')
    return (
      <EmptyState title="Owner access required">
        Only the application owner manages approved help content.
      </EmptyState>
    );
  return (
    <section className="admin-help-panel">
      <header className="help-admin-heading">
        <div>
          <span className="eyebrow">APPROVED KNOWLEDGE</span>
          <h2>Help & university information</h2>
          <p>
            Manage the articles students can read and the information available to the optional
            assistant.
          </p>
        </div>
        <button className="button button-primary" onClick={() => setEditing(null)}>
          <Plus size={16} />
          Add article
        </button>
      </header>
      <div className="help-admin-note">
        <BookOpen size={19} />
        <p>
          Only published articles reach students. University information needs an original source
          link. No university policies or personal developer biography are invented. Restoring a
          removed article brings it back as a draft.
        </p>
      </div>
      <div className="help-admin-filters">
        <input
          aria-label="Search managed help"
          placeholder="Search articles"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOffset(0);
          }}
          maxLength={160}
        />
        <select
          aria-label="Help visibility filter"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setOffset(0);
          }}
        >
          <option value="">All visibility</option>
          <option value="draft">Drafts</option>
          <option value="published">Published</option>
        </select>
        <button
          className={`button button-secondary ${deleted ? 'is-active' : ''}`}
          aria-pressed={deleted}
          onClick={() => {
            setDeleted(!deleted);
            setOffset(0);
          }}
        >
          <Trash2 size={15} />
          {deleted ? 'Viewing trash' : 'View trash'}
        </button>
        <button
          className="icon-button"
          aria-label="Refresh help articles"
          onClick={articles.reload}
        >
          <RefreshCw size={17} />
        </button>
      </div>
      <ErrorNotice message={error || articles.error} />
      {articles.loading ? (
        <Spinner label="Loading articles…" />
      ) : !articles.data?.articles.length ? (
        <EmptyState
          icon={<BookOpen />}
          title={deleted ? 'No removed articles' : 'No matching articles'}
        >
          Add approved content or change your filters.
        </EmptyState>
      ) : (
        <div className="help-admin-list">
          {articles.data.articles.map((article) => (
            <article key={article.id}>
              <header>
                <span className="eyebrow">
                  {HELP_CATEGORIES.find((item) => item.value === article.category)?.label}
                </span>
                <span
                  className={`badge ${article.status === 'published' ? 'badge-active' : 'badge-pending'}`}
                >
                  {article.status === 'published' ? 'Published' : 'Draft'}
                </span>
              </header>
              <h3>{article.title}</h3>
              <p>{article.body.length > 240 ? `${article.body.slice(0, 240)}…` : article.body}</p>
              <footer>
                <small>Updated {formatDate(article.updatedAt)}</small>
                {article.sourceUrl && (
                  <a
                    href={article.sourceUrl}
                    rel="noopener noreferrer"
                    target="_blank"
                    className="text-button"
                  >
                    Source <ExternalLink size={12} />
                  </a>
                )}
                <div className="help-admin-actions">
                  {deleted ? (
                    <button
                      className="text-button"
                      disabled={Boolean(busy)}
                      onClick={() => void restore(article)}
                    >
                      <RotateCcw size={14} />
                      Restore draft
                    </button>
                  ) : (
                    <>
                      <button className="text-button" onClick={() => setEditing(article)}>
                        <Pencil size={14} />
                        Edit
                      </button>
                      <button className="text-button danger" onClick={() => setRemoving(article)}>
                        <Trash2 size={14} />
                        Remove
                      </button>
                    </>
                  )}
                </div>
              </footer>
            </article>
          ))}
        </div>
      )}
      <Pagination
        offset={offset}
        limit={20}
        total={articles.data?.total || 0}
        onChange={setOffset}
      />
      {editing !== undefined && (
        <ArticleEditor
          article={editing}
          onClose={() => setEditing(undefined)}
          onSaved={() => {
            articles.reload();
            toast('Help article saved.');
          }}
        />
      )}
      {removing && (
        <Modal
          title="Remove this help article?"
          description="Students and the assistant will no longer receive this article. You can restore it as a draft from trash."
          onClose={() => !busy && setRemoving(null)}
        >
          <p>{removing.title}</p>
          <ErrorNotice message={error} />
          <button
            className="button button-danger"
            disabled={Boolean(busy)}
            onClick={() => void remove()}
          >
            Move to trash
          </button>
        </Modal>
      )}
    </section>
  );
}
