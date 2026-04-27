/**
 * Persists calibrated parameter overrides to a cookie. Cookies are used
 * (rather than localStorage) at the user's request — easier to inspect /
 * clear via browser dev tools and survive incognito-mode quirks the same
 * way as localStorage.
 *
 * The cookie holds a tiny JSON blob (the tuned subset of `params`) plus a
 * schema version, so future shape changes can be detected and ignored
 * gracefully.
 *
 * Limit: cookies cap around 4KB. Our payload is well under 1KB.
 */

import { params, type Parameters } from '../config/parameters.js';

const COOKIE_NAME = 'web_hand_calibration';
const COOKIE_VERSION = 1;
/** Cookie lifetime in seconds — one year. */
const COOKIE_MAX_AGE_S = 365 * 24 * 60 * 60;

interface StoredProfile {
  v: number;
  ts: number;
  pinch: { enter: number; exit: number };
  point: { indexExtendedMax: number; othersCurledMin: number };
  grab:  { enter: number; exit: number };
}

function readCookie(name: string): string | null {
  const target = `${encodeURIComponent(name)}=`;
  for (const part of document.cookie.split(';')) {
    const trimmed = part.trim();
    if (trimmed.startsWith(target)) return trimmed.slice(target.length);
  }
  return null;
}

function writeCookie(name: string, value: string): void {
  document.cookie = [
    `${encodeURIComponent(name)}=${value}`,
    `Max-Age=${COOKIE_MAX_AGE_S}`,
    'Path=/',
    'SameSite=Lax',
  ].join('; ');
}

function clearCookie(name: string): void {
  document.cookie = `${encodeURIComponent(name)}=; Max-Age=0; Path=/; SameSite=Lax`;
}

/** Snapshot the tuned subset of `params` into a profile object. */
function snapshot(): StoredProfile {
  return {
    v: COOKIE_VERSION,
    ts: Date.now(),
    pinch: { enter: params.pinch.enter, exit: params.pinch.exit },
    point: { indexExtendedMax: params.point.indexExtendedMax, othersCurledMin: params.point.othersCurledMin },
    grab:  { enter: params.grab.enter,  exit: params.grab.exit  },
  };
}

/** Apply a profile object to the live `params` singleton. */
function apply(profile: StoredProfile): void {
  const merge = <K extends keyof Parameters>(group: K, src: Partial<Parameters[K]>) => {
    Object.assign(params[group] as object, src);
  };
  merge('pinch', profile.pinch);
  merge('point', profile.point);
  merge('grab',  profile.grab);
}

export function saveCalibration(): void {
  try {
    const json = JSON.stringify(snapshot());
    writeCookie(COOKIE_NAME, encodeURIComponent(json));
  } catch (err) {
    console.warn('saveCalibration failed:', err);
  }
}

/**
 * Load saved calibration into `params`. Returns true if a valid profile
 * was applied; false if there was none or it was malformed/outdated.
 */
export function loadCalibration(): boolean {
  const raw = readCookie(COOKIE_NAME);
  if (!raw) return false;
  try {
    const decoded = decodeURIComponent(raw);
    const profile = JSON.parse(decoded) as StoredProfile;
    if (profile?.v !== COOKIE_VERSION) {
      clearCookie(COOKIE_NAME);
      return false;
    }
    apply(profile);
    return true;
  } catch {
    clearCookie(COOKIE_NAME);
    return false;
  }
}

export function clearCalibration(): void {
  clearCookie(COOKIE_NAME);
}
