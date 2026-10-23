// ATEAM Method™ — 기본 제공 방법론 카드(knowhow_cards.source = 'consulting')의 화면용 정보
//   카드 원본(knowhow_templates)에 영역·대표 여부·언제 쓰나·왜·예시·출처가 있다 (29_playbook.sql)
//   영역 이름은 supabase/playbook/playbook.json 과 맞춘다
import { useQuery } from '@tanstack/react-query';
import { FileText, HeartHandshake, Lightbulb, MessagesSquare, Network, Scale, Target, Users, type LucideIcon } from 'lucide-react';
import { supabase } from './supabase';
import type { KnowhowCard } from './types';

export const PLAYBOOK = 'ATEAM Method™';

export type PlaybookDomain = 'logic' | 'writing' | 'comm' | 'creative' | 'decision' | 'goal' | 'coach' | 'team';
/** 영역별 색 — 책등·카드 왼쪽 띠·칩에 같이 쓴다 (spine: 짙은 배경 위, chip: 흰 배경 위) */
export const DOMAINS: Record<PlaybookDomain, { label: string; short: string; sub: string; icon: LucideIcon; spine: string; bar: string; chip: string }> = {
  logic: { label: '로지컬 씽킹', short: '로지컬 씽킹', sub: '문제를 쪼개고 가설로 푼다', icon: Network, spine: 'bg-[#3B5B8C]', bar: 'bg-[#3B5B8C]', chip: 'text-[#2F4C78] bg-[#EAF0F8]' },
  writing: { label: '보고서·문서', short: '보고서', sub: '읽는 사람이 바로 판단하게 쓴다', icon: FileText, spine: 'bg-[#2F6F6A]', bar: 'bg-[#2F6F6A]', chip: 'text-[#245A56] bg-[#E6F2F0]' },
  comm: { label: '상사·고객 커뮤니케이션', short: '커뮤니케이션', sub: '상대의 관점으로 말한다', icon: MessagesSquare, spine: 'bg-[#6A4C8C]', bar: 'bg-[#6A4C8C]', chip: 'text-[#583D78] bg-[#F1ECF7]' },
  creative: { label: '창의적 사고·기획', short: '창의·기획', sub: '다르게 정의하고 작게 검증한다', icon: Lightbulb, spine: 'bg-[#9A6A1F]', bar: 'bg-[#B8892F]', chip: 'text-[#7D5414] bg-[#FAF1E1]' },
  decision: { label: '의사결정·실행', short: '의사결정', sub: '빠르고 설명할 수 있게 정한다', icon: Scale, spine: 'bg-[#8C3F45]', bar: 'bg-[#8C3F45]', chip: 'text-[#7A333A] bg-[#F8EBEC]' },
  goal: { label: '목표·성과관리', short: '목표·성과', sub: '이루려는 상태로 세우고 결과로 잰다', icon: Target, spine: 'bg-[#3F4FA8]', bar: 'bg-[#4F46E5]', chip: 'text-[#3730A3] bg-[#EEF0FC]' },
  coach: { label: '코칭·피드백', short: '코칭', sub: '사람이 스스로 자라게 돕는다', icon: HeartHandshake, spine: 'bg-[#4F7A3A]', bar: 'bg-[#4F7A3A]', chip: 'text-[#3E6430] bg-[#EDF4E8]' },
  team: { label: '팀 운영', short: '팀 운영', sub: '팀이 일하는 방식을 설계한다', icon: Users, spine: 'bg-[#55606E]', bar: 'bg-[#55606E]', chip: 'text-[#434C58] bg-[#EEF0F2]' },
};
export const DOMAIN_ORDER = Object.keys(DOMAINS) as PlaybookDomain[];

export interface PlaybookTemplate {
  key: string; domain: PlaybookDomain; tier: number; title: string; body: string; rules: string[];
  situation: string; why: string; example_bad: string; example_good: string; origin: string; origin_type: 'field' | 'global'; sort: number;
}
/** 카드(팀 사본) + 원본의 화면용 정보 */
export type PlaybookCard = KnowhowCard & { tpl?: PlaybookTemplate; locked_active?: boolean | null };

/** 원본 목록 — 29_playbook.sql 전이면 화면용 칸이 없어 기본 칸만 온다 */
export function usePlaybookTemplates(enabled = true) {
  return useQuery({
    queryKey: ['playbook-templates'], enabled, staleTime: 30 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('knowhow_templates').select('*').order('sort');
      if (error) return [] as PlaybookTemplate[];
      return (data ?? []).map((t) => ({ domain: 'goal', tier: 2, situation: '', why: '', example_bad: '', example_good: '', origin: '', origin_type: 'field', ...t })) as PlaybookTemplate[];
    },
  });
}

/** 출처 표시에서 쓰는 이름 — 예전 결과의 '컨설팅 기준 · ' 머리말도 같은 이름으로 */
export const methodTitle = (label: string) => label.replace(/^(컨설팅 기준|ATEAM 플레이북|ATEAM Method™|내 노하우)\s*·\s*/, '');

/** '왜 방법론인가' — 화면 근거 (각 수치는 원문 확인, docs/PLAYBOOK.md) */
export const EVIDENCE: { stat: string; text: string; src: string }[] = [
  { stat: '70%', text: '팀 몰입도 차이의 최소 70%는 관리자가 만든다', src: 'Gallup, State of the American Manager' },
  { stat: '61%', text: '관리자 61%가 의사결정에 쓰는 시간 대부분이 비효율적이라고 답했다', src: 'McKinsey, 2019' },
  { stat: '180팀', text: '좋은 팀을 가른 첫 번째 요인은 구성원이 아니라 심리적 안전감이었다', src: 'Google re:Work, Project Aristotle' },
  { stat: '10곳 중 7곳', text: '기업이 꼽은 핵심 역량 1위는 분석적 사고였다', src: 'WEF, Future of Jobs 2025' },
];
