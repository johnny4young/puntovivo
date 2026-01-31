import { useState, useEffect } from 'react';

// Type declarations for exposed APIs
declare global {
  interface Window {
    electron: {
      getAppVersion: () => Promise<string>;
      getAppPath: () => Promise<string>;
      getPocketBaseUrl: () => Promise<string>;
    };
    db: {
      getAll: (table: string, tenantId: string) => Promise<unknown[]>;
      getById: (table: string, id: string) => Promise<unknown>;
      insert: (table: string, data: Record<string, unknown>) => Promise<unknown>;
      update: (table: string, id: string, data: Record<string, unknown>) => Promise<unknown>;
      delete: (table: string, id: string) => Promise<boolean>;
      query: (sql: string, params?: unknown[]) => Promise<unknown[]>;
    };
    sync: {
      getStatus: () => Promise<{
        isOnline: boolean;
        lastSync: string | null;
        pendingItems: number;
      }>;
      triggerSync: () => Promise<{ success: boolean; synced: number; errors: string[] }>;
    };
  }
}

function App() {
  const [appInfo, setAppInfo] = useState<{
    version: string;
    pocketbaseUrl: string;
    isOnline: boolean;
  } | null>(null);

  useEffect(() => {
    const loadAppInfo = async () => {
      try {
        const [version, pocketbaseUrl, syncStatus] = await Promise.all([
          window.electron.getAppVersion(),
          window.electron.getPocketBaseUrl(),
          window.sync.getStatus(),
        ]);
        setAppInfo({
          version,
          pocketbaseUrl,
          isOnline: syncStatus.isOnline,
        });
      } catch (error) {
        console.error('Failed to load app info:', error);
      }
    };

    loadAppInfo();
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center">
      <div className="text-center p-8 bg-white rounded-2xl shadow-xl max-w-md">
        <div className="mb-6">
          <div className="w-20 h-20 mx-auto bg-indigo-600 rounded-2xl flex items-center justify-center mb-4">
            <svg
              className="w-12 h-12 text-white"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z"
              />
            </svg>
          </div>
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Open Yojob</h1>
          <p className="text-gray-600">POS Solutions System</p>
        </div>

        {appInfo && (
          <div className="space-y-3 text-sm text-gray-500">
            <div className="flex items-center justify-center space-x-2">
              <span className="font-medium">Version:</span>
              <span className="bg-indigo-100 text-indigo-800 px-2 py-1 rounded">
                {appInfo.version}
              </span>
            </div>
            <div className="flex items-center justify-center space-x-2">
              <span className="font-medium">Backend:</span>
              <span className="bg-green-100 text-green-800 px-2 py-1 rounded text-xs">
                {appInfo.pocketbaseUrl}
              </span>
            </div>
            <div className="flex items-center justify-center space-x-2">
              <span className="font-medium">Status:</span>
              <span
                className={`px-2 py-1 rounded ${
                  appInfo.isOnline ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'
                }`}
              >
                {appInfo.isOnline ? '● Online' : '○ Offline'}
              </span>
            </div>
          </div>
        )}

        <div className="mt-8">
          <button className="w-full bg-indigo-600 text-white py-3 px-6 rounded-lg font-medium hover:bg-indigo-700 transition-colors">
            Getting Started
          </button>
        </div>

        <p className="mt-6 text-xs text-gray-400">Built with Electron Forge + React + PocketBase</p>
      </div>
    </div>
  );
}

export default App;
