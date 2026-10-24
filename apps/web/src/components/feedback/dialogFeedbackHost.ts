/** Keep notification controls inside the active modal's isolation/focus boundary. */
const modalSelector = '[role="dialog"][aria-modal="true"]';
const surfaces = new Set<HTMLElement>();
const hosts = new Set<HTMLElement>();

function relocateHosts(): void {
  const dialogs = Array.from(document.querySelectorAll<HTMLElement>(modalSelector)).reverse();
  let target: HTMLElement = document.body;
  for (const dialog of dialogs) {
    const surface = Array.from(surfaces).find(
      candidate => candidate.isConnected && candidate.closest(modalSelector) === dialog
    );
    if (surface) {
      target = surface;
      break;
    }
  }
  for (const host of hosts) {
    host.toggleAttribute('data-dialog-toast-host', target !== document.body);
    if (host.parentElement !== target) target.appendChild(host);
  }
}

export function registerDialogFeedbackSurface(surface: HTMLElement): () => void {
  surfaces.add(surface);
  // Move before background isolation, so the notification host is never made inert.
  relocateHosts();
  return () => {
    surfaces.delete(surface);
    relocateHosts();
  };
}

export function registerDialogFeedbackHost(host: HTMLElement): () => void {
  hosts.add(host);
  relocateHosts();
  return () => {
    hosts.delete(host);
    host.remove();
  };
}

export function focusDialogFeedbackSurface(host: HTMLElement): void {
  const surface = host.parentElement;
  if (surface && surfaces.has(surface)) surface.focus();
}
