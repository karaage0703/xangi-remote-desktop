export function readConfig(env = process.env) {
  const raw = env.REMOTE_DESKTOP_VNC_PORT?.trim() || '';
  if (raw && (!/^\d+$/.test(raw) || Number(raw) < 1 || Number(raw) > 65535)) {
    throw new Error('REMOTE_DESKTOP_VNC_PORT must be an integer from 1 to 65535');
  }
  return { host: '127.0.0.1', port: raw ? Number(raw) : null };
}
