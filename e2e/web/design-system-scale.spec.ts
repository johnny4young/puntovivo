import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import {
  attachClientIssueTracker,
  expectNoClientIssues,
  loginAs,
} from './support/app';

interface DataScaleBudget {
  designSystemRows: number;
  maxMountedRows: number;
}

const perfBudgetPath = resolve(process.cwd(), 'perf-budget.json');

async function loadDataScaleBudget(): Promise<DataScaleBudget> {
  const parsed = JSON.parse(await readFile(perfBudgetPath, 'utf8')) as {
    dataScale?: Partial<DataScaleBudget>;
  };
  const { designSystemRows, maxMountedRows } = parsed.dataScale ?? {};
  if (
    typeof designSystemRows !== 'number' ||
    typeof maxMountedRows !== 'number' ||
    designSystemRows < 1 ||
    maxMountedRows < 1
  ) {
    throw new Error('perf-budget.json is missing a valid dataScale contract');
  }
  return { designSystemRows, maxMountedRows };
}

test.describe('Operator Deck data scale', () => {
  test('keeps a 1,000-row table bounded, searchable, and keyboard traversable', async ({
    page,
  }) => {
    const tracker = attachClientIssueTracker(page);
    const budget = await loadDataScaleBudget();
    expect(budget.designSystemRows).toBe(1_000);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await loginAs(page, 'admin');
    await page.goto('/design-system');

    const specimen = page.getByTestId('design-system-scale-table');
    await specimen.scrollIntoViewIfNeeded();
    await expect(specimen).toBeVisible();

    const scrollRegion = specimen.getByRole('region', { name: 'Scrollable table region' });
    await expect(scrollRegion).toHaveAttribute('data-virtualised', 'true');
    await expect(specimen.getByText(`${budget.designSystemRows} rows`)).toBeVisible();

    const mountedRows = specimen.locator('tbody tr[data-row-id]');
    await expect.poll(() => mountedRows.count()).toBeGreaterThan(0);
    expect(await mountedRows.count()).toBeLessThanOrEqual(budget.maxMountedRows);

    const auditDir = process.env.PUNTOVIVO_AUDIT_DIR;
    if (auditDir) {
      await mkdir(auditDir, { recursive: true });
      await page
        .getByTestId('design-system-scale-section')
        .screenshot({ path: `${auditDir}/operator-deck-base08-scale-section-en.png` });
    }

    const search = specimen.getByPlaceholder('Search a reference across 1,000 rows');
    await search.fill('Operational reference 0999');
    await expect(specimen.locator('[data-row-id="scale-0999"]')).toBeVisible();
    await expect(specimen.getByText('1 row')).toBeVisible();

    await search.fill('');
    await expect(specimen.getByText(`${budget.designSystemRows} rows`)).toBeVisible();
    const refreshedRows = specimen.locator('tbody tr[data-row-id]');
    await expect.poll(() => refreshedRows.count()).toBeGreaterThan(0);
    await refreshedRows.first().focus();
    await page.keyboard.press('End');
    await expect(specimen.locator('[data-row-id="scale-1000"]')).toBeVisible();
    expect(await specimen.locator('tbody tr[data-row-id]').count()).toBeLessThanOrEqual(
      budget.maxMountedRows
    );

    await expectNoClientIssues(tracker);
  });
});
