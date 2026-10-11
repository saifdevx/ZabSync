import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { useApi } from './hooks';

export type Feature = 'subjects' | 'resources' | 'announcements' | 'tutor' | 'profilePhotos';
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
  useEffect(() => {
    const refresh = () => state.reload();
    window.addEventListener('xvia:settings-updated', refresh);
    window.addEventListener('focus', refresh);
    return () => {
      window.removeEventListener('xvia:settings-updated', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, [state.reload]);
  return (
    <SiteContext.Provider
      value={{ settings: state.data?.settings ?? null, error: state.error, reload: state.reload }}
    >
      {children}
    </SiteContext.Provider>
  );
}
export function useSite() {
  return useContext(SiteContext);
}
