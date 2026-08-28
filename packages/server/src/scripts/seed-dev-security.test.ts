import { afterEach, describe, expect, it } from 'vitest';

import { computeAuditHeadMac, configureAuditAnchorKey } from '../services/audit-anchor.js';
import { configureDevSeedAuditAnchor } from './seed-dev-security.js';

describe('developer seed audit-anchor lifecycle', () => {
  afterEach(() => configureAuditAnchorKey(undefined));

  it('derives the same anchored-head capability from the database key and releases it', () => {
    const release = configureDevSeedAuditAnchor('8'.repeat(64));

    const seededHeadMac = computeAuditHeadMac('tenant-a', 'head-a');
    expect(seededHeadMac).toMatch(/^[a-f0-9]{64}$/);

    release();
    expect(computeAuditHeadMac('tenant-a', 'head-a')).toBeNull();

    const releaseReopenedServer = configureDevSeedAuditAnchor('8'.repeat(64));
    expect(computeAuditHeadMac('tenant-a', 'head-a')).toBe(seededHeadMac);
    releaseReopenedServer();
  });

  it('keeps intentionally unencrypted development seeds unanchored', () => {
    const release = configureDevSeedAuditAnchor(undefined);

    expect(computeAuditHeadMac('tenant-a', 'head-a')).toBeNull();

    release();
  });
});
