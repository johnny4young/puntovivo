/**
 * Whether a downloaded update may install itself without the operator
 * asking for it.
 *
 * The update feed is a mutable GitHub Pages branch, and the only integrity
 * check inside it is a sha512 that lives in that same feed — so the feed
 * cannot vouch for itself. The real barrier is the platform's own signature
 * verification of the downloaded package, and it exists on exactly one of
 * the three targets today:
 *
 *   - macOS: Squirrel.Mac refuses a package whose code signature does not
 *     match the running app, so a forged feed entry cannot install.
 *   - Windows: electron-updater verifies the installer's Authenticode
 *     publisher, but ONLY when the build declares `win.publisherName`.
 *     Puntovivo has no signing certificate yet, so nothing is verified.
 *   - Linux: AppImage updates carry no signature check at all.
 *
 * Where nothing verifies the package, silent install turns write access to
 * the feed into code execution on every register at the next app quit.
 * Withholding the silent install does not fix that — it puts a human
 * between the feed and the install, which is the most this side of the
 * problem can do until the Windows certificate lands and this module can
 * report `verified` for win32 too.
 *
 * @module main/auto-updater/install-policy
 */

export type UpdateSignatureTrust = 'verified' | 'unverified';

export interface UpdateInstallPolicy {
  /** Package integrity is enforced by the platform before it installs. */
  signatureTrust: UpdateSignatureTrust;
  /**
   * When false, a downloaded update waits for the operator to press
   * "restart to apply" instead of installing itself on quit.
   */
  allowSilentInstall: boolean;
  /** Why, in a form safe to log. */
  reason: 'platform-verified' | 'no-publisher-identity' | 'no-signature-support';
}

export interface UpdateInstallPolicyInput {
  platform: NodeJS.Platform;
  /**
   * The Authenticode publisher the packaged build declares. Read from the
   * SAME `app-update.yml` electron-updater verifies against, so this can
   * never claim an identity the updater would not actually enforce. Null /
   * empty means the artifact is unsigned.
   */
  windowsPublisherName?: string | null | undefined;
}

export function resolveUpdateInstallPolicy(input: UpdateInstallPolicyInput): UpdateInstallPolicy {
  if (input.platform === 'darwin') {
    return {
      signatureTrust: 'verified',
      allowSilentInstall: true,
      reason: 'platform-verified',
    };
  }

  if (input.platform === 'win32') {
    const publisher = input.windowsPublisherName?.trim();
    if (publisher) {
      return {
        signatureTrust: 'verified',
        allowSilentInstall: true,
        reason: 'platform-verified',
      };
    }
    return {
      signatureTrust: 'unverified',
      allowSilentInstall: false,
      reason: 'no-publisher-identity',
    };
  }

  // Linux (AppImage) and anything else: no signature verification exists.
  return {
    signatureTrust: 'unverified',
    allowSilentInstall: false,
    reason: 'no-signature-support',
  };
}

/** The slice of electron-updater's surface this policy drives. */
export interface InstallPolicyTarget {
  autoInstallOnAppQuit: boolean;
}

/**
 * Apply the policy to the updater.
 *
 * Kept separate, and called BEFORE any fallible initialization, because
 * electron-updater defaults `autoInstallOnAppQuit` to true: if this ran
 * inside a try whose catch skipped it, a failure anywhere above would leave
 * unverified silent install quietly switched back on.
 */
export function applyInstallPolicy(target: InstallPolicyTarget, policy: UpdateInstallPolicy): void {
  target.autoInstallOnAppQuit = policy.allowSilentInstall;
}
