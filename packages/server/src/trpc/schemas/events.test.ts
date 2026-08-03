import { describe, expect, it } from 'vitest';
import { createWebhookSubscriptionInput } from './events.js';

const validInput = {
  name: 'ERP production',
  destinationUrl: 'https://hooks.example.com/puntovivo',
  eventTypes: ['sale.completed'] as const,
};

describe('createWebhookSubscriptionInput', () => {
  it('accepts a destination that matches the webhook transport contract', () => {
    expect(createWebhookSubscriptionInput.safeParse(validInput).success).toBe(true);
  });

  it.each([
    'http://hooks.example.com/puntovivo',
    'https://operator:secret@hooks.example.com/puntovivo',
    'https://hooks.example.com:8443/puntovivo',
    'https://hooks.example.com/puntovivo#latest',
    'https://localhost/puntovivo',
  ])('rejects unsupported destination %s at the input boundary', destinationUrl => {
    const result = createWebhookSubscriptionInput.safeParse({ ...validInput, destinationUrl });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual(
        expect.arrayContaining([expect.objectContaining({ path: ['destinationUrl'] })])
      );
    }
  });
});
