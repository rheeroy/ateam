// 노하우 카드 공통 이름 — 노하우 라이브러리(내 노하우 · ATEAM Method™)에서 같이 쓴다
import type { KnowhowFeature, KnowhowKind } from './types';

export const KH_KIND: Record<KnowhowKind, { label: string; desc: string; tone: 'indigo' | 'emerald' | 'amber' | 'violet' | 'slate' | 'rose' }> = {
  principle: { label: '원칙·판단 기준', desc: '일하는 방식, 판단할 때 지키는 기준', tone: 'indigo' },
  rubric: { label: '평가 기준', desc: '좋은 결과물의 조건, 역량 정의', tone: 'emerald' },
  framework: { label: '프레임워크·양식', desc: '보고서 구조, 문제 해결 순서, 템플릿', tone: 'violet' },
  context: { label: '사업·조직 맥락', desc: '시장·고객·경쟁사·상위 전략', tone: 'amber' },
  coaching: { label: '코칭·팀 운영', desc: '1on1, 피드백, 팀 운영 방식', tone: 'rose' },
  glossary: { label: '용어', desc: '팀에서 쓰는 말과 약어', tone: 'slate' },
};
export const KH_FEATURE: Record<KnowhowFeature, string> = {
  review: '1차 검토', prep: '1on1 준비', report: '보고·임원 브리핑', evaluation: '평가 초안', briefing: '브리핑·제안', strategy: '전략 점검', scenario: '시나리오', plan: '목표 초안',
};
