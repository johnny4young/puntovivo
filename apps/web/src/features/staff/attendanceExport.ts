import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@puntovivo/server';
import type { TFunction } from 'i18next';

export type AttendanceExportReport =
  inferRouterOutputs<AppRouter>['employeeShifts']['attendance']['export'];
type AttendanceExportRow = AttendanceExportReport['rows'][number];

export const ATTENDANCE_PAYROLL_HEADERS = [
  'generated_at_utc',
  'period_start_local',
  'period_end_exclusive_local',
  'country_code',
  'overtime_supported',
  'time_zone',
  'employee_id',
  'employee_name',
  'employee_role',
  'site_id',
  'site_name',
  'shift_id',
  'status',
  'clock_in_utc',
  'clock_out_utc',
  'elapsed_hours',
  'break_hours',
  'worked_hours',
  'regular_hours',
  'overtime_hours',
  'premium_breakdown_json',
  'policy_ids',
  'correction_version',
  'correction_reason',
  'corrected_by_user_id',
  'corrected_by_name',
  'corrected_at_utc',
  'original_clock_in_utc',
  'original_clock_out_utc',
] as const;

function hours(seconds: number): number {
  return Number((seconds / 3_600).toFixed(4));
}

function protectSpreadsheetText(value: string): string {
  return /^[\s\u00a0]*[=+\-@]/.test(value) ? `'${value}` : value;
}

function csvCell(value: string | number | boolean | null): string {
  const serialized = value === null ? '' : String(value);
  const safe = typeof value === 'string' ? protectSpreadsheetText(serialized) : serialized;
  return `"${safe.replace(/"/g, '""')}"`;
}

function payrollValues(
  report: AttendanceExportReport,
  row: AttendanceExportRow,
  fromDate: string,
  toDate: string
): Array<string | number | boolean | null> {
  return [
    report.generatedAt,
    fromDate,
    toDate,
    report.overtimePolicy.countryCode,
    report.overtimePolicy.supported,
    report.timeZone,
    row.userId,
    row.userName,
    row.userRole,
    row.siteId,
    row.siteName,
    row.id,
    row.status,
    row.clockedInAt,
    row.clockedOutAt,
    hours(row.elapsedSeconds),
    hours(row.breakSeconds),
    hours(row.workedSeconds),
    row.overtime ? hours(row.overtime.regularSeconds) : null,
    row.overtime ? hours(row.overtime.overtimeSeconds) : null,
    JSON.stringify(
      row.overtime?.premiums.map(premium => ({
        code: premium.code,
        multiplier: premium.multiplier,
        hours: hours(premium.seconds),
      })) ?? []
    ),
    row.overtime?.policyIds.join('|') ?? '',
    row.correction?.version ?? null,
    row.correction?.reason ?? '',
    row.correction?.createdByUserId ?? '',
    row.correction?.createdByName ?? '',
    row.correction?.createdAt ?? '',
    row.original.clockedInAt,
    row.original.clockedOutAt,
  ];
}

/** stable machine headers plus formula-safe RFC 4180 evidence rows. */
export function buildAttendancePayrollCsv(
  report: AttendanceExportReport,
  fromDate: string,
  toDate: string
): string {
  const lines = [
    ATTENDANCE_PAYROLL_HEADERS.map(csvCell).join(','),
    ...report.rows.map(row => payrollValues(report, row, fromDate, toDate).map(csvCell).join(',')),
  ];
  return `\uFEFF${lines.join('\r\n')}`;
}

function evidenceRows(report: AttendanceExportReport) {
  return report.rows.map(row => ({
    employeeId: row.userId,
    employeeName: row.userName,
    role: row.userRole,
    siteId: row.siteId,
    siteName: row.siteName,
    shiftId: row.id,
    status: row.status,
    clockInUtc: row.clockedInAt,
    clockOutUtc: row.clockedOutAt ?? '',
    elapsedHours: hours(row.elapsedSeconds),
    breakHours: hours(row.breakSeconds),
    workedHours: hours(row.workedSeconds),
    regularHours: row.overtime ? hours(row.overtime.regularSeconds) : null,
    overtimeHours: row.overtime ? hours(row.overtime.overtimeSeconds) : null,
    premiumCodes: row.overtime?.premiums.map(item => item.code).join('|') ?? '',
    policyIds: row.overtime?.policyIds.join('|') ?? '',
    correctionVersion: row.correction?.version ?? null,
    correctionReason: row.correction?.reason ?? '',
    correctedBy: row.correction?.createdByName ?? '',
    correctedAtUtc: row.correction?.createdAt ?? '',
    originalClockInUtc: row.original.clockedInAt,
    originalClockOutUtc: row.original.clockedOutAt ?? '',
  }));
}

