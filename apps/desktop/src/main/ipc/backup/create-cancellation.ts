/** Bounded state machine for one cancellable manual backup at a time. */
export class BackupCreateCancellation {
  #active: AbortController | null = null;

  begin(): AbortController | null {
    if (this.#active) return null;
    this.#active = new AbortController();
    return this.#active;
  }

  cancel(): boolean {
    if (!this.#active || this.#active.signal.aborted) return false;
    this.#active.abort();
    return true;
  }

  finish(controller: AbortController): void {
    if (this.#active === controller) this.#active = null;
  }
}

export const backupCreateCancellation = new BackupCreateCancellation();
