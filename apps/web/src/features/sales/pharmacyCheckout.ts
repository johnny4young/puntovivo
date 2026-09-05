export interface EligiblePharmacyEvidence {
  id: string;
  remainingQuantity: number;
}

export interface PharmacyCheckoutRequirement {
  productId: string;
  productName: string;
  classification: 'otc' | 'prescription' | 'controlled';
  requestedQuantity: number;
  policyVersion: string;
  evidenceRequired: boolean;
  professionalApprovalRequired: boolean;
  blockedErrorCode: string | null;
  eligibleEvidence: EligiblePharmacyEvidence[];
  reapprovalEvidence?: Array<{
    id: string;
    reasonCode: 'PHARMACY_AUTHORIZATION_NOT_EFFECTIVE' | 'PHARMACY_AUTHORIZATION_INVALID';
  }>;
}

const QUANTITY_EPSILON = 1e-9;

export function selectedEvidenceCoversRequirement(
  requirement: PharmacyCheckoutRequirement,
  selectedIds: readonly string[]
): boolean {
  if (requirement.blockedErrorCode !== null || !requirement.evidenceRequired) return false;
  const selected = new Set(selectedIds);
  const selectedQuantity = requirement.eligibleEvidence.reduce(
    (sum, evidence) => (selected.has(evidence.id) ? sum + evidence.remainingQuantity : sum),
    0
  );
  return selectedQuantity + QUANTITY_EPSILON >= requirement.requestedQuantity;
}

export function selectedEvidenceCoversRequirements(
  requirements: readonly PharmacyCheckoutRequirement[],
  selectedIds: readonly string[]
): boolean {
  return requirements.every(requirement => {
    if (requirement.blockedErrorCode !== null) return false;
    if (!requirement.evidenceRequired) return true;
    return selectedEvidenceCoversRequirement(requirement, selectedIds);
  });
}

export function retainEligibleEvidenceIds(
  requirements: readonly PharmacyCheckoutRequirement[],
  selectedIds: readonly string[]
): string[] {
  const selected = new Set(selectedIds);
  const retained: string[] = [];

  for (const requirement of requirements) {
    if (requirement.blockedErrorCode !== null || !requirement.evidenceRequired) continue;

    let selectedQuantity = 0;
    for (const evidence of requirement.eligibleEvidence) {
      if (!selected.has(evidence.id)) continue;
      if (selectedQuantity + QUANTITY_EPSILON >= requirement.requestedQuantity) break;

      retained.push(evidence.id);
      selectedQuantity += evidence.remainingQuantity;
    }
  }

  return retained;
}