function summaryRows(report: AttendanceExportReport) {
  const summaries = new Map<
    string,
    {
      employeeId: string;
      employeeName: string;
      role: string;
      sites: Set<string>;
      shifts: number;
      activeShifts: number;
      elapsedSeconds: number;
      breakSeconds: number;
      workedSeconds: number;
      regularSeconds: number;
      overtimeSeconds: number;
      classified: boolean;
      corrections: number;
    }
  >();
  for (const row of report.rows) {
    const summary = summaries.get(row.userId) ?? {
      employeeId: row.userId,
      employeeName: row.userName,
      role: row.userRole,
      sites: new Set<string>(),
      shifts: 0,
      activeShifts: 0,
      elapsedSeconds: 0,
      breakSeconds: 0,
      workedSeconds: 0,
      regularSeconds: 0,
      overtimeSeconds: 0,
      classified: true,
      corrections: 0,
    };
    summary.sites.add(row.siteName);
    summary.shifts += 1;
    summary.activeShifts += row.status === 'active' ? 1 : 0;
    summary.elapsedSeconds += row.elapsedSeconds;
    summary.breakSeconds += row.breakSeconds;
    summary.workedSeconds += row.workedSeconds;
    summary.corrections += row.correction ? 1 : 0;
    if (row.overtime) {
      summary.regularSeconds += row.overtime.regularSeconds;
      summary.overtimeSeconds += row.overtime.overtimeSeconds;
    } else {
      summary.classified = false;
    }
    summaries.set(row.userId, summary);
  }
  return [...summaries.values()]
    .sort(
      (left, right) =>
        left.employeeName.localeCompare(right.employeeName) ||
        left.employeeId.localeCompare(right.employeeId)
    )
    .map(summary => ({
      employeeId: summary.employeeId,
      employeeName: summary.employeeName,
      role: summary.role,
      sites: [...summary.sites].sort().join(', '),
      shifts: summary.shifts,
      activeShifts: summary.activeShifts,
      elapsedHours: hours(summary.elapsedSeconds),
      breakHours: hours(summary.breakSeconds),
      workedHours: hours(summary.workedSeconds),
      regularHours: summary.classified ? hours(summary.regularSeconds) : null,
      overtimeHours: summary.classified ? hours(summary.overtimeSeconds) : null,
      correctedShifts: summary.corrections,
    }));
}

function premiumRows(report: AttendanceExportReport) {
  return report.rows.flatMap(row =>
    (row.overtime?.premiums ?? []).map(premium => ({
      employeeId: row.userId,
      employeeName: row.userName,
      siteName: row.siteName,
      shiftId: row.id,
      premiumCode: premium.code,
      multiplier: premium.multiplier,
      hours: hours(premium.seconds),
      policyIds: row.overtime?.policyIds.join('|') ?? '',
    }))
  );
}

type WorksheetColumn = { header: string; key: string; width: number };

function styleWorksheet(worksheet: import('exceljs').Worksheet, columns: WorksheetColumn[]): void {
  worksheet.columns = columns;
  worksheet.views = [{ state: 'frozen', ySplit: 1 }];
  worksheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
  const header = worksheet.getRow(1);
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF334155' } };
  header.alignment = { vertical: 'middle' };
  header.height = 22;
}

function stripeWorksheetRows(worksheet: import('exceljs').Worksheet): void {
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber > 1 && rowNumber % 2 === 0) {
      row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
    }
  });
}

function exportHeader(t: TFunction, key: string): string {
  return t(`schedule:attendance.export.workbook.headers.${key}`);
}

/**
 * provider-neutral workbook with aggregate, evidence, premium,
 * and handoff-readme sheets. No wage or tax amount is inferred here.
 */
