import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import en from '../../apps/web/src/i18n/locales/en/operations.json';
import es from '../../apps/web/src/i18n/locales/es/operations.json';
import { attachClientIssueTracker, expectNoClientIssues, login } from './support/app';
import { seedSurfaceGateScenario } from './support/db';
import { readDecision, seedProposals } from './support/payment-proposals';

for (const spanish of [false, true]) {
  test(`payment proposals require explicit human review and refresh persisted state ${spanish ? 'ES' : 'EN'}`, async ({
    page,
  }, testInfo) => {
    const copy = (spanish ? es : en).payments.proposals;
    const scenario = seedSurfaceGateScenario(
      `payment-proposals-${testInfo.parallelIndex}-${randomUUID()}`,
      { 'operations-center': true }
    );
    const [approval, rejection] = seedProposals(scenario.tenantId);
    const issues = attachClientIssueTracker(page);
    await page.addInitScript(
      language => {
        localStorage.setItem('puntovivo-language-preference', language);
      },
      spanish ? 'es' : 'en'
    );
    await login(page, { ...scenario.admin, defaultPath: '/company' }, { spanish });
    await page.goto('/operations?tab=payments');
    const section = page.getByRole('region', { name: copy.title });
    await expect(section).toBeVisible();
    const opener = page.getByTestId(`payment-proposal-review-${approval!.id}`);
    await opener.click();
    const dialog = page.getByRole('dialog', { name: copy.reviewTitle });
    await expect(dialog).toBeVisible();
    // Money separators follow the CO tenant locale, independently of EN/ES labels.
    await expect(dialog).toContainText('123,45');
    await expect(dialog.getByText(copy.aiWarning, { exact: true })).toBeVisible();
    await expect(
      dialog.getByText(approval!.statement.providerTransactionId, { exact: true })
    ).toBeVisible();
    const approve = dialog.getByRole('button', { name: copy.approve, exact: true });
    await expect(approve).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    await expect(opener).toBeFocused();
    await opener.click();
    const acknowledgement = dialog.getByTestId('payment-proposal-provider-checked');
    await acknowledgement.focus();
    await page.keyboard.press('Space');
    await expect(acknowledgement).toBeChecked();
    await expect(approve).toBeEnabled();
    await approve.click();
    await expect(dialog).not.toBeVisible();
    await expect(opener).toHaveCount(0);
    await expect
      .poll(() => readDecision(scenario.tenantId, approval!.id, approval!.outboxId))
      .toEqual({
        proposal: { status: 'approved', reviewed_by: scenario.admin.id },
        outbox: {
          status: 'settled',
          provider_transaction_id: approval!.statement.providerTransactionId,
          amount: 123.45,
        },
        audit: [{ action: 'payment.mark_settled' }, { action: 'payment.proposal_approved' }],
      });
    await page.getByTestId(`payment-proposal-review-${rejection!.id}`).click();
    await expect(acknowledgement).not.toBeChecked();
    await expect(approve).toBeDisabled();
    await dialog.getByRole('button', { name: copy.reject, exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await expect
      .poll(() => readDecision(scenario.tenantId, rejection!.id, rejection!.outboxId))
      .toEqual({
        proposal: { status: 'rejected', reviewed_by: scenario.admin.id },
        outbox: { status: 'approved', provider_transaction_id: null, amount: 123.45 },
        audit: [{ action: 'payment.proposal_rejected' }],
      });
    await expect(section.getByText(copy.emptyTitle, { exact: true })).toBeVisible();
    await expectNoClientIssues(issues);
  });
}
