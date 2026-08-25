import { describe, expect, it } from 'vitest';
import {
  buildCompanyGuidedSteps,
  findNextRequiredSection,
  findGuidedStepForSection,
  isCompanyGuidedStepId,
  resolveInitialGuidedStep,
  type CompanyReadinessSection,
} from './companyGuidedSetup';

function section(
  id: CompanyReadinessSection['id'],
  status: CompanyReadinessSection['status'],
  route = '/company',
  tab?: string
): CompanyReadinessSection {
  return {
    id,
    status,
    cta:
      status === 'not-applicable'
        ? null
        : { route, ...(tab ? { tab } : {}) },
  };
}

describe('companyGuidedSetup', () => {
  it('reduces the readiness matrix to six operator-facing steps', () => {
    const steps = buildCompanyGuidedSteps([
      section('businessType', 'ready', '/company', 'readiness'),
      section('locale', 'ready', '/company', 'locale'),
      section('sites', 'ready', '/sites'),
      section('users', 'optional-pending', '/users'),
      section('catalog', 'ready', '/products'),
      section('cashSession', 'optional-pending', '/sales'),
      section('fiscal', 'not-applicable'),
      section('payments', 'optional-pending', '/company', 'payments'),
      section('peripherals', 'optional-pending', '/peripherals'),
    ]);

    expect(steps.map(step => step.id)).toEqual([
      'businessType',
      'business',
      'selling',
      'fiscal',
      'payments',
      'devices',
    ]);
    expect(steps.map(step => step.status)).toEqual([
      'ready',
      'ready',
      'ready',
      'not-applicable',
      'optional',
      'optional',
    ]);
    expect(steps.find(step => step.id === 'selling')?.cta).toEqual({
      route: '/sales',
    });
  });

  it('selects one required decision in stable operating order', () => {
    const sections = [
      section('catalog', 'blocker', '/products'),
      section('sites', 'blocker', '/sites'),
      section('locale', 'blocker', '/company', 'locale'),
      section('fiscal', 'blocker', '/company', 'fiscal'),
    ];

    const nextRequired = findNextRequiredSection(sections);
    const steps = buildCompanyGuidedSteps(sections);

    expect(nextRequired?.id).toBe('locale');
    expect(resolveInitialGuidedStep(steps, nextRequired)).toBe('business');
    expect(steps.find(step => step.id === 'business')?.nextSection?.id).toBe(
      'locale'
    );
  });

  it('promotes warnings before optional configuration when no blocker remains', () => {
    const steps = buildCompanyGuidedSteps([
      section('locale', 'ready', '/company', 'locale'),
      section('sites', 'ready', '/sites'),
      section('catalog', 'ready', '/products'),
      section('fiscal', 'warning', '/company', 'fiscal'),
      section('payments', 'optional-pending', '/company', 'payments'),
    ]);

    expect(resolveInitialGuidedStep(steps, null)).toBe('fiscal');
    expect(steps.find(step => step.id === 'fiscal')?.status).toBe('warning');
  });

  it('keeps an empty readiness payload deterministic', () => {
    const steps = buildCompanyGuidedSteps([]);

    expect(steps).toHaveLength(6);
    expect(findNextRequiredSection([])).toBeNull();
    expect(resolveInitialGuidedStep(steps, null)).toBe('businessType');
  });

  it('rejects invalid guided step ids and leaves expert-only sections ungrouped', () => {
    expect(isCompanyGuidedStepId('devices')).toBe(true);
    expect(isCompanyGuidedStepId('ai')).toBe(false);
    expect(isCompanyGuidedStepId(null)).toBe(false);
    expect(findGuidedStepForSection('modules')).toBeNull();
  });
});
