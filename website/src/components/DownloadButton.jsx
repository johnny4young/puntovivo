import { useTranslation } from 'react-i18next';

import { Icon } from './Icon.jsx';
import { useLatestRelease, REPO_URL } from '../hooks/useLatestRelease.js';

// Smart download CTA driven by useLatestRelease. There are no releases today,
// so this links to the repo and reads "build from source"; once a real GitHub
// release exists it links to the installer (or the releases page) and reads
// "download". The component is render-safe for SSR: it reads only the hook
// state (no window / localStorage) and starts in the no-release branch, which
// is exactly what the prerendered first paint shows.
export function DownloadButton({ className = 'pv-btn pv-btn-primary', icon = true }) {
  const { t } = useTranslation();
  const { hasRelease, releaseUrl } = useLatestRelease();

  const href = hasRelease ? releaseUrl : REPO_URL;
  const label = hasRelease ? t('download.release') : t('download.source');

  return (
    <a className={className} href={href} target="_blank" rel="noopener noreferrer">
      {icon && <Icon name={hasRelease ? 'download' : 'github'} size={16} />} {label}
    </a>
  );
}
