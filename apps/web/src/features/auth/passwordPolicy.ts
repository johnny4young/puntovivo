export type PasswordRequirementKey =
  | 'minLength'
  | 'uppercase'
  | 'lowercase'
  | 'number'
  | 'specialCharacter';

export function getPasswordRequirementKey(password: string): PasswordRequirementKey | null {
  if (password.length < 12) {
    return 'minLength';
  }

  if (!/[A-Z]/.test(password)) {
    return 'uppercase';
  }

  if (!/[a-z]/.test(password)) {
    return 'lowercase';
  }

  if (!/[0-9]/.test(password)) {
    return 'number';
  }

  if (!/[^A-Za-z0-9]/.test(password)) {
    return 'specialCharacter';
  }

  return null;
}

export function getPasswordRequirementMessage(
  password: string,
  translate: (key: PasswordRequirementKey) => string
): string | null {
  const requirementKey = getPasswordRequirementKey(password);
  return requirementKey ? translate(requirementKey) : null;
}
