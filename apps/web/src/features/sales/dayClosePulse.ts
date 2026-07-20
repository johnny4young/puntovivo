/** client-only, aggregate-only daily pulse image and share helpers. */

const PULSE_IMAGE_SIZE = 1_200;
const PULSE_IMAGE_TYPE = 'image/png';
const PULSE_IMAGE_QUALITY = 0.92;

export interface DayClosePulseCardModel {
  brand: string;
  title: string;
  date: string;
  salesLabel: string;
  salesValue: string;
  salesDetail: string;
  marginLabel: string;
  marginValue: string;
  marginDetail: string;
  averageTicketLabel: string;
  averageTicketValue: string;
  comparisonLabel: string;
  comparisonValue: string;
  privacyNote: string;
}

export type PulseComparisonDirection = 'up' | 'down' | 'flat' | 'unavailable';

export function pulseComparisonDirection(value: number | null): PulseComparisonDirection {
  if (value === null) return 'unavailable';
  if (value > 0) return 'up';
  if (value < 0) return 'down';
  return 'flat';
}

/** The model intentionally has no customer, cashier, register, or product
 * fields, keeping both the text and generated image free from customer PII. */
export function buildDayClosePulseText(model: DayClosePulseCardModel): string {
  return [
    `${model.title} · ${model.date}`,
    `${model.salesLabel}: ${model.salesValue} (${model.salesDetail})`,
    `${model.marginLabel}: ${model.marginValue} (${model.marginDetail})`,
    `${model.averageTicketLabel}: ${model.averageTicketValue}`,
    `${model.comparisonLabel}: ${model.comparisonValue}`,
    '',
    model.brand,
  ].join('\n');
}

export function buildDayCloseWhatsAppUrl(model: DayClosePulseCardModel): string {
  return `https://wa.me/?text=${encodeURIComponent(buildDayClosePulseText(model))}`;
}

function drawMetric(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  label: string,
  value: string,
  detail?: string
): void {
  context.fillStyle = '#1f2937';
  context.fillRect(x, y, 480, 190);
  context.fillStyle = '#9ca3af';
  context.font = '600 24px system-ui, sans-serif';
  context.fillText(label.toUpperCase(), x + 36, y + 48);
  context.fillStyle = '#ffffff';
  context.font = '700 52px system-ui, sans-serif';
  context.fillText(value, x + 36, y + 112, 408);
  if (detail) {
    context.fillStyle = '#d1d5db';
    context.font = '400 22px system-ui, sans-serif';
    context.fillText(detail, x + 36, y + 154, 408);
  }
}

function drawWrappedText(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number
): void {
  const words = text.split(/\s+/);
  let line = '';
  let lineY = y;
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && context.measureText(candidate).width > maxWidth) {
      context.fillText(line, x, lineY);
      line = word;
      lineY += lineHeight;
    } else {
      line = candidate;
    }
  }
  if (line) context.fillText(line, x, lineY);
}

function drawComparison(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  label: string,
  value: string
): void {
  context.fillStyle = '#1f2937';
  context.fillRect(x, y, 480, 190);
  context.fillStyle = '#9ca3af';
  context.font = '600 24px system-ui, sans-serif';
  context.fillText(label.toUpperCase(), x + 36, y + 48);
  context.fillStyle = '#e5e7eb';
  context.font = '600 25px system-ui, sans-serif';
  drawWrappedText(context, value, x + 36, y + 96, 408, 34);
}

/** Renders a square social card entirely in the sandboxed renderer. No DOM
 * capture library or server upload is involved. */
export async function createDayClosePulsePng(model: DayClosePulseCardModel): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = PULSE_IMAGE_SIZE;
  canvas.height = PULSE_IMAGE_SIZE;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas 2D context is unavailable');

  const background = context.createLinearGradient(0, 0, PULSE_IMAGE_SIZE, PULSE_IMAGE_SIZE);
  background.addColorStop(0, '#0b1220');
  background.addColorStop(1, '#111827');
  context.fillStyle = background;
  context.fillRect(0, 0, PULSE_IMAGE_SIZE, PULSE_IMAGE_SIZE);

  context.fillStyle = '#2dd4bf';
  context.font = '700 24px system-ui, sans-serif';
  context.fillText(model.brand.toUpperCase(), 90, 92);
  context.fillStyle = '#ffffff';
  context.font = '700 66px system-ui, sans-serif';
  context.fillText(model.title, 90, 178, 1_020);
  context.fillStyle = '#9ca3af';
  context.font = '400 28px system-ui, sans-serif';
  context.fillText(model.date, 90, 226);

  drawMetric(context, 90, 286, model.salesLabel, model.salesValue, model.salesDetail);
  drawMetric(context, 630, 286, model.marginLabel, model.marginValue, model.marginDetail);
  drawMetric(context, 90, 512, model.averageTicketLabel, model.averageTicketValue);
  drawComparison(context, 630, 512, model.comparisonLabel, model.comparisonValue);

  context.fillStyle = '#6b7280';
  context.font = '400 21px system-ui, sans-serif';
  drawWrappedText(context, model.privacyNote, 90, 1_055, 1_020, 30);

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      blob => {
        if (blob) resolve(blob);
        else reject(new Error('The browser could not encode the pulse image'));
      },
      PULSE_IMAGE_TYPE,
      PULSE_IMAGE_QUALITY
    );
  });
}
