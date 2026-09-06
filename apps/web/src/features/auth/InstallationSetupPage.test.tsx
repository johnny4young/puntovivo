import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { render } from '@/test/utils';
import i18n from '@/i18n';

const mocks = vi.hoisted(() => ({ login: vi.fn(), claim: vi.fn(), native: vi.fn() }));
vi.mock('./AuthProvider', () => ({ useAuth: () => ({ login: mocks.login }) }));
vi.mock('@/lib/trpc', () => ({
  vanillaClient: { auth: { completeSetup: { mutate: mocks.claim } } },
}));
import { InstallationSetupPage } from './InstallationSetupPage';
const countries = [{ code: 'CO', nameEn: 'Colombia', nameEs: 'Colombia', currencyCode: 'COP' }];
const password = 'OwnerPassword42!';
const savedApi = window.api;

beforeEach(async () => {
  await i18n.changeLanguage('en');
  mocks.login.mockReset().mockResolvedValue(undefined);
  mocks.claim.mockReset().mockResolvedValue({ created: true });
  mocks.native.mockReset().mockResolvedValue({ ok: true });
  Object.defineProperty(window, 'api', { configurable: true, value: undefined });
});
afterEach(() => Object.defineProperty(window, 'api', { configurable: true, value: savedApi }));
function fill(id: string, value: string) {
  fireEvent.change(document.getElementById(`setup-${id}`)!, { target: { value } });
}
async function business() {
  fill('businessName', 'My Store');
  fill('siteName', 'Main Store');
  fill('countryCode', 'CO');
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  await screen.findByLabelText('Your name');
}
function owner() {
  fill('ownerName', 'Owner');
  fill('email', 'owner@example.com');
  fill('password', password);
  fill('confirmPassword', password);
}

describe('first-use ownership UI', () => {
  it.each([
    ['en', 'Start with your business.', 'Business name'],
    ['es', 'Empieza con tu negocio.', 'Nombre del negocio'],
  ] as const)(
    'renders clear %s first control and no false readiness claim',
    async (language, title, firstControl) => {
      await i18n.changeLanguage(language);
      render(<InstallationSetupPage countries={countries} onSignIn={vi.fn()} />);
      expect(screen.getByRole('heading', { name: title })).toBeVisible();
      await waitFor(() => expect(screen.getByLabelText(firstControl)).toHaveFocus());
      expect(document.body).not.toHaveTextContent(/setup\.[a-zA-Z]|presets\.[a-zA-Z]|undefined/);
    }
  );

  it('requires explicit business/country and preserves values when going back', async () => {
    render(<InstallationSetupPage countries={countries} onSignIn={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(screen.getAllByText('Complete this field.')).toHaveLength(3));
    expect(screen.getByLabelText('Business name')).toHaveFocus();
    await business();
    await waitFor(() => expect(screen.getByLabelText('Your name')).toHaveFocus());
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByLabelText('Business name')).toHaveValue('My Store');
    expect(screen.getByLabelText('Country and currency')).toHaveValue('CO');
    expect(mocks.claim).not.toHaveBeenCalled();
  });

  it('requires strong matching passwords and a code before a web claim', async () => {
    render(<InstallationSetupPage countries={countries} onSignIn={vi.fn()} />);
    await business();
    owner();
    fill('password', 'weak');
    fill('confirmPassword', 'different');
    fireEvent.click(screen.getByRole('button', { name: 'Create my workspace' }));
    expect(await screen.findByText('The passwords do not match.')).toBeVisible();
    expect(
      screen.getByText('Enter the 64-character installation code from the server.')
    ).toBeVisible();
    expect(mocks.claim).not.toHaveBeenCalled();
  });

  it('claims once, clears secrets, and offers login recovery without recreating ownership', async () => {
    mocks.login.mockRejectedValue(new Error('network transport lost'));
    const signIn = vi.fn();
    render(<InstallationSetupPage countries={countries} onSignIn={signIn} />);
    await business();
    owner();
    fill('token', 'b'.repeat(64));
    fireEvent.click(screen.getByRole('button', { name: 'Create my workspace' }));
    expect(
      await screen.findByRole('heading', { name: 'Your workspace was created' })
    ).toBeVisible();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Go to sign in' })).toBeEnabled()
    );
    expect(mocks.claim).toHaveBeenCalledOnce();
    expect(mocks.claim).toHaveBeenCalledWith({
      businessName: 'My Store',
      siteName: 'Main Store',
      countryCode: 'CO',
      presetId: 'retail',
      ownerName: 'Owner',
      email: 'owner@example.com',
      password,
      token: 'b'.repeat(64),
    });
    expect(mocks.login).toHaveBeenCalledWith({ email: 'owner@example.com', password });
    expect(document.querySelector('input[type=password]')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Go to sign in' }));
    expect(signIn).toHaveBeenCalledOnce();
  });

  it('uses the native fixed claim without exposing an installation-code input', async () => {
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { session: { completeSetup: mocks.native } },
    });
    render(<InstallationSetupPage countries={countries} onSignIn={vi.fn()} />);
    await business();
    owner();
    expect(screen.queryByLabelText('Installation code')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Create my workspace' }));
    await waitFor(() => expect(mocks.native).toHaveBeenCalledOnce());
    expect(mocks.native.mock.calls[0]![0]).not.toHaveProperty('token');
    expect(mocks.native.mock.calls[0]![0]).not.toHaveProperty('confirmPassword');
    expect(mocks.claim).not.toHaveBeenCalled();
  });

  it('keeps rejection readable and does not log in or expose internal details', async () => {
    mocks.claim.mockRejectedValue({
      data: { errorCode: 'SETUP_TOKEN_INVALID' },
      message: 'SECRET SQLITE /Users/owner',
    });
    render(<InstallationSetupPage countries={countries} onSignIn={vi.fn()} />);
    await business();
    owner();
    fill('token', 'b'.repeat(64));
    fireEvent.click(screen.getByRole('button', { name: 'Create my workspace' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The installation code is invalid or expired.'
    );
    expect(document.body).not.toHaveTextContent(/SECRET|SQLITE|\/Users/);
    expect(mocks.login).not.toHaveBeenCalled();
  });

  it('directs a competing completed claim to the existing owner, not a retry', async () => {
    mocks.claim.mockRejectedValue({ data: { errorCode: 'SETUP_ALREADY_COMPLETED' } });
    render(<InstallationSetupPage countries={countries} onSignIn={vi.fn()} />);
    await business();
    owner();
    fill('token', 'b'.repeat(64));
    fireEvent.click(screen.getByRole('button', { name: 'Create my workspace' }));
    expect(
      await screen.findByRole('heading', { name: 'This installation already has an owner' })
    ).toBeVisible();
    expect(mocks.login).not.toHaveBeenCalled();
  });
});
