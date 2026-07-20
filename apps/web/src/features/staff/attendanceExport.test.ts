import { beforeEach, describe, expect, it } from 'vitest';
import i18n from '@/i18n';
import {
  ATTENDANCE_PAYROLL_HEADERS,
  buildAttendanceAccountingWorkbook,
  buildAttendancePayrollCsv,
  type AttendanceExportReport,
} from './attendanceExport';

function reportFixture(): AttendanceExportReport {
  return {
    timeZone: 'America/Bogota',
    generatedAt: '2026-07-20T22:00:00.000Z',
    overtimePolicy: {
      supported: true,
      countryCode: 'CO',
      calculationFromDate: '2026-07-13',
      calculationToDate: '2026-07-27',
      profiles: [
        {
          id: 'CO-2026-42H',
          effectiveFrom: '2026-07-15',
          weeklyRegularSeconds: 42 * 3_600,
          dailyRegularSeconds: 9 * 3_600,
        },
      ],
      limitations: ['contracted_schedule', 'holiday_calendar'],
      sourceUrls: ['https://example.test/official'],
    },
    total: 1,
    rows: [
      {
        id: 'shift-1',
        userId: 'employee-1',
        userName: '=Ana Torres',
        userRole: 'cashier',
        siteId: 'site-1',
        siteName: 'Sede "Centro"',
        clockedInAt: '2026-07-20T13:00:00.000Z',
        clockedOutAt: '2026-07-20T22:00:00.000Z',
        breaks: [
          {
            id: 'break-1',
            employeeShiftId: 'shift-1',
            startedAt: '2026-07-20T17:00:00.000Z',
            endedAt: '2026-07-20T17:30:00.000Z',
          },
        ],
        original: {
          clockedInAt: '2026-07-20T13:15:00.000Z',
          clockedOutAt: '2026-07-20T22:15:00.000Z',
          breaks: [],
        },
        correction: {
          id: 'correction-1',
          version: 2,
          reason: '@Verified against signed evidence',
          createdByUserId: 'manager-1',
          createdByName: 'María López',
          createdAt: '2026-07-21T12:00:00.000Z',
        },
        status: 'closed',
        elapsedSeconds: 9 * 3_600,
        breakSeconds: 30 * 60,
        workedSeconds: 8.5 * 3_600,
        overtime: {
          regularSeconds: 7.5 * 3_600,
          overtimeSeconds: 3_600,
          premiums: [{ code: 'co_day_overtime', multiplier: 1.25, seconds: 3_600 }],
          policyIds: ['CO-2026-42H'],
        },
      },
    ],
  };
}

beforeEach(async () => {
  await i18n.changeLanguage('en');
});

describe('attendance payroll and accounting exports', () => {
  it('builds a UTF-8 canonical CSV with stable headers, corrected evidence, and formula safety', () => {
    const csv = buildAttendancePayrollCsv(reportFixture(), '2026-07-20', '2026-07-21');
    const lines = csv.slice(1).split('\r\n');

    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(lines[0]).toBe(ATTENDANCE_PAYROLL_HEADERS.map(header => `"${header}"`).join(','));
    expect(lines[1]).toContain('"\'=Ana Torres"');
    expect(lines[1]).toContain('"Sede ""Centro"""');
    expect(lines[1]).toContain('"\'@Verified against signed evidence"');
    expect(lines[1]).toContain('"8.5"');
    expect(lines[1]).toContain('"1"');
    expect(lines[1]).toContain('"2"');
    expect(lines[1]).toContain('co_day_overtime');
  });

  it('builds a localized four-sheet accounting workbook with numeric evidence', async () => {
    const bytes = await buildAttendanceAccountingWorkbook(
      reportFixture(),
      '2026-07-20',
      '2026-07-21',
      i18n.t.bind(i18n)
    );
    const { default: ExcelJS } = await import('exceljs/dist/exceljs.bare.min.js');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(bytes as never);

    expect(workbook.worksheets.map(sheet => sheet.name)).toEqual([
      'Summary',
      'Evidence',
      'Premiums',
      'Read me',
    ]);
    const summary = workbook.getWorksheet('Summary')!;
    expect(summary.getCell('B2').value).toBe('=Ana Torres');
    expect(summary.getCell('I2').value).toBe(8.5);
    expect(summary.getCell('K2').value).toBe(1);
    expect(summary.getRow(2).fill).toMatchObject({
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFF8FAFC' },
    });
    const evidence = workbook.getWorksheet('Evidence')!;
    expect(evidence.getCell('Q2').value).toBe(2);
    expect(evidence.getCell('R2').value).toBe('@Verified against signed evidence');
    const premiums = workbook.getWorksheet('Premiums')!;
    expect(premiums.getCell('E2').value).toBe('co_day_overtime');
    expect(premiums.getCell('F2').value).toBe(1.25);
    expect(workbook.getWorksheet('Read me')!.getCell('B9').value).toContain(
      'not a payroll calculation'
    );
  });

  it('localizes workbook sheets and headers in neutral Spanish', async () => {
    await i18n.changeLanguage('es');
    const bytes = await buildAttendanceAccountingWorkbook(
      reportFixture(),
      '2026-07-20',
      '2026-07-21',
      i18n.t.bind(i18n)
    );
    const { default: ExcelJS } = await import('exceljs/dist/exceljs.bare.min.js');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(bytes as never);

    expect(workbook.worksheets.map(sheet => sheet.name)).toEqual([
      'Resumen',
      'Evidencia',
      'Recargos',
      'Léeme',
    ]);
    expect(workbook.getWorksheet('Resumen')!.getCell('B1').value).toBe('Empleado');
    expect(workbook.getWorksheet('Léeme')!.getCell('B9').value).toContain(
      'no es un cálculo de nómina'
    );
  });
});
