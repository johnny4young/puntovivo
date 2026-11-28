const ACCEPTED_MIME = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'] as const;
export type AcceptedPurchaseDocumentMime = (typeof ACCEPTED_MIME)[number];

export const PURCHASE_DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;
export const PURCHASE_IMAGE_MAX_LONG_SIDE_PX = 1600;
export const PURCHASE_IMAGE_QUALITY = 0.8;

const dataUrlPrefix = /^data:[^;]+;base64,/;

export function isAcceptedPurchaseDocumentMime(
  mimeType: string
): mimeType is AcceptedPurchaseDocumentMime {
  return ACCEPTED_MIME.includes(mimeType as AcceptedPurchaseDocumentMime);
}

export function getAcceptedPurchaseDocumentMimes(): readonly AcceptedPurchaseDocumentMime[] {
  return ACCEPTED_MIME;
}

function replaceExtension(fileName: string, mimeType: 'image/webp' | 'image/jpeg'): string {
  const ext = mimeType === 'image/webp' ? '.webp' : '.jpg';
  const stripped = fileName.replace(/\.[^./\\]+$/, '');
  return `${stripped || 'document'}${ext}`;
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(dataUrlPrefix, ''));
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read document'));
    reader.readAsDataURL(blob);
  });
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  mimeType: 'image/webp' | 'image/jpeg',
  quality: number
): Promise<Blob | null> {
  return new Promise(resolve => {
    canvas.toBlob(blob => resolve(blob), mimeType, quality);
  });
}

/**
 * Downscales images to at most 1600 px on the long side and encodes them as
 * WebP (falling back to JPEG) before upload. PDFs pass through unchanged.
 */
async function compressImageIfNeeded(
  file: File
): Promise<{ blob: Blob; mimeType: AcceptedPurchaseDocumentMime; fileName: string }> {
  if (
    typeof createImageBitmap !== 'function' ||
    typeof document === 'undefined' ||
    typeof document.createElement !== 'function'
  ) {
    return {
      blob: file,
      mimeType: file.type as AcceptedPurchaseDocumentMime,
      fileName: file.name,
    };
  }

  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(file);
    const longSide = Math.max(bitmap.width, bitmap.height);
    const scale =
      longSide > PURCHASE_IMAGE_MAX_LONG_SIDE_PX ? PURCHASE_IMAGE_MAX_LONG_SIDE_PX / longSide : 1;
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) {
      return {
        blob: file,
        mimeType: file.type as AcceptedPurchaseDocumentMime,
        fileName: file.name,
      };
    }

    context.drawImage(bitmap, 0, 0, width, height);

    let encoded = await canvasToBlob(canvas, 'image/webp', PURCHASE_IMAGE_QUALITY);
    let targetMime: 'image/webp' | 'image/jpeg' = 'image/webp';
    if (!encoded || encoded.type !== 'image/webp') {
      encoded = await canvasToBlob(canvas, 'image/jpeg', PURCHASE_IMAGE_QUALITY);
      targetMime = 'image/jpeg';
    }
    if (!encoded || encoded.size === 0) {
      return {
        blob: file,
        mimeType: file.type as AcceptedPurchaseDocumentMime,
        fileName: file.name,
      };
    }

    // Keep original if no resize occurred and re-encoding grew the file.
    if (scale === 1 && encoded.size >= file.size) {
      return {
        blob: file,
        mimeType: file.type as AcceptedPurchaseDocumentMime,
        fileName: file.name,
      };
    }

    return {
      blob: encoded,
      mimeType: targetMime,
      fileName: replaceExtension(file.name, targetMime),
    };
  } finally {
    bitmap?.close();
  }
}

export interface PreparedPurchaseDocument {
  fileName: string;
  mimeType: AcceptedPurchaseDocumentMime;
  documentBase64: string;
  sizeBytes: number;
}

export async function preparePurchaseDocumentFile(file: File): Promise<PreparedPurchaseDocument> {
  if (!isAcceptedPurchaseDocumentMime(file.type)) {
    throw new Error('UNSUPPORTED_MIME');
  }

  const prepared =
    file.type === 'application/pdf'
      ? { blob: file as Blob, mimeType: file.type, fileName: file.name }
      : await compressImageIfNeeded(file);

  if (prepared.blob.size === 0 || prepared.blob.size > PURCHASE_DOCUMENT_MAX_BYTES) {
    throw new Error('DOCUMENT_TOO_LARGE');
  }

  const documentBase64 = await blobToBase64(prepared.blob);
  return {
    fileName: prepared.fileName,
    mimeType: prepared.mimeType,
    documentBase64,
    sizeBytes: prepared.blob.size,
  };
}
