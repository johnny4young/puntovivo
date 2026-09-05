import { WorkforceEmployeePicker } from './WorkforceEmployeePicker';
/** The absence flow retains its authorized query/cache namespace. */
export function TimeOffEmployeePicker(props: {
  value: string;
  onChange: (id: string) => void;
  disabled: boolean;
}) {
  return <WorkforceEmployeePicker {...props} domain="timeOff" />;
}
