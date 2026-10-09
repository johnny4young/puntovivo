import { expect, test } from '@playwright/test';
import {
  attachClientIssueTracker,
  ensureLanguage,
  expectNoClientIssues,
  login,
} from './support/app';
import { seedSurfaceGateScenario } from './support/db';

// Synthetic browser audio only: never request the operator's microphone.
test.use({
  launchOptions: {
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
  },
  permissions: ['microphone'],
});

/** Browser-owned synthetic streams and a controllable late permission grant. */
type VoiceProbe = {
  streams: MediaStream[];
  holdGrant: boolean;
  grantPending: boolean;
  releaseGrant: (() => void) | null;
};

for (const language of ['en', 'es'] as const) {
  test(`voice dialog discards capture and late transcription with focus restored (${language})`, async ({
    page,
  }, info) => {
    const scenario = seedSurfaceGateScenario(`voice-${info.parallelIndex}-${language}`, {
      'pos-touch': true,
      'dine-in': true,
      'semantic-search': true,
    });
    const tracker = attachClientIssueTracker(page);
    await page.addInitScript(() => {
      const probe: VoiceProbe = {
        streams: [],
        holdGrant: false,
        grantPending: false,
        releaseGrant: null,
      };
      const target = window as Window & { voiceProbe?: VoiceProbe };
      target.voiceProbe = probe;
      const getUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia = async constraints => {
        const stream = await getUserMedia(constraints);
        probe.streams.push(stream);
        if (probe.holdGrant) {
          probe.grantPending = true;
          await new Promise<void>(resolve => {
            probe.releaseGrant = resolve;
          });
          probe.grantPending = false;
        }
        return stream;
      };
    });

    let transcriptions = 0;
    let parses = 0;
    let releaseTranscription!: () => void;
    const transcriptionGate = new Promise<void>(resolve => {
      releaseTranscription = resolve;
    });
    // Only these read-side availability fixtures and paid transports are mocked.
    // Paid procedures are intercepted before any request reaches the real server.
    await page.route('**/api/trpc/**', async route => {
      const procedures = new URL(route.request().url()).pathname.split('/').at(-1)!.split(',');
      const isPaid = procedures.some(
        p => p === 'ai.transcribeAudio' || p === 'ai.parseCartCommand'
      );
      if (isPaid) {
        expect(
          procedures.every(p => p === 'ai.transcribeAudio' || p === 'ai.parseCartCommand')
        ).toBe(true);
        transcriptions += procedures.filter(p => p === 'ai.transcribeAudio').length;
        parses += procedures.filter(p => p === 'ai.parseCartCommand').length;
        await transcriptionGate;
        await route.fulfill({
          json: procedures.map(p => ({
            result: {
              data:
                p === 'ai.transcribeAudio'
                  ? { transcript: 'discarded synthetic audio' }
                  : { mode: 'unrecognized', reason: 'discarded' },
            },
          })),
        });
        return;
      }
      if (
        !procedures.some(
          p => p === 'ai.settings.voiceAvailability' || p === 'cashSessions.getActive'
        )
      ) {
        await route.continue();
        return;
      }
      const response = await route.fetch();
      const body = await response.json();
      for (const [index, procedure] of procedures.entries()) {
        if (procedure === 'ai.settings.voiceAvailability')
          body[index] = { result: { data: { enabled: true } } };
        if (procedure === 'cashSessions.getActive')
          body[index] = { result: { data: { id: 'voice-ui-fixture' } } };
      }
      await route.fulfill({ response, json: body });
    });

    await login(page, { ...scenario.admin, defaultPath: '/company' });
    await ensureLanguage(page, language);
    await page.goto('/touch/voice');
    const opener = page.getByTestId('voice-ordering-mic-cta');
    await expect(opener).toBeEnabled();
    await opener.click();
    const modal = page.getByTestId('voice-cart-modal');
    const close = modal.getByLabel(language === 'es' ? 'Cerrar' : 'Close', { exact: true });
    const record = modal.getByTestId('voice-modal-record');
    await expect(modal).toHaveAccessibleName(
      language === 'es' ? 'Comando por voz' : 'Voice cart command'
    );
    await expect(close).toBeFocused();
    await close.press('Shift+Tab');
    await expect(record).toBeFocused();
    await record.press('Tab');
    await expect(close).toBeFocused();
    await record.click();
    await expect(record).toHaveText(language === 'es' ? 'Detener grabación' : 'Stop recording');
    await expect
      .poll(() =>
        page.evaluate(() => {
          const probe = (window as Window & { voiceProbe: VoiceProbe }).voiceProbe;
          return (
            probe.streams.length > 0 &&
            probe.streams.some(s => s.getTracks().some(t => t.readyState === 'live'))
          );
        })
      )
      .toBe(true);
    await close.press('Escape');
    await expect(modal).toBeHidden();
    await expect(opener).toBeFocused();
    await expect
      .poll(() =>
        page.evaluate(() =>
          (window as Window & { voiceProbe: VoiceProbe }).voiceProbe.streams.every(s =>
            s.getTracks().every(t => t.readyState === 'ended')
          )
        )
      )
      .toBe(true);
    expect(transcriptions).toBe(0);
    expect(parses).toBe(0);

    await opener.click();
    await record.click();
    await expect(record).toHaveText(language === 'es' ? 'Detener grabación' : 'Stop recording');
    await record.click();
    await expect.poll(() => transcriptions).toBe(1);
    await expect(modal).toContainText(language === 'es' ? 'Transcribiendo' : 'Transcribing');
    await close.press('Escape');
    await expect(modal).toBeHidden();
    await expect(opener).toBeFocused();
    releaseTranscription();
    await expect
      .poll(() =>
        page.evaluate(() =>
          (window as Window & { voiceProbe: VoiceProbe }).voiceProbe.streams.every(s =>
            s.getTracks().every(t => t.readyState === 'ended')
          )
        )
      )
      .toBe(true);
    expect(parses).toBe(0);

    await page.evaluate(() => {
      (window as Window & { voiceProbe: VoiceProbe }).voiceProbe.holdGrant = true;
    });
    await opener.click();
    await record.click();
    await expect
      .poll(() =>
        page.evaluate(() => (window as Window & { voiceProbe: VoiceProbe }).voiceProbe.grantPending)
      )
      .toBe(true);
    await close.click();
    await expect(modal).toBeHidden();
    await expect(opener).toBeFocused();
    await page.evaluate(() => {
      (window as Window & { voiceProbe: VoiceProbe }).voiceProbe.releaseGrant?.();
    });
    await expect
      .poll(() =>
        page.evaluate(() =>
          (window as Window & { voiceProbe: VoiceProbe }).voiceProbe.streams.every(s =>
            s.getTracks().every(t => t.readyState === 'ended')
          )
        )
      )
      .toBe(true);
    expect(transcriptions).toBe(1);
    expect(parses).toBe(0);
    await expectNoClientIssues(tracker);
  });
}
