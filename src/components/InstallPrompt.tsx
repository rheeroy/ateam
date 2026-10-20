// 앱 설치 팝업 (로그인 후 화면 오른쪽 아래) · 설정 화면의 설치 버튼
import { useEffect, useState } from 'react';
import { Download, Share, X } from 'lucide-react';
import { snooze, snoozed, usePwaInstall } from '../lib/pwa';
import { Button, useToast } from './ui';
import { LogoBlock } from './Brand';

export function InstallPrompt() {
  const { canInstall, ios, install } = usePwaInstall();
  const toast = useToast();
  const [show, setShow] = useState(false);
  const want = (canInstall || ios) && !snoozed();
  useEffect(() => {
    if (!want) { setShow(false); return; }
    const t = setTimeout(() => setShow(true), 4000);
    return () => clearTimeout(t);
  }, [want]);
  if (!show) return null;
  const later = () => { snooze(14); setShow(false); };
  return (
    <div role="dialog" aria-label="앱 설치" className="fixed z-50 right-4 bottom-24 md:bottom-6 left-4 md:left-auto md:w-[340px] rounded-2xl bg-white shadow-2xl ring-1 ring-slate-200 p-4">
      <button onClick={later} className="absolute top-3 right-3 text-slate-400 hover:text-slate-700" aria-label="닫기"><X size={16} /></button>
      <div className="flex items-start gap-3 pr-5">
        <LogoBlock size={40} />
        <div className="min-w-0">
          <div className="font-semibold text-slate-900">ATEAM을 앱으로 설치하세요</div>
          <p className="mt-0.5 text-[13px] text-slate-500 leading-snug">
            {ios ? <>아래 <Share size={12} className="inline -mt-0.5" /> 공유 버튼을 누르고 <b className="text-slate-700">홈 화면에 추가</b>를 고르면 앱처럼 열립니다.</>
              : window.matchMedia?.('(max-width: 767px)').matches ? '홈 화면에서 앱처럼 바로 엽니다.' : '바탕화면·작업표시줄에서 바로 열고, 브라우저 탭 사이에서 찾지 않아도 됩니다.'}
          </p>
        </div>
      </div>
      {!ios && (
        <div className="mt-3 flex gap-2">
          <Button className="flex-1" onClick={async () => { const ok = await install(); setShow(false); if (ok) toast('ATEAM을 설치했습니다'); else snooze(14); }}><Download size={14} />설치</Button>
          <Button variant="ghost" onClick={later}>나중에</Button>
        </div>
      )}
    </div>
  );
}

/** 설정 화면용 — 설치할 수 있을 때만 보인다 */
export function InstallButton() {
  const { canInstall, installed, ios, install } = usePwaInstall();
  const toast = useToast();
  if (installed) return <p className="text-sm text-slate-500">앱으로 설치되어 있습니다.</p>;
  if (ios) return <p className="text-sm text-slate-600">Safari 아래 <Share size={13} className="inline -mt-0.5" /> 공유 버튼 → <b>홈 화면에 추가</b>로 설치할 수 있습니다.</p>;
  if (!canInstall) return <p className="text-sm text-slate-500">Chrome·Edge는 주소창 오른쪽 설치 아이콘, Mac Safari는 파일 메뉴 → Dock에 추가로 설치할 수 있습니다.</p>;
  return <Button variant="soft" onClick={async () => { if (await install()) toast('ATEAM을 설치했습니다'); }}><Download size={14} />데스크톱 앱으로 설치</Button>;
}
