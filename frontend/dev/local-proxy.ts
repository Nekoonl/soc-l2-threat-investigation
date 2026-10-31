/** Rewrite only a same-origin request from our fixed loopback Vite ports.
 * Foreign origins stay unchanged so the backend can reject them.
 */
export function isLocalFrontendOrigin(origin: string | undefined, host: string | undefined): boolean {
  const hosts = ['127.0.0.1:5173', 'localhost:5173', '127.0.0.1:4173', 'localhost:4173'];
  return Boolean(host && hosts.includes(host) && origin === `http://${host}`);
}
