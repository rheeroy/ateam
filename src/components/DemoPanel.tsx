// 데모 팀: 팀원이 있는 가상 팀을 만들고, 팀원 계정으로 새 탭에서 로그인해 팀원 화면을 체험한다
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, Copy, ExternalLink, FlaskConical, KeyRound, Trash2, Users } from 'lucide-react';
import { useSession } from '../state/session';
import { supabase, q, invoke, errorText } from '../lib/supabase';
import type { DemoAccount } from '../lib/types';
import { Avatar, Button, Card, CardHead, ErrorBox, useToast } from './ui';

/** 페르소나별로 로그인하면 바로 해 볼 수 있는 것 */
export const DEMO_SCENARIO: Record<string, { job: string; try: string }> = {
  jung: { job: '사업개발', try: '팀장 요청 "하위 과제 계획 세워 주세요" → 내 목표·과제에서 AI 초안으로 계획 올리기' },
  park: { job: '데이터 분석', try: '팀장 요청 "대시보드 캡처 공유" → 공유하기에서 캡처·파일 올리기' },
  lee: { job: '영업기획', try: '이번 주 체크인 미제출 → 체크인 쓰기 · 올린 계획이 검토 대기' },
  kim: { job: '기획', try: '기획서 v3 리뷰 중 → 팀장 코멘트 보고 새 버전 올리기 · 오늘 1:1' },
  han: { job: '기획 (신규)', try: '입사 6주차 신규 → 진척 업데이트 요청에 답하기' },
  choi: { job: 'HR 기획', try: '온보딩 개선안 리뷰 중 → 체크인과 진척 입력' },
};
const ORDER = ['jung', 'park', 'lee', 'kim', 'han', 'choi'];

export function useDemoTeam() {
  const { memberships } = useSession();
  return memberships.find((m) => m.role === 'leader' && m.teams?.is_demo)?.teams ?? null;
}

/** 팀원으로 로그인: 팝업 차단을 피하려고 클릭 순간 탭을 먼저 연다 */
export async function openAsMember(userId: string) {
  const w = window.open('', '_blank');
  try {
    const r = await invoke<{ token_hash: string }>('demo-team', { action: 'login_link', user_id: userId });
    const url = `/demo-login?th=${encodeURIComponent(r.token_hash)}`;
    if (w) w.location.href = url; else window.location.href = url;
  } catch (e) {
    w?.close();
    throw e;
  }
}

/** 실제 팀에서 보이는 카드: 데모 팀 만들기 / 데모 팀으로 가기 */
export function DemoStart({ compact }: { compact?: boolean }) {
  const demo = useDemoTeam();
  const { setTeamId, refresh } = useSession();
  const nav = useNavigate();
  const qc = useQueryClient();
  const create = useMutation({
    mutationFn: () => invoke<{ team_id: string }>('demo-team', { action: 'create' }),
    onSuccess: async (r) => {
      setTeamId(r.team_id);
      refresh();
      await qc.invalidateQueries({ queryKey: ['memberships'] });
      nav('/team');
    },
  });
  const go = () => { if (demo) { setTeamId(demo.id); nav('/team'); } };

  return (
    <Card className={compact ? '' : 'border-violet-200'}>
      <div className="p-5 flex flex-col sm:flex-row sm:items-center gap-4">
        <div className="w-10 h-10 rounded-xl bg-violet-50 text-violet-600 flex items-center justify-center shrink-0"><FlaskConical size={20} /></div>
        <div className="flex-1 min-w-0">
          <div className="font-semibold">팀원이 있는 데모 팀으로 체험하기</div>
          <p className="text-sm text-slate-500 mt-0.5 leading-relaxed">
            팀원 6명과 6개월치 체크인·목표·결과물·1:1 기록이 있는 가상 팀을 <b className="text-slate-700">따로</b> 만듭니다.
            팀원 계정으로 새 탭에서 로그인해 계획 올리기·공유하기도 해 볼 수 있어요. 지금 팀에는 영향이 없고, 언제든 지울 수 있습니다.
          </p>
          <ErrorBox error={create.error ? errorText(create.error) : null} />
        </div>
        {demo
          ? <Button variant="soft" onClick={go}>데모 팀으로 가기</Button>
          : <Button onClick={() => create.mutate()} loading={create.isPending}>{create.isPending ? '만드는 중… (20초 정도)' : '데모 팀 만들기'}</Button>}
      </div>
    </Card>
  );
}

