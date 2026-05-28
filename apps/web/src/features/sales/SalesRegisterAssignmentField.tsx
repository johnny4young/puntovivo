import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Select, type SelectOption } from '@/components/form-controls/Select';
import type { RegisterAssignment } from '@/types';

// ENG-179b — explicit `| undefined` on optional fields.
interface SalesRegisterAssignmentFieldProps {
  assignments: RegisterAssignment[];
  selectedAssignment: RegisterAssignment | null;
  disabled?: boolean | undefined;
  onChange: (assignmentId: string | null) => void;
}

// ENG-179b — use i18next's `TFunction` directly so the call site's
// namespace-projected t flows in without a structural shim.
function getAssignmentOptionLabel(
  assignment: RegisterAssignment,
  t: TFunction
) {
  if (!assignment.isOccupied) {
    return assignment.label;
  }

  if (assignment.activeCashierName) {
    return t('cashSession.assignmentOccupiedBy', {
      label: assignment.label,
      cashier: assignment.activeCashierName,
    });
  }

  return t('cashSession.assignmentOccupiedFallback', {
    label: assignment.label,
  });
}

export function SalesRegisterAssignmentField({
  assignments,
  selectedAssignment,
  disabled = false,
  onChange,
}: SalesRegisterAssignmentFieldProps) {
  const { t } = useTranslation('sales');
  const options: SelectOption[] = assignments.map(assignment => ({
    value: assignment.id,
    label: getAssignmentOptionLabel(assignment, t),
    disabled: assignment.isOccupied,
  }));
  const helperMessage =
    assignments.length === 0
      ? t('cashSession.assignmentUnavailable')
      : selectedAssignment
        ? t('cashSession.assignmentSelectedHint')
        : t('cashSession.assignmentHint');

  return (
    <div className="space-y-2">
      <Select
        label={t('cashSession.assignmentLabel')}
        options={options}
        value={selectedAssignment?.id ?? null}
        onChange={value => {
          onChange(typeof value === 'string' ? value : null);
        }}
        placeholder={t('cashSession.assignmentPlaceholder')}
        disabled={disabled || assignments.length === 0}
        className="select-trigger"
      />
      <p className="text-sm leading-5 text-secondary-500">{helperMessage}</p>
    </div>
  );
}
