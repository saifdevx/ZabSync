import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  ChevronRight,
  Copy,
  LoaderCircle,
  Plus,
  Users,
  X,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import type { ClassFields, ClassSummary, RequestStatus } from './types';
import { useAuth } from './auth';

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="loading-state" role="status">
      <LoaderCircle className="spin" size={26} />
      <span>{label}</span>
    </div>
  );
}
export function ErrorNotice({ message, retry }: { message: string; retry?: () => void }) {
  if (!message) return null;
  return (
    <div className="error-notice" role="alert">
      <AlertCircle size={18} />
      <div>
        <p>{message}</p>
        {retry && (
          <button className="text-button" onClick={retry}>
            Try again
          </button>
        )}
      </div>
    </div>
  );
}
export function EmptyState({
  icon,
  title,
  children,
  action,
}: {
  icon?: ReactNode;
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="empty-icon">{icon ?? <Users size={28} />}</div>
      <h3>{title}</h3>
      <p>{children}</p>
      {action}
    </div>
  );
}
export function RoleBadge({ role }: { role: string }) {
  const labels: Record<string, string> = {
    master: 'Master Admin',
    cr: 'Class representative',
    gr: 'Group representative',
    student: 'Student',
    pending: 'Pending approval',
    approved: 'Approved',
    rejected: 'Not approved',
    active: 'Active',
    removed: 'Membership ended',
  };
  return <span className={`badge badge-${role}`}>{labels[role] ?? role}</span>;
}
export function StatusBadge({ status }: { status: RequestStatus }) {
  return <RoleBadge role={status} />;
}
export function Avatar({
  name,
  size = 'normal',
  userId,
  avatarVersion,
}: {
  name: string;
  size?: 'small' | 'normal' | 'large';
  userId?: string;
  avatarVersion?: string | null;
}) {
  const auth = useAuth();
  const key = `${auth.me?.user.id ?? ''}:${userId ?? ''}:${avatarVersion ?? ''}`;
  const [picture, setPicture] = useState<{ key: string; url: string } | null>(null);
  useEffect(() => {
    let active = true;
    let objectUrl = '';
    const controller = new AbortController();
    if (userId && avatarVersion) {
      auth
        .requestBlob(
          `/users/${encodeURIComponent(userId)}/avatar?v=${encodeURIComponent(avatarVersion)}`,
          { signal: controller.signal },
        )
        .then((blob) => {
          if (!active) return;
          objectUrl = URL.createObjectURL(blob);
          setPicture({ key, url: objectUrl });
        })
        .catch(() => {
          if (active) setPicture(null);
        });
    } else setPicture(null);
    return () => {
      active = false;
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [auth.requestBlob, userId, avatarVersion, key]);
  return (
    <span className={`avatar avatar-${size}`} aria-hidden="true">
      {picture?.key === key ? (
        <img src={picture.url} alt="" onError={() => setPicture(null)} />
      ) : (
        name
          .trim()
          .split(/\s+/)
          .slice(0, 2)
          .map((word) => word[0])
          .join('')
          .toUpperCase() || 'S'
      )}
    </span>
  );
}
export function ClassCard({ value }: { value: ClassSummary }) {
  return (
    <Link className="class-card" to={`/classes/${value.id}`}>
      <div className="class-card-top">
        <span className="class-glyph">{value.section || value.name.slice(0, 2)}</span>
        <RoleBadge role={value.role} />
      </div>
      <div>
        <span className="eyebrow">
          {value.program || 'Class space'}
          {value.semester && ` · Semester ${value.semester}`}
        </span>
        <h3>{value.name}</h3>
        <p>{value.description || 'A shared space for your class community.'}</p>
      </div>
      <div className="class-card-footer">
        <span>
          <Users size={15} />
          {value.memberCount} {value.memberCount === 1 ? 'member' : 'members'}
        </span>
        <span className="card-link">
          Open class <ChevronRight size={17} />
        </span>
      </div>
    </Link>
  );
}
export function Modal({
  title,
  description,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  useEffect(() => {
    const el = dialog.current;
    el?.showModal();
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      el?.close();
      document.body.style.overflow = previous;
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className={`modal ${wide ? 'modal-wide' : ''}`}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === dialog.current) {
          const box = dialog.current.getBoundingClientRect();
          if (
            event.clientX < box.left ||
            event.clientX > box.right ||
            event.clientY < box.top ||
            event.clientY > box.bottom
          )
            onClose();
        }
      }}
    >
      <div className="modal-heading">
        <div>
          <h2 id={titleId}>{title}</h2>
          {description && <p id={descriptionId}>{description}</p>}
        </div>
        <button className="icon-button" aria-label="Close dialog" onClick={onClose}>
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function ClassForm({
  initial,
  submitLabel,
  busy,
  error,
  onSubmit,
  onCancel,
}: {
  initial?: ClassFields;
  submitLabel: string;
  busy: boolean;
  error: string;
  onSubmit: (fields: ClassFields) => Promise<void>;
  onCancel: () => void;
}) {
  const [fields, setFields] = useState<ClassFields>(
    initial
      ? {
          name: initial.name,
          program: initial.program,
          semester: String(initial.semester),
          section: initial.section,
          description: initial.description,
        }
      : { name: '', program: '', semester: '', section: '', description: '' },
  );
  const set = (key: keyof ClassFields, value: string) =>
    setFields((prev) => ({ ...prev, [key]: value }));
  return (
    <form
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        void onSubmit(fields);
      }}
      className="form-stack"
    >
      <label>
        Class name
        <input
          autoFocus
          required
          minLength={2}
          maxLength={80}
          value={fields.name}
          onChange={(e) => set('name', e.target.value)}
          placeholder="e.g. BSCS 5D"
          autoComplete="off"
        />
      </label>
      <label>
        Program
        <input
          required
          maxLength={80}
          value={fields.program}
          onChange={(e) => set('program', e.target.value)}
          placeholder="e.g. BS Computer Science"
        />
      </label>
      <div className="form-two">
        <label>
          Semester
          <input
            required
            type="number"
            inputMode="numeric"
            min={1}
            max={12}
            step={1}
            value={fields.semester}
            onChange={(e) => set('semester', e.target.value)}
            placeholder="e.g. 5"
          />
        </label>
        <label>
          Section
          <input
            required
            maxLength={20}
            value={fields.section}
            onChange={(e) => set('section', e.target.value)}
            placeholder="e.g. D"
          />
        </label>
      </div>
      <label>
        Description <span className="optional">Optional</span>
        <textarea
          maxLength={500}
          rows={3}
          value={fields.description}
          onChange={(e) => set('description', e.target.value)}
          placeholder="A short introduction to your class"
        />
      </label>
      <ErrorNotice message={error} />
      <div className="modal-actions">
        <button
          type="button"
          className="button button-secondary"
          onClick={onCancel}
          disabled={busy}
        >
          Cancel
        </button>
        <button className="button button-primary" disabled={busy}>
          {busy ? <LoaderCircle className="spin" size={17} /> : <Check size={17} />}
          {busy ? 'Saving…' : submitLabel}
        </button>
      </div>
    </form>
  );
}
export function CopyButton({ value, label = 'Copy' }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2200);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <>
      <button
        className="button button-secondary button-small"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setFailed(false);
          } catch {
            setFailed(true);
          }
        }}
      >
        {copied ? <Check size={15} /> : <Copy size={15} />}
        {copied ? 'Copied' : label}
      </button>
      {failed && <small role="status">Select and copy the code manually.</small>}
    </>
  );
}
type Toast = { id: number; message: string };
const ToastContext = createContext<(message: string) => void>(() => {});
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<Toast | null>(null);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(timer);
  }, [toast]);
  return (
    <ToastContext.Provider value={(message) => setToast({ id: Date.now(), message })}>
      {children}
      <div className="toast-region" aria-live="polite">
        {toast && (
          <div className="toast" key={toast.id}>
            <CheckCircle2 size={20} />
            <span>{toast.message}</span>
            <button aria-label="Dismiss message" onClick={() => setToast(null)}>
              <X size={16} />
            </button>
          </div>
        )}
      </div>
    </ToastContext.Provider>
  );
}
export const useToast = () => useContext(ToastContext);
export function ActionHeading({
  eyebrow,
  title,
  subtitle,
  children,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  children?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        {eyebrow && <span className="eyebrow">{eyebrow}</span>}
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {children && <div className="heading-actions">{children}</div>}
    </div>
  );
}
export function AddButton({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button className="button button-primary" onClick={onClick}>
      <Plus size={18} />
      {children}
    </button>
  );
}
export function formatDate(value: string, time = false) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat('en-PK', {
        dateStyle: 'medium',
        ...(time ? { timeStyle: 'short' as const } : {}),
        timeZone: 'Asia/Karachi',
      }).format(date);
}

export function Pagination({
  offset,
  limit,
  total,
  onChange,
}: {
  offset: number;
  limit: number;
  total: number;
  onChange: (offset: number) => void;
}) {
  if (total <= limit && offset === 0) return null;
  return (
    <div className="pagination">
      <span>
        {total
          ? `${Math.min(offset + 1, total)}–${Math.min(offset + limit, total)} of ${total}`
          : 'No results'}
      </span>
      <div>
        <button
          className="button button-secondary button-small"
          disabled={offset === 0}
          onClick={() => onChange(Math.max(0, offset - limit))}
        >
          Previous
        </button>
        <button
          className="button button-secondary button-small"
          disabled={offset + limit >= total}
          onClick={() => onChange(offset + limit)}
        >
          Next
        </button>
      </div>
    </div>
  );
}
