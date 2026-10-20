// 데스크톱·홈 화면 앱 설치 (PWA)
//   브라우저가 '설치할 수 있음'을 알려 주는 이벤트는 앱이 뜨기 전에 올 수 있어서, 시작할 때 받아 둔다
import { useSyncExternalStore } from 'react';

interface InstallEvent extends Event { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }

let deferred: InstallEvent | null = null;
let installed = false;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

export const isStandalone = () =>
  typeof window !== 'undefined' && (window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true);

/** 아이폰·아이패드 Safari — 설치 이벤트가 없어 '공유 → 홈 화면에 추가'로 안내 */
export const isIosSafari = () => {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) || (ua.includes('Macintosh') && navigator.maxTouchPoints > 1);
  return ios && /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
};

export function initPwa() {
  if (typeof window === 'undefined') return;
  // index.html 이 먼저 받아 둔 것
  const early = (window as Window & { __bip?: InstallEvent }).__bip;
  if (early) deferred = early;
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e as InstallEvent; emit(); });
  window.addEventListener('appinstalled', () => { installed = true; deferred = null; emit(); });
  if ('serviceWorker' in navigator && import.meta.env.PROD) {
    window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => undefined); });
  }
}

/** 설치 팝업을 다시 띄우지 않는 기간 */
const KEY = 'ateam-install-later';
export const snoozed = () => { try { return Number(localStorage.getItem(KEY) ?? 0) > Date.now(); } catch { return false; } };
export const snooze = (days: number) => { try { localStorage.setItem(KEY, String(Date.now() + days * 864e5)); } catch { /* 저장 안 돼도 이번 화면에서만 닫힘 */ } };

const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
const snap = () => (installed ? 'installed' : deferred ? 'ready' : 'none');

export function usePwaInstall() {
  const state = useSyncExternalStore(subscribe, snap, () => 'none');
  return {
    canInstall: state === 'ready' && !isStandalone(),
    installed: state === 'installed' || isStandalone(),
    ios: isIosSafari() && !isStandalone(),
    install: async () => {
      if (!deferred) return false;
      const e = deferred;
      await e.prompt();
      const { outcome } = await e.userChoice;
      deferred = null; emit();
      return outcome === 'accepted';
    },
  };
}
