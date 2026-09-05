/**
 * Least-privilege preload for the public-facing Customer Display window.
 *
 * Cart state and presentation preferences arrive through same-origin browser
 * storage. This preload deliberately exposes zero IPC capabilities: no
 * authentication, runtime destination, Hub, database, filesystem, updater,
 * printing, synchronization, device-write, or peripheral API crosses the
 * public-screen boundary.
 */

export {};
