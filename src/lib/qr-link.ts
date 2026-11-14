/** Only accept the existing claim route on this shop; never navigate to arbitrary QR URLs. */
export function streakQrPath(raw: string, origin: string): string | null {
  try {
    const url = new URL(raw.trim(), origin);
    return url.origin === origin &&
      !url.username &&
      !url.password &&
      /^\/q\/[a-f0-9]{64}$/i.test(url.pathname)
      ? url.pathname
      : null;
  } catch {
    return null;
  }
}
