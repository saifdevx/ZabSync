import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useApi } from './hooks';
import { ErrorNotice, Spinner } from './components';

export type Feature =
  | 'subjects'
  | 'resources'
  | 'announcements'
  | 'developer'
  | 'profilePhotos'
  | 'timetable'
  | 'deadlines'
  | 'chat'
  | 'reminders'
  | 'frontPage'
  | 'cgpa'
  | 'help';
export interface SiteSettings {
  version: number;
  features: Record<Feature, boolean>;
  maintenance: { enabled: boolean; message: string };
  updatedAt: string;
}
const SiteContext = createContext<{
  settings: SiteSettings | null;
  error: string;
  reload: () => void;
}>({ settings: null, error: '', reload: () => {} });
export function SiteProvider({ children }: { children: ReactNode }) {
  const state = useApi<{ settings: SiteSettings }>('/site');
  // This provider is keyed by the account. Keep its last confirmed settings during
  // refreshes so a disabled feature never briefly reappears while /site is loading.
  const [confirmed, setConfirmed] = useState<SiteSettings | null>(null);
  useEffect(() => {
    if (state.data) setConfirmed(state.data.settings);
  }, [state.data]);
  useEffect(() => {
    const refresh = () => state.reload();
    window.addEventListener('zabsync:settings-updated', refresh);
    window.addEventListener('focus', refresh);
    return () => {
      window.removeEventListener('zabsync:settings-updated', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, [state.reload]);
  const settings = state.data?.settings ?? confirmed;
  if (!settings)
    return state.error ? (
      <ErrorNotice message={state.error} retry={state.reload} />
    ) : (
      <Spinner label="Loading your campus settings…" />
    );
  return (
    <SiteContext.Provider value={{ settings, error: state.error, reload: state.reload }}>
      {children}
    </SiteContext.Provider>
  );
}
export function useSite() {
  return useContext(SiteContext);
}
