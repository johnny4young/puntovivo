import { useState, useEffect } from 'react';
import { isElectron, type ElectronAPI, type SyncAPI } from '@/types/electron.d';

/**
 * Hook to detect if running in Electron and access Electron APIs
 */
export function useElectron() {
  const [inElectron, setInElectron] = useState(false);
  const [appInfo, setAppInfo] = useState<{
    version: string;
    pocketbaseUrl: string;
  } | null>(null);

  useEffect(() => {
    const checkElectron = async () => {
      if (isElectron() && window.electron) {
        setInElectron(true);
        try {
          const [version, pocketbaseUrl] = await Promise.all([
            window.electron.getAppVersion(),
            window.electron.getPocketBaseUrl(),
          ]);
          setAppInfo({ version, pocketbaseUrl });
        } catch (error) {
          console.error('Failed to load Electron app info:', error);
        }
      }
    };

    checkElectron();
  }, []);

  return {
    isElectron: inElectron,
    appInfo,
    electron: inElectron ? (window.electron as ElectronAPI) : null,
    sync: inElectron ? (window.sync as SyncAPI) : null,
    db: inElectron ? window.db : null,
  };
}
