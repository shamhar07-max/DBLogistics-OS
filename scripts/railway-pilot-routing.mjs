export function targetFor(host, url, portalHost) {
  const name = (host || '').split(':')[0].toLowerCase();
  if (portalHost && name === portalHost.toLowerCase()) return 3102;
  return 3100;
}
