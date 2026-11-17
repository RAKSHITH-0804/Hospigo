/** Full page reload (all server data re-fetched). One place so tests can replace it. */
export function reloadPage(): void {
  window.location.reload();
}
