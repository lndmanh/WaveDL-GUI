/**
 * Removes the protocol (http://, https://, ftp://, etc.) from a URL string
 * @param url - The URL string to process
 * @returns The URL without the protocol
 */
export function removeProtocol(url: string): string {
  return url.replace(/^[a-z][a-z\d+\-.]*:\/\//i, '');
}
