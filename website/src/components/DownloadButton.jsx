import { useTranslation } from 'react-i18next';

import { Icon } from './Icon.jsx';
import { useLatestRelease, REPO_URL } from '../hooks/useLatestRelease.js';
import { detectOS, pickInstaller } from '../lib/pickInstaller.js';

// Smart download CTA driven by useLatestRelease. Once a real GitHub release
// exists it deep-links to the visitor's per-OS installer (mac .zip, windows
// .exe, linux .AppImage), falling back to the release page when the OS is
// unknown or has no matching asset, and to the repo ("build from source") when
// there is no release at all. SSR-safe: the hook starts in the no-release branch
// (so detectOS is never called during the prerender, only after the client
// fetch flips hasRelease), which is exactly what the prerendered first paint and
// the first hydration render show.
export function DownloadButton({ className = 'pv-btn pv-btn-primary', icon = true }) {
  const { t } = useTranslation();
  const { hasRelease, releaseUrl, assets } = useLatestRelease();

  const installerUrl = hasRelease ? pickInstaller(assets, detectOS()) : null;
  const href = installerUrl || (hasRelease ? releaseUrl : REPO_URL);
  const label = hasRelease ? t('download.release') : t('download.source');

  return (
    <a className={className} href={href} target="_blank" rel="noopener noreferrer">
      {icon && <Icon name={hasRelease ? 'download' : 'github'} size={16} />} {label}
    </a>
  );
}