export async function buildAttendanceAccountingWorkbook(
  report: AttendanceExportReport,
  fromDate: string,
  toDate: string,
  t: TFunction
): Promise<Uint8Array> {
  const { default: ExcelJS } = await import('exceljs/dist/exceljs.bare.min.js');
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Puntovivo';
  workbook.created = new Date(report.generatedAt);
  workbook.modified = new Date(report.generatedAt);

  const summary = workbook.addWorksheet(t('schedule:attendance.export.workbook.sheets.summary'));
  const summaryColumns: WorksheetColumn[] = [
    ['employeeId', 24],
    ['employeeName', 28],
    ['role', 14],
    ['sites', 28],
    ['shifts', 12],
    ['activeShifts', 14],
    ['elapsedHours', 16],
    ['breakHours', 14],
    ['workedHours', 16],
    ['regularHours', 16],
    ['overtimeHours', 17],
    ['correctedShifts', 17],
  ].map(([key, width]) => ({
    header: exportHeader(t, String(key)),
    key: String(key),
    width: Number(width),
  }));
  styleWorksheet(summary, summaryColumns);
  summary.addRows(summaryRows(report));
  stripeWorksheetRows(summary);

  const evidence = workbook.addWorksheet(t('schedule:attendance.export.workbook.sheets.evidence'));
  const evidenceColumns: WorksheetColumn[] = [
    ['employeeId', 24],
    ['employeeName', 28],
    ['role', 14],
    ['siteId', 24],
    ['siteName', 24],
    ['shiftId', 24],
    ['status', 12],
    ['clockInUtc', 25],
    ['clockOutUtc', 25],
    ['elapsedHours', 16],
    ['breakHours', 14],
    ['workedHours', 16],
    ['regularHours', 16],
    ['overtimeHours', 17],
    ['premiumCodes', 28],
    ['policyIds', 28],
    ['correctionVersion', 18],
    ['correctionReason', 42],
    ['correctedBy', 28],
    ['correctedAtUtc', 25],
    ['originalClockInUtc', 25],
    ['originalClockOutUtc', 25],
  ].map(([key, width]) => ({
    header: exportHeader(t, String(key)),
    key: String(key),
    width: Number(width),
  }));
  styleWorksheet(evidence, evidenceColumns);
  evidence.addRows(evidenceRows(report));
  stripeWorksheetRows(evidence);

  const premiums = workbook.addWorksheet(t('schedule:attendance.export.workbook.sheets.premiums'));
  const premiumColumns: WorksheetColumn[] = [
    ['employeeId', 24],
    ['employeeName', 28],
    ['siteName', 24],
    ['shiftId', 24],
    ['premiumCode', 28],
    ['multiplier', 14],
    ['hours', 14],
    ['policyIds', 28],
  ].map(([key, width]) => ({
    header: exportHeader(t, String(key)),
    key: String(key),
    width: Number(width),
  }));
  styleWorksheet(premiums, premiumColumns);
  premiums.addRows(premiumRows(report));
  stripeWorksheetRows(premiums);

  const readme = workbook.addWorksheet(t('schedule:attendance.export.workbook.sheets.readme'));
  readme.columns = [
    { key: 'field', width: 30 },
    { key: 'value', width: 100 },
  ];
  readme.addRows([
    {
      field: t('schedule:attendance.export.workbook.readme.period'),
      value: `${fromDate} → ${toDate}`,
    },
    {
      field: t('schedule:attendance.export.workbook.readme.generatedAt'),
      value: report.generatedAt,
    },
    { field: t('schedule:attendance.export.workbook.readme.timeZone'), value: report.timeZone },
    {
      field: t('schedule:attendance.export.workbook.readme.country'),
      value: report.overtimePolicy.countryCode,
    },
    {
      field: t('schedule:attendance.export.workbook.readme.classification'),
      value: report.overtimePolicy.supported
        ? t('schedule:attendance.export.workbook.readme.supported')
        : t('schedule:attendance.export.workbook.readme.unsupported'),
    },
    {
      field: t('schedule:attendance.export.workbook.readme.policies'),
      value: report.overtimePolicy.profiles.map(profile => profile.id).join(', '),
    },
    {
      field: t('schedule:attendance.export.workbook.readme.limitations'),
      value: report.overtimePolicy.limitations
        .map(code => t(`schedule:attendance.export.limitations.${code}`, { defaultValue: code }))
        .join('; '),
    },
    {
      field: t('schedule:attendance.export.workbook.readme.sources'),
      value: report.overtimePolicy.sourceUrls.join('\n'),
    },
    {
      field: t('schedule:attendance.export.workbook.readme.handoff'),
      value: t('schedule:attendance.export.workbook.readme.handoffValue'),
    },
    {
      field: t('schedule:attendance.export.workbook.readme.activeRows'),
      value: t('schedule:attendance.export.workbook.readme.activeRowsValue'),
    },
  ]);
  readme.getColumn(2).alignment = { wrapText: true, vertical: 'top' };
  readme.eachRow(row => {
    row.getCell(1).font = { bold: true, color: { argb: 'FF334155' } };
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return new Uint8Array(buffer);
}
