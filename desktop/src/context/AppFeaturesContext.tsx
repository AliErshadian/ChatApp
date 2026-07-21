import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { api, AppFeaturesSettings } from '../services/api';

const DEFAULT_FEATURES: AppFeaturesSettings = {
  voiceCallsEnabled: true,
  videoCallsEnabled: true,
  screenSharingEnabled: false,
  screenSharingDirectEnabled: true,
  screenSharingGroupsEnabled: true,
  screenMaxResolution: '1080p',
  screenMaxFps: 15,
  screenMaxConcurrentSessions: 50,
  screenBandwidthLimitKbps: null,
  turnConfigured: false,
  updatedAt: '',
};

interface AppFeaturesContextValue {
  features: AppFeaturesSettings;
  loading: boolean;
  callsEnabled: boolean;
  screenShareDirectEnabled: boolean;
  screenShareGroupsEnabled: boolean;
  refreshFeatures: () => Promise<void>;
}

const AppFeaturesContext = createContext<AppFeaturesContextValue | null>(null);

export function AppFeaturesProvider({ children }: { children: ReactNode }) {
  const [features, setFeatures] = useState<AppFeaturesSettings>(DEFAULT_FEATURES);
  const [loading, setLoading] = useState(true);

  const refreshFeatures = useCallback(async () => {
    try {
      const next = await api.getAppFeatures();
      setFeatures(next);
    } catch {
      setFeatures(DEFAULT_FEATURES);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshFeatures();
  }, [refreshFeatures]);

  const value = useMemo(
    () => ({
      features,
      loading,
      callsEnabled: features.voiceCallsEnabled || features.videoCallsEnabled,
      screenShareDirectEnabled:
        features.screenSharingEnabled && features.screenSharingDirectEnabled,
      screenShareGroupsEnabled:
        features.screenSharingEnabled && features.screenSharingGroupsEnabled,
      refreshFeatures,
    }),
    [features, loading, refreshFeatures],
  );

  return <AppFeaturesContext.Provider value={value}>{children}</AppFeaturesContext.Provider>;
}

export function useAppFeatures() {
  const ctx = useContext(AppFeaturesContext);
  if (!ctx) throw new Error('useAppFeatures must be used within AppFeaturesProvider');
  return ctx;
}
