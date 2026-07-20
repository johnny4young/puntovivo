import { z } from 'zod';
import { isUrlSchemeBlocked } from '../../lib/urlSafety.js';

// vector 3 — `imageUrl` may be persisted into
// `companies.logoDataUrl` and inlined into a receipt HTML loaded by
// `printWindow.loadURL('data:text/html;...')`. A scheme like
// `javascript:` or `data:text/html,...` would fire as live HTML in
// the print window. Reject at input time so bad data never reaches
// storage; the renderer also escapes the value as a second layer.
const safeImageUrl = z
  .string()
  .url('Invalid image URL')
  .refine(value => !isUrlSchemeBlocked(value), {
    message: 'URL scheme not permitted',
  });

export const listLogosInput = z.object({
  includeInactive: z.boolean().optional(),
  search: z.string().optional(),
});

export const createLogoInput = z.object({
  name: z.string().min(1, 'Logo name is required').max(255),
  imageUrl: safeImageUrl,
  isActive: z.boolean().default(true),
});

export const updateLogoInput = z.object({
  id: z.string().min(1, 'ID is required'),
  name: z.string().min(1, 'Logo name is required').max(255).optional(),
  imageUrl: safeImageUrl.optional(),
  isActive: z.boolean().optional(),
});

export const deleteLogoInput = z.object({
  id: z.string().min(1, 'ID is required'),
});
