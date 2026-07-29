import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@puntovivo/server';

export type CompanyReadiness =
  inferRouterOutputs<AppRouter>['setupReadiness']['get'];
export type CompanyReadinessSection = CompanyReadiness['sections'][number];
export type CompanyReadinessStatus = CompanyReadinessSection['status'];

export const COMPANY_GUIDED_STEP_IDS = [
  'business',
  'selling',
  'fiscal',
  'payments',
  'devices',
] as const;

export type CompanyGuidedStepId = (typeof COMPANY_GUIDED_STEP_IDS)[number];
export type CompanyGuidedStepStatus =
  | 'ready'
  | 'blocker'
  | 'warning'
  | 'optional'
  | 'not-applicable';

interface GuidedStepDefinition {
  id: CompanyGuidedStepId;
  sectionIds: readonly CompanyReadinessSection['id'][];
  optionalAffectsStatus: boolean;
  fallbackCta: { route: string; tab?: string };
}

const GUIDED_STEP_DEFINITIONS: readonly GuidedStepDefinition[] = [
  {
    id: 'business',
    sectionIds: ['locale', 'sites', 'users'],
    optionalAffectsStatus: false,
    fallbackCta: { route: '/company', tab: 'general' },
  },
  {
    id: 'selling',
    sectionIds: ['catalog', 'cashSession'],
    optionalAffectsStatus: false,
    fallbackCta: { route: '/sales' },
  },
  {
    id: 'fiscal',
    sectionIds: ['fiscal'],
    optionalAffectsStatus: true,
    fallbackCta: { route: '/company', tab: 'fiscal' },
  },
  {
    id: 'payments',
    sectionIds: ['payments'],
    optionalAffectsStatus: true,
    fallbackCta: { route: '/company', tab: 'payments' },
  },
  {
    id: 'devices',
    sectionIds: ['peripherals'],
    optionalAffectsStatus: true,
    fallbackCta: { route: '/peripherals' },
  },
];

const REQUIRED_SECTION_ORDER: readonly CompanyReadinessSection['id'][] = [
  'locale',
  'sites',
  'catalog',
  'fiscal',
];

export interface CompanyGuidedStep {
  id: CompanyGuidedStepId;
  status: CompanyGuidedStepStatus;
  sections: CompanyReadinessSection[];
  nextSection: CompanyReadinessSection | null;
  cta: { route: string; tab?: string };
}

function resolveStepStatus(
  sections: CompanyReadinessSection[],
  optionalAffectsStatus: boolean
): CompanyGuidedStepStatus {
  if (sections.some(section => section.status === 'blocker')) {
    return 'blocker';
  }
  if (sections.some(section => section.status === 'warning')) {
    return 'warning';
  }
  if (sections.length > 0 && sections.every(section => section.status === 'not-applicable')) {
    return 'not-applicable';
  }
  if (
    optionalAffectsStatus &&
    sections.some(section => section.status === 'optional-pending')
  ) {
    return 'optional';
  }
  return 'ready';
}

function resolveNextSection(
  sections: CompanyReadinessSection[],
  optionalAffectsStatus: boolean
): CompanyReadinessSection | null {
  return (
    sections.find(section => section.status === 'blocker') ??
    sections.find(section => section.status === 'warning') ??
    (optionalAffectsStatus
      ? sections.find(section => section.status === 'optional-pending')
      : undefined) ??
    null
  );
}

export function buildCompanyGuidedSteps(
  sections: CompanyReadinessSection[]
): CompanyGuidedStep[] {
  return GUIDED_STEP_DEFINITIONS.map(definition => {
    const stepSections = definition.sectionIds
      .map(id => sections.find(section => section.id === id))
      .filter((section): section is CompanyReadinessSection => section !== undefined);
    const nextSection = resolveNextSection(
      stepSections,
      definition.optionalAffectsStatus
    );

    return {
      id: definition.id,
      status: resolveStepStatus(stepSections, definition.optionalAffectsStatus),
      sections: stepSections,
      nextSection,
      cta: nextSection?.cta ?? definition.fallbackCta,
    };
  });
}

export function findNextRequiredSection(
  sections: CompanyReadinessSection[]
): CompanyReadinessSection | null {
  for (const id of REQUIRED_SECTION_ORDER) {
    const section = sections.find(candidate => candidate.id === id);
    if (section?.status === 'blocker') {
      return section;
    }
  }
  return sections.find(section => section.status === 'blocker') ?? null;
}

export function findGuidedStepForSection(
  sectionId: CompanyReadinessSection['id']
): CompanyGuidedStepId | null {
  return (
    GUIDED_STEP_DEFINITIONS.find(definition =>
      definition.sectionIds.includes(sectionId)
    )?.id ?? null
  );
}

export function resolveInitialGuidedStep(
  steps: CompanyGuidedStep[],
  nextRequired: CompanyReadinessSection | null
): CompanyGuidedStepId {
  if (nextRequired) {
    return findGuidedStepForSection(nextRequired.id) ?? 'business';
  }
  return (
    steps.find(step => step.status === 'warning')?.id ??
    steps.find(step => step.status === 'optional')?.id ??
    'business'
  );
}

export function isCompanyGuidedStepId(
  value: string | null
): value is CompanyGuidedStepId {
  return (
    value !== null &&
    (COMPANY_GUIDED_STEP_IDS as readonly string[]).includes(value)
  );
}
