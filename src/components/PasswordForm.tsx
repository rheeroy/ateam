import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { authErrorText } from '../pages/Login';
import { Button, ErrorBox, Field, inputCls } from './ui';

/** 로그인된 상태에서 비밀번호 설정·변경 (메일 발송 없음) */
export function PasswordForm({ onDone, submitLabel = '비밀번호 저장' }: { onDone: () => void; submitLabel?: string }) {
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (pw.length < 8) return setErr('비밀번호는 8자 이상으로 정해 주세요.');
    if (pw !== pw2) return setErr('비밀번호 확인이 일치하지 않습니다.');
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: pw });
    setBusy(false);
    if (error) return setErr(authErrorText(error));
    setPw(''); setPw2('');
    onDone();
  }
  return (
    <form onSubmit={submit} className="space-y-3">
      <Field label="새 비밀번호"><input type="password" autoComplete="new-password" className={inputCls} value={pw} onChange={(e) => setPw(e.target.value)} placeholder="8자 이상" /></Field>
      <Field label="새 비밀번호 확인"><input type="password" autoComplete="new-password" className={inputCls} value={pw2} onChange={(e) => setPw2(e.target.value)} /></Field>
      <ErrorBox error={err} />
      <Button type="submit" loading={busy}>{submitLabel}</Button>
    </form>
  );
}
