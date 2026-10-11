import { useCallback, useEffect, useState } from 'react';
import { errorMessage, useAuth } from './auth';

/** Account-scoped request state. Cancels obsolete reads on navigation or account changes. */
export function useApi<T>(path: string | null) {
  const { request, me } = useAuth();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(Boolean(path));
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => setRevision((v) => v + 1), []);
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setData(null);
    setError('');
    setLoading(Boolean(path));
    if (path) {
      request<T>(path, { signal: controller.signal })
        .then((value) => {
          if (active) setData(value);
        })
        .catch((e) => {
          if (active) setError(errorMessage(e));
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }
    return () => {
      active = false;
      controller.abort();
    };
  }, [path, request, me?.user.id, revision]);
  return { data, error, loading, reload };
}

export function useDebounced(value: string, delay = 280) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

export function queryString(values: Record<string, string | number | boolean | undefined | null>) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
  }
  return params.toString();
}

export function contentChanged() {
  window.dispatchEvent(new CustomEvent('xvia:content-updated'));
}
