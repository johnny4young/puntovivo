import { Suspense } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createInstance, type BackendModule } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { render, screen } from '@/test/utils';
import { FiscalContingencyIndicator } from '@/features/fiscal/FiscalContingencyIndicator';
import { AutoUpdateBanner } from '@/features/company/AutoUpdateBanner';
import { defaultAutoUpdateStatus } from '@/features/company/auto-update-status';
import enCommon from './locales/en/common.json';
import esCommon from './locales/es/common.json';
import enErrors from './locales/en/errors.json';
import esErrors from './locales/es/errors.json';
import enAuth from './locales/en/auth.json';
import esAuth from './locales/es/auth.json';

const state = vi.hoisted(() => ({
  role: 'admin',
  fiscalQuery: vi.fn(),
  toastError: vi.fn(),
}));
vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { role: state.role } }),
}));
vi.mock('@/lib/trpc', () => ({
  trpc: {
    reports: {
      fiscal: {
        list: {
          useQuery: (_input: unknown, options: unknown) => {
            state.fiscalQuery(options);
            return { data: { total: 3 } };
          },
        },
      },
    },
  },
}));
vi.mock('@/components/feedback/ToastProvider', () => ({
  useToast: () => ({ error: state.toastError }),
}));

async function shellI18n(language: 'en' | 'es') {
  const requested: string[] = [];
  const instance = createInstance();
  instance.use<BackendModule>({
    type: 'backend',
    init() {},
    read(_language, namespace, callback) {
      requested.push(namespace);
      callback(new Error('Feature dictionaries are intentionally unavailable'), false);
    },
  });
  await instance.init({
    lng: language,
    fallbackLng: 'en',
    ns: ['common'],
    defaultNS: 'common',
    resources: {
      en: { common: enCommon, errors: enErrors, auth: enAuth },
      es: { common: esCommon, errors: esErrors, auth: esAuth },
    },
    partialBundledLanguages: true,
    interpolation: { escapeValue: false },
    react: { useSuspense: true },
  });
  return { instance, requested };
}

beforeEach(() => {
  state.role = 'admin';
  state.fiscalQuery.mockClear();
  state.toastError.mockClear();
  window.localStorage.clear();
});
afterEach(() => {
  Object.defineProperty(window, 'electron', { configurable: true, value: undefined });
});

describe('always-mounted shell translations', () => {
  it('does not request fiscal/settings dictionaries even for inactive web/cashier indicators', async () => {
    state.role = 'cashier';
    Object.defineProperty(window, 'electron', { configurable: true, value: undefined });
    const { instance, requested } = await shellI18n('en');
    render(
      <I18nextProvider i18n={instance}>
        <Suspense fallback="shell suspended">
          <FiscalContingencyIndicator />
          <AutoUpdateBanner />
        </Suspense>
      </I18nextProvider>
    );
    expect(screen.queryByText('shell suspended')).not.toBeInTheDocument();
    expect(screen.queryByTestId('auto-update-banner')).not.toBeInTheDocument();
    expect(state.fiscalQuery).toHaveBeenCalledWith(expect.objectContaining({ enabled: false }));
    expect(requested).toEqual([]);
  });

  for (const language of ['en', 'es'] as const) {
    it(`keeps fiscal warnings and verify/restart actions translated with only bootstrap resources (${language})`, async () => {
      const user = userEvent.setup();
      const recovered = {
        ...defaultAutoUpdateStatus,
        state: 'downloaded' as const,
        downloadedVersion: '1.13.1',
        installReady: false,
      };
      const ready = { ...recovered, installReady: true };
      const checkForAppUpdates = vi.fn().mockRejectedValueOnce({}).mockResolvedValue(ready);
      const restartToApplyAppUpdate = vi
        .fn()
        .mockRejectedValueOnce({})
        .mockResolvedValue({ success: true });
      Object.defineProperty(window, 'electron', {
        configurable: true,
        value: {
          getAutoUpdateStatus: vi.fn().mockResolvedValue(recovered),
          checkForAppUpdates,
          restartToApplyAppUpdate,
        },
      });
      const { instance, requested } = await shellI18n(language);
      render(
        <I18nextProvider i18n={instance}>
          <Suspense fallback="shell suspended">
            <FiscalContingencyIndicator />
            <AutoUpdateBanner />
          </Suspense>
        </I18nextProvider>
      );
      const copy = language === 'en' ? enCommon : esCommon;
      expect(
        screen.getByLabelText(copy.fiscalContingency.badge.replace('{{count}}', '3'))
      ).toBeInTheDocument();
      await user.click(
        await screen.findByRole('button', { name: copy.updaterNotice.actions.verifyDownload })
      );
      expect(state.toastError).toHaveBeenLastCalledWith(
        expect.objectContaining({ title: copy.updaterNotice.toast.checkError })
      );
      expect(
        screen.getByText(copy.updaterNotice.banner.verifyTitle.replace('{{version}}', '1.13.1'))
      ).toBeInTheDocument();
      await user.click(
        screen.getByRole('button', { name: copy.updaterNotice.actions.verifyDownload })
      );
      expect(checkForAppUpdates).toHaveBeenCalledTimes(2);
      await user.click(
        await screen.findByRole('button', { name: copy.updaterNotice.actions.restartToInstall })
      );
      expect(state.toastError).toHaveBeenLastCalledWith(
        expect.objectContaining({ title: copy.updaterNotice.toast.restartError })
      );
      expect(
        screen.getByText(copy.updaterNotice.banner.readyTitle.replace('{{version}}', '1.13.1'))
      ).toBeInTheDocument();
      await user.click(
        screen.getByRole('button', { name: copy.updaterNotice.actions.restartToInstall })
      );
      expect(restartToApplyAppUpdate).toHaveBeenCalledTimes(2);
      await act(() => instance.changeLanguage(language === 'en' ? 'es' : 'en'));
      const switched = language === 'en' ? esCommon : enCommon;
      expect(
        screen.getByRole('button', { name: switched.updaterNotice.actions.restartToInstall })
      ).toBeInTheDocument();
      expect(screen.queryByText('shell suspended')).not.toBeInTheDocument();
      expect(requested).toEqual([]);
    });
  }
});
