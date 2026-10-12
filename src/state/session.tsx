import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase, q } from '../lib/supabase';
import type { CreditStatus, Profile, Role, Team, TeamMember } from '../lib/types';

interface Membership extends TeamMember { teams: Team }

interface Ctx {
  session: Session | null;
  loading: boolean;
  profile: Profile | null;
  memberships: Membership[];
  membershipError: unknown;
  team: Team | null;
  role: Role | null;
  isLeader: boolean;
  members: TeamMember[]; // 현재 팀의 활성 구성원 (profiles 포함)
  credits: CreditStatus | null;
  hasFeature: (f: string) => boolean;
  setTeamId: (id: string) => void;
  nameOf: (userId: string | null | undefined) => string;
  refresh: () => void;
}

const SessionCtx = createContext<Ctx | null>(null);
const LS_KEY = 'ateam.team';

export function SessionProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [teamId, setTeamIdState] = useState<string | null>(() => {
    try { return localStorage.getItem(LS_KEY); } catch { return null; }
  });

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      // 저장된 로그인이 서버에서 사라진 계정(삭제·재생성된 데모 계정 등)이면 정리하고 로그인 화면으로
      if (data.session) {
        const { error } = await supabase.auth.getUser();
        const st = (error as { status?: number } | null)?.status;
        if (error && (st === 401 || st === 403 || st === 404 || /does not exist|not found/i.test(error.message))) {
          await supabase.auth.signOut({ scope: 'local' }).catch(() => {});
          setSession(null); setAuthReady(true);
          return;
        }
      }
      setSession(data.session); setAuthReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      if (!s) qc.clear();
    });
    return () => sub.subscription.unsubscribe();
  }, [qc]);

  const uid = session?.user.id;

  const profileQ = useQuery({
    queryKey: ['profile', uid],
    enabled: !!uid,
    queryFn: () => q<Profile>(supabase.from('profiles').select('*').eq('id', uid!).single()),
  });

  const memQ = useQuery({
    queryKey: ['memberships', uid],
    enabled: !!uid,
    queryFn: () =>
      q<Membership[]>(supabase.from('team_members').select('*, teams(*)').eq('user_id', uid!).eq('status', 'active')),
  });

  const memberships = memQ.data ?? [];
  const current = memberships.find((m) => m.team_id === teamId) ?? memberships[0] ?? null;
  const team = current?.teams ?? null;

  const membersQ = useQuery({
    queryKey: ['members', team?.id],
    enabled: !!team,
    queryFn: () =>
      q<TeamMember[]>(
        supabase.from('team_members').select('*, profiles(*)').eq('team_id', team!.id).eq('status', 'active').order('joined_at'),
      ),
  });

  const creditsQ = useQuery({
    queryKey: ['credits', team?.id],
    enabled: !!team,
    queryFn: () => q<CreditStatus>(supabase.rpc('credit_status', { p_team: team!.id })),
  });

  const value = useMemo<Ctx>(() => {
    const members = membersQ.data ?? [];
    const names = new Map(members.map((m) => [m.user_id, m.profiles?.full_name ?? '']));
    return {
      session,
      loading: !authReady || (!!uid && (memQ.isLoading || profileQ.isLoading)),
      profile: profileQ.data ?? null,
      memberships,
      membershipError: memQ.error,
      team,
      role: current?.role ?? null,
      isLeader: current?.role === 'leader',
      members,
      credits: creditsQ.data ?? null,
      hasFeature: (f) => (creditsQ.data ? creditsQ.data.features.includes(f) : true),
      setTeamId: (id) => {
        setTeamIdState(id);
        try { localStorage.setItem(LS_KEY, id); } catch { /* 저장 불가 환경 */ }
      },
      nameOf: (id) => (id ? names.get(id) ?? '' : ''),
      refresh: () => {
        qc.invalidateQueries({ queryKey: ['memberships'] });
        qc.invalidateQueries({ queryKey: ['members'] });
        qc.invalidateQueries({ queryKey: ['credits'] });
        qc.invalidateQueries({ queryKey: ['profile'] });
      },
    };
  }, [session, authReady, uid, memQ.isLoading, memQ.error, profileQ.isLoading, profileQ.data, memberships, team, current, membersQ.data, creditsQ.data, qc]);

  return <SessionCtx.Provider value={value}>{children}</SessionCtx.Provider>;
}

export function useSession() {
  const c = useContext(SessionCtx);
  if (!c) throw new Error('SessionProvider missing');
  return c;
}

/** 현재 팀이 반드시 있는 화면에서 사용 */
export function useTeam() {
  const s = useSession();
  if (!s.team) throw new Error('team required');
  return { ...s, team: s.team, uid: s.session!.user.id };
}
