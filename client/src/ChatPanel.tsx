import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import {
  Flag,
  LockKeyhole,
  MessageCircle,
  Paperclip,
  Pencil,
  RefreshCw,
  Send,
  ShieldCheck,
  Trash2,
  VolumeX,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { errorMessage, useAuth } from './auth';
import { EmptyState, ErrorNotice, Modal, Spinner, formatDate, useToast } from './components';
import { useApi } from './hooks';
import { useSite } from './site';

interface ChatMessage {
  id: string;
  userId: string;
  authorName: string;
  body: string;
  resourceId: string | null;
  resourceTitle: string | null;
  resourceUnavailable: boolean;
  createdAt: string;
  updatedAt: string;
  deleted: boolean;
  version: number;
  canEdit: boolean;
  canDelete: boolean;
  canMute: boolean;
  reportCount: number;
  mutedUntil: string | null;
}
interface ChatData {
  messages: ChatMessage[];
  nextCursor: string | null;
  settings: {
    mode: 'members' | 'admins';
    version: number;
    canManage: boolean;
    canPost: boolean;
    mutedUntil: string | null;
  };
  limits: { maxCharacters: number; maxMessages: number };
  serverTime: string;
}
interface Report {
  messageId: string;
  reason: string;
  createdAt: string;
  reporterName: string;
  body: string;
}

function ReportList({ subjectId, onChanged }: { subjectId: string; onChanged: () => void }) {
  const auth = useAuth(),
    data = useApi<{ reports: Report[] }>(`/subjects/${subjectId}/chat/reports`),
    [error, setError] = useState(''),
    [busy, setBusy] = useState('');
  async function resolve(messageId: string) {
    setBusy(messageId);
    setError('');
    try {
      await auth.request(`/subjects/${subjectId}/chat/messages/${messageId}/resolve-reports`, {
        method: 'POST',
      });
      data.reload();
      onChanged();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy('');
    }
  }
  return (
    <div className="chat-reports">
      <ErrorNotice message={error || data.error} />
      {data.loading ? (
        <Spinner label="Loading reports…" />
      ) : !data.data?.reports.length ? (
        <p>No open reports.</p>
      ) : (
        data.data.reports.map((r, index) => (
          <article className="chat-report" key={`${r.messageId}-${index}`}>
            <p className="chat-quote">{r.body || 'Removed message'}</p>
            <p>
              <strong>{r.reporterName}:</strong> {r.reason}
            </p>
            <small>{formatDate(r.createdAt, true)}</small>
            <button
              className="text-button"
              disabled={Boolean(busy)}
              onClick={() => void resolve(r.messageId)}
            >
              {busy === r.messageId ? 'Saving…' : 'Mark reviewed'}
            </button>
          </article>
        ))
      )}
    </div>
  );
}

/** Conversations are fetched only while this subject panel is visible and the browser is online. */
export function ChatPanel({ subjectId }: { subjectId: string }) {
  const auth = useAuth(),
    site = useSite(),
    toast = useToast();
  const [data, setData] = useState<ChatData | null>(null),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false);
  const [body, setBody] = useState(''),
    [resourceId, setResourceId] = useState(''),
    [older, setOlder] = useState<ChatMessage[]>([]),
    [olderCursor, setOlderCursor] = useState<string | null | undefined>(undefined);
  const [editing, setEditing] = useState<ChatMessage | null>(null),
    [editBody, setEditBody] = useState('');
  const [deleting, setDeleting] = useState<ChatMessage | null>(null),
    [reporting, setReporting] = useState<ChatMessage | null>(null),
    [reportReason, setReportReason] = useState('');
  const [muting, setMuting] = useState<ChatMessage | null>(null),
    [muteMinutes, setMuteMinutes] = useState(1440),
    [showReports, setShowReports] = useState(false);
  const [networkOnline, setNetworkOnline] = useState(
    typeof navigator === 'undefined' || navigator.onLine,
  );
  const pendingSend = useRef<{ body: string; resourceId: string; key: string } | null>(null);
  const generation = useRef(0),
    pendingRequest = useRef<AbortController | null>(null);
  const online = !auth.offline && networkOnline,
    enabled = site.settings?.features.chat !== false;
  const canWrite =
    online && (!site.settings?.maintenance.enabled || auth.me?.user.role === 'master');
  const resources = useApi<{ resources: { id: string; title: string }[] }>(
    online && enabled && data?.settings.canPost && site.settings?.features.resources !== false
      ? `/resources?subjectId=${subjectId}&limit=100`
      : null,
  );

  useEffect(() => {
    const update = () => setNetworkOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  const refresh = useCallback(async () => {
    if (!online || !enabled || document.visibilityState === 'hidden') return;
    pendingRequest.current?.abort();
    const controller = new AbortController();
    pendingRequest.current = controller;
    const stamp = generation.current;
    try {
      const result = await auth.request<ChatData>(`/subjects/${subjectId}/chat`, {
        signal: controller.signal,
      });
      if (!controller.signal.aborted && generation.current === stamp) {
        setData(result);
        setError('');
      }
    } catch (e) {
      if (!controller.signal.aborted && generation.current === stamp) {
        setError(errorMessage(e));
        setData(null);
        setOlder([]);
      }
    } finally {
      if (!controller.signal.aborted && generation.current === stamp) setLoading(false);
    }
  }, [auth.request, subjectId, online, enabled]);
  useEffect(() => {
    generation.current++;
    setData(null);
    setOlder([]);
    setOlderCursor(undefined);
    setBody('');
    setResourceId('');
    setEditing(null);
    setDeleting(null);
    setReporting(null);
    setMuting(null);
    setShowReports(false);
    setError('');
    setLoading(online && enabled);
    pendingSend.current = null;
    let stopped = false,
      timer: ReturnType<typeof setTimeout> | undefined;
    async function poll() {
      await refresh();
      if (!stopped) timer = setTimeout(poll, 30_000);
    }
    void poll();
    const visible = () => {
      if (document.visibilityState !== 'hidden') void refresh();
    };
    document.addEventListener('visibilitychange', visible);
    return () => {
      stopped = true;
      generation.current++;
      if (timer) clearTimeout(timer);
      pendingRequest.current?.abort();
      document.removeEventListener('visibilitychange', visible);
    };
  }, [refresh, auth.me?.user.id, online, enabled]);

  async function action(path: string, method: 'POST' | 'PATCH' | 'DELETE', payload?: unknown) {
    setBusy(true);
    setError('');
    try {
      await auth.request(path, {
        method,
        ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
      });
      await refresh();
      return true;
    } catch (e) {
      setError(errorMessage(e));
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function send(e: FormEvent) {
    e.preventDefault();
    const text = body.trim();
    if (!text || !data?.settings.canPost || !canWrite || busy) return;
    const old = pendingSend.current,
      key = old?.body === text && old?.resourceId === resourceId ? old.key : crypto.randomUUID();
    pendingSend.current = { body: text, resourceId, key };
    if (
      await action(`/subjects/${subjectId}/chat/messages`, 'POST', {
        body: text,
        resourceId: resourceId || null,
        clientKey: key,
      })
    ) {
      setBody('');
      setResourceId('');
      pendingSend.current = null;
    }
  }
  async function loadOlder() {
    const before = olderCursor === undefined ? data?.nextCursor : olderCursor;
    if (!before) return;
    setBusy(true);
    setError('');
    const stamp = generation.current;
    try {
      const next = await auth.request<ChatData>(
        `/subjects/${subjectId}/chat?before=${encodeURIComponent(before)}`,
      );
      if (stamp === generation.current) {
        setOlder((list) => [...next.messages, ...list]);
        setOlderCursor(next.nextCursor);
      }
    } catch (e) {
      if (stamp === generation.current) setError(errorMessage(e));
    } finally {
      if (stamp === generation.current) setBusy(false);
    }
  }
  if (!enabled)
    return (
      <EmptyState icon={<MessageCircle />} title="Conversation is paused">
        The owner has turned subject chat off.
      </EmptyState>
    );
  if (!online)
    return (
      <div className="panel chat-offline">
        <LockKeyhole size={22} />
        <h3>Reconnect for the conversation</h3>
        <p>
          Chat is available online. Your saved timetable and downloaded resources remain in their
          offline sections.
        </p>
      </div>
    );
  if (loading) return <Spinner label="Opening subject conversation…" />;
  if (!data)
    return (
      <ErrorNotice message={error || 'Conversation unavailable.'} retry={() => void refresh()} />
    );
  const messages = [
    ...new Map([...older, ...data.messages].map((item) => [item.id, item])).values(),
  ].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  return (
    <section className="chat-panel" aria-label="Subject conversation">
      <header className="chat-header">
        <div className="chat-heading">
          <span className="chat-symbol">
            <MessageCircle size={22} />
          </span>
          <div>
            <h3>Subject conversation</h3>
            <p>
              {data.settings.mode === 'members'
                ? 'Ask a question. Help a classmate.'
                : 'Updates from your class admins.'}
            </p>
          </div>
        </div>
        <button
          className="icon-button"
          title="Refresh conversation"
          aria-label="Refresh conversation"
          onClick={() => void refresh()}
          disabled={busy}
        >
          <RefreshCw size={18} />
        </button>
      </header>
      <div className="chat-scope">
        <ShieldCheck size={15} />
        <span>Only approved members of this subject can read this chat.</span>
      </div>
      {data.settings.canManage && (
        <div className="chat-settings">
          <label htmlFor={`chat-mode-${subjectId}`}>Who can post?</label>
          <select
            id={`chat-mode-${subjectId}`}
            value={data.settings.mode}
            disabled={busy || !canWrite}
            onChange={(e) =>
              void action(`/subjects/${subjectId}/chat/settings`, 'PATCH', {
                mode: e.target.value,
                version: data.settings.version,
              })
            }
          >
            <option value="admins">Class admins only</option>
            <option value="members">All subject members</option>
          </select>
          <button className="text-button" onClick={() => setShowReports(true)}>
            Review reports
          </button>
        </div>
      )}
      <ErrorNotice message={error} />
      {(olderCursor === undefined ? data.nextCursor : olderCursor) && (
        <button className="text-button chat-older" disabled={busy} onClick={() => void loadOlder()}>
          Load earlier messages
        </button>
      )}
      <div className="chat-thread" aria-label="Messages">
        {!messages.length ? (
          <EmptyState icon={<MessageCircle />} title="A space for your subject">
            {data.settings.canPost
              ? 'Ask about a lecture, resource, or upcoming quiz.'
              : 'Your class admin can post updates here or open the conversation to members.'}
          </EmptyState>
        ) : (
          messages.map((message) => (
            <article
              className={`chat-message ${message.userId === auth.me?.user.id ? 'chat-own' : ''} ${message.deleted ? 'chat-deleted' : ''}`}
              key={message.id}
            >
              <header>
                <strong>{message.authorName}</strong>
                <time dateTime={message.createdAt}>{formatDate(message.createdAt, true)}</time>
                {message.version > 1 && !message.deleted && <small>Edited</small>}
              </header>
              {message.resourceId && (
                <Link
                  className="chat-resource"
                  to={`/subjects/${subjectId}?tab=resources&resource=${message.resourceId}`}
                >
                  <Paperclip size={14} />
                  {message.resourceTitle}
                </Link>
              )}
              {message.resourceUnavailable && (
                <span className="chat-resource">Referenced resource is no longer available.</span>
              )}
              <p>{message.deleted ? 'Message removed' : message.body}</p>
              {!message.deleted && (
                <div className="chat-message-actions">
                  {message.canEdit && data.settings.canPost && (
                    <button
                      className="text-button"
                      disabled={busy || !canWrite}
                      onClick={() => {
                        setEditing(message);
                        setEditBody(message.body);
                      }}
                    >
                      <Pencil size={13} />
                      Edit
                    </button>
                  )}
                  {message.canDelete && (
                    <button
                      className="text-button"
                      disabled={busy || !canWrite}
                      onClick={() => setDeleting(message)}
                    >
                      <Trash2 size={13} />
                      Remove
                    </button>
                  )}
                  {message.userId !== auth.me?.user.id && (
                    <button
                      className="text-button"
                      disabled={busy || !canWrite}
                      onClick={() => {
                        setReporting(message);
                        setReportReason('');
                      }}
                    >
                      <Flag size={13} />
                      Report
                    </button>
                  )}
                  {message.canMute && (
                    <button
                      className="text-button"
                      disabled={busy || !canWrite}
                      onClick={() => {
                        setMuting(message);
                        setMuteMinutes(
                          message.mutedUntil && message.mutedUntil > data.serverTime ? 0 : 1440,
                        );
                      }}
                    >
                      <VolumeX size={13} />
                      {message.mutedUntil && message.mutedUntil > data.serverTime
                        ? 'Unmute'
                        : 'Pause posting'}
                    </button>
                  )}
                  {data.settings.canManage && message.reportCount > 0 && (
                    <span className="badge">
                      {message.reportCount} report{message.reportCount === 1 ? '' : 's'}
                    </span>
                  )}
                </div>
              )}
            </article>
          ))
        )}
      </div>
      {data.settings.canPost ? (
        <form className="chat-composer" onSubmit={send}>
          <label htmlFor={`chat-body-${subjectId}`}>Message your subject</label>
          <textarea
            id={`chat-body-${subjectId}`}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            maxLength={data.limits.maxCharacters}
            rows={3}
            placeholder="For example: Which lectures are included in the quiz?"
            disabled={busy || !canWrite}
          />
          <div className="chat-compose-controls">
            <label>
              <span className="sr-only">Reference a resource</span>
              <select
                aria-label="Reference a resource"
                value={resourceId}
                onChange={(e) => setResourceId(e.target.value)}
                disabled={busy || !canWrite}
              >
                <option value="">No resource reference</option>
                {resources.data?.resources.map((resource) => (
                  <option value={resource.id} key={resource.id}>
                    {resource.title}
                  </option>
                ))}
              </select>
            </label>
            <small>
              {body.length}/{data.limits.maxCharacters}
            </small>
            <button
              className="button button-primary"
              type="submit"
              disabled={!body.trim() || busy || !canWrite}
            >
              <Send size={16} />
              {busy ? 'Sending…' : 'Send'}
            </button>
          </div>
          {!canWrite && <p className="muted">Changes are paused during maintenance.</p>}
        </form>
      ) : (
        <div className="chat-readonly">
          <LockKeyhole size={18} />
          <p>
            {data.settings.mutedUntil
              ? `Your posting is paused until ${formatDate(data.settings.mutedUntil, true)}. You can still read updates.`
              : 'Your class admin has chosen admin-only posting. You can read all updates here.'}
          </p>
        </div>
      )}
      <p className="chat-refresh-note">
        Checks for new messages every 30 seconds while this page is visible. Text chat is online
        only.
      </p>
      {editing && (
        <Modal title="Edit your message" onClose={() => !busy && setEditing(null)}>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (
                await action(`/subjects/${subjectId}/chat/messages/${editing.id}`, 'PATCH', {
                  body: editBody,
                  version: editing.version,
                })
              )
                setEditing(null);
            }}
          >
            <label>
              Message
              <textarea
                value={editBody}
                onChange={(e) => setEditBody(e.target.value)}
                maxLength={2000}
                rows={5}
                required
              />
            </label>
            <ErrorNotice message={error} />
            <button className="button button-primary" disabled={busy || !editBody.trim()}>
              Save message
            </button>
          </form>
        </Modal>
      )}
      {deleting && (
        <Modal
          title="Remove this message?"
          description="Its text will be removed from the conversation. A small removal marker stays in the thread."
          onClose={() => !busy && setDeleting(null)}
        >
          <ErrorNotice message={error} />
          <button
            className="button button-danger"
            disabled={busy}
            onClick={async () => {
              if (
                await action(`/subjects/${subjectId}/chat/messages/${deleting.id}`, 'DELETE', {
                  version: deleting.version,
                })
              )
                setDeleting(null);
            }}
          >
            Remove message
          </button>
        </Modal>
      )}
      {reporting && (
        <Modal
          title="Report a message"
          description="Your class admins can review the reason. Use this for a message that needs moderation."
          onClose={() => !busy && setReporting(null)}
        >
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (
                await action(
                  `/subjects/${subjectId}/chat/messages/${reporting.id}/report`,
                  'POST',
                  { reason: reportReason },
                )
              ) {
                setReporting(null);
                toast('Report sent to your class admins.');
              }
            }}
          >
            <label>
              Reason
              <textarea
                rows={4}
                value={reportReason}
                onChange={(e) => setReportReason(e.target.value)}
                maxLength={500}
                required
              />
            </label>
            <ErrorNotice message={error} />
            <button className="button button-primary" disabled={busy || !reportReason.trim()}>
              Send report
            </button>
          </form>
        </Modal>
      )}
      {muting && (
        <Modal
          title={`Posting permissions: ${muting.authorName}`}
          description="Pausing posting affects this subject only. The member can still read the conversation. Class admins cannot be muted."
          onClose={() => !busy && setMuting(null)}
        >
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (
                await action(
                  `/subjects/${subjectId}/chat/mutes/${encodeURIComponent(muting.userId)}`,
                  'POST',
                  { minutes: muteMinutes, reason: 'Changed from subject moderation.' },
                )
              )
                setMuting(null);
            }}
          >
            <label>
              Pause length
              <select value={muteMinutes} onChange={(e) => setMuteMinutes(Number(e.target.value))}>
                <option value={0}>Allow posting again</option>
                <option value={60}>One hour</option>
                <option value={1440}>One day</option>
                <option value={10080}>One week</option>
              </select>
            </label>
            <ErrorNotice message={error} />
            <button className="button button-primary" disabled={busy}>
              Save permissions
            </button>
          </form>
        </Modal>
      )}
      {showReports && (
        <Modal title="Conversation reports" onClose={() => setShowReports(false)}>
          <ReportList subjectId={subjectId} onChanged={() => void refresh()} />
        </Modal>
      )}
    </section>
  );
}