/** 데모 팀에서 보이는 카드: 팀원으로 로그인 */
export function DemoMembers() {
  const { team, memberships, members, setTeamId } = useSession();
  const toast = useToast();
  const [showPw, setShowPw] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [opening, setOpening] = useState<string | null>(null);
  const accounts = useQuery({
    queryKey: ['demo-accounts', team?.id],
    enabled: !!team?.is_demo,
    queryFn: () => q<DemoAccount[]>(supabase.from('demo_accounts').select('*').eq('team_id', team!.id).order('sort')),
  });
  const names = new Map(members.map((m) => [m.user_id, m.profiles?.full_name ?? '']));
  const del = useMutation({
    mutationFn: () => invoke('demo-team', { action: 'delete' }),
    onSuccess: () => {
      // 지운 팀을 가리키는 캐시가 남지 않도록 실제 팀으로 새로 연다
      const real = memberships.find((m) => !m.teams?.is_demo);
      if (real) setTeamId(real.team_id);
      window.location.href = real ? '/' : '/onboarding';
    },
    onError: (e) => toast(errorText(e)),
  });
  if (!team?.is_demo) return null;

  const list = [...(accounts.data ?? [])].sort((a, b) => ORDER.indexOf(a.persona) - ORDER.indexOf(b.persona));
  const copy = (t: string) => { navigator.clipboard?.writeText(t).then(() => toast('복사했습니다')).catch(() => {}); };
  const open = async (id: string) => {
    setOpening(id);
    try { await openAsMember(id); } catch (e) { toast(errorText(e)); } finally { setOpening(null); }
  };

  return (
    <Card className="border-violet-200">
      <CardHead icon={<Users size={16} className="text-violet-600" />} title="팀원으로 로그인해 보기"
        right={<span className="text-violet-700 bg-violet-50 border border-violet-200 rounded-full px-2 py-0.5 font-semibold">데모 팀</span>} />
      <div className="px-5 pt-3 text-sm text-slate-600 leading-relaxed">
        버튼을 누르면 <b>새 탭</b>이 그 팀원으로 열립니다. 이 탭(팀장)은 로그인된 채로 남으니, 팀원 탭에서 올린 것을 여기서 바로 확인하세요.
        위에서부터 해 보면 팀장–팀원 흐름이 한 바퀴 돕니다.
      </div>
      <ul className="p-3 space-y-1">
        {list.map((a) => {
          const s = DEMO_SCENARIO[a.persona];
          const name = names.get(a.user_id) || a.persona;
          return (
            <li key={a.user_id} className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 rounded-xl px-2 py-2.5 hover:bg-slate-50">
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <Avatar name={name} />
                <div className="min-w-0">
                  <div className="text-sm font-semibold">{name} <span className="font-normal text-slate-500">· {s?.job}</span></div>
                  <div className="text-xs text-slate-500 leading-snug">{s?.try}</div>
                </div>
              </div>
              <Button size="sm" variant="secondary" className="self-start sm:self-auto" loading={opening === a.user_id} onClick={() => open(a.user_id)}>
                {name}(으)로 로그인 <ExternalLink size={13} />
              </Button>
            </li>
          );
        })}
        {accounts.isLoading && <li className="px-2 py-3 text-sm text-slate-400">불러오는 중…</li>}
      </ul>
      <div className="border-t border-slate-100 px-5 py-3">
        <button type="button" className="text-xs text-slate-500 inline-flex items-center gap-1" onClick={() => setShowPw((v) => !v)} aria-expanded={showPw}>
          <KeyRound size={13} /> 휴대폰·다른 브라우저에서 로그인할 계정 정보 <ChevronDown size={13} className={showPw ? 'rotate-180' : ''} />
        </button>
        {showPw && (
          <div className="mt-2 space-y-1.5">
            <p className="text-xs text-slate-500">로그인 화면에서 '비밀번호로 로그인'을 쓰세요. 메일은 실제로 보내지 않습니다. 비밀번호는 모두 같습니다.</p>
            <div className="text-xs flex items-center gap-2"><span className="text-slate-500 w-14">비밀번호</span><code className="font-mono bg-slate-100 rounded px-1.5 py-0.5">{list[0]?.password}</code>
              <button type="button" aria-label="비밀번호 복사" className="text-slate-400 hover:text-indigo-600" onClick={() => copy(list[0]?.password ?? '')}><Copy size={13} /></button></div>
            {list.map((a) => (
              <div key={a.user_id} className="text-xs flex items-center gap-2 min-w-0"><span className="text-slate-500 w-14 shrink-0">{names.get(a.user_id)}</span>
                <code className="font-mono truncate">{a.email}</code>
                <button type="button" aria-label="이메일 복사" className="text-slate-400 hover:text-indigo-600 shrink-0" onClick={() => copy(a.email)}><Copy size={13} /></button></div>
            ))}
          </div>
        )}
      </div>
      <div className="border-t border-slate-100 px-5 py-3 flex items-center justify-between gap-3 flex-wrap">
        <span className="text-xs text-slate-500">데모 팀의 AI 사용은 내 요금제에서 쓰입니다. 예약 인사이트는 만든 뒤 14일만 돕니다.</span>
        {confirmDel ? (
          <span className="flex items-center gap-2">
            <span className="text-xs text-rose-700">데모 팀과 팀원 계정을 모두 지울까요?</span>
            <Button size="sm" variant="danger" loading={del.isPending} onClick={() => del.mutate()}>지우기</Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirmDel(false)}>취소</Button>
          </span>
        ) : (
          <Button size="sm" variant="ghost" onClick={() => setConfirmDel(true)}><Trash2 size={13} /> 데모 팀 지우기</Button>
        )}
      </div>
    </Card>
  );
}

/** 홈 상단 한 줄: 데모 팀이면 팀원 체험으로 안내 */
export function DemoStrip() {
  const { team, isLeader } = useSession();
  if (!team?.is_demo || !isLeader) return null;
  return (
    <div className="flex items-center gap-2 text-sm rounded-xl border border-violet-200 bg-violet-50/60 px-4 py-2.5">
      <FlaskConical size={15} className="text-violet-600 shrink-0" />
      <span className="text-slate-700 flex-1 min-w-0">데모 팀입니다. 팀원 계정으로 로그인해 계획 올리기·공유하기를 직접 해 보세요.</span>
      <Link to="/team" className="text-violet-700 font-semibold whitespace-nowrap">팀원으로 로그인 →</Link>
    </div>
  );
}

/** 홈: 데모 팀이면 안내 한 줄, 팀원이 아직 없는 실제 팀이면 데모 팀 만들기 카드 */
export function DemoHomeSlot() {
  const { team, isLeader, members } = useSession();
  const demo = useDemoTeam();
  if (!team || !isLeader) return null;
  if (team.is_demo) return <div className="mt-6"><DemoStrip /></div>;
  if (!demo && !members.some((m) => m.role === 'member')) return <div className="mt-6"><DemoStart compact /></div>;
  return null;
}
