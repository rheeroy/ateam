// SVG 차트 (외부 차트 라이브러리 없이). 색: 강조 indigo #4F46E5, 비교 회색 #94A3B8, 경고 rose.
import type { Forecast, PerfPoint, PortfolioRow } from '../lib/types';
import { num } from '../lib/format';

const INDIGO = '#4F46E5';
const GREY = '#94A3B8';

// ---------- 팀 성과 지도 ----------
export function PerfMap({ points, selected, onSelect }: { points: PerfPoint[]; selected?: string | null; onSelect?: (id: string) => void }) {
  const W = 560, H = 390, L = 50, T = 14, PW = 490, PH = 330;
  const sx = (v: number) => L + (Math.max(0, Math.min(100, v)) / 100) * PW;
  const sy = (v: number) => T + PH - (Math.max(0, Math.min(100, v)) / 100) * PH;
  const held = points.filter((p) => p.withheld);
  const placed = points.filter((p) => !p.withheld);
  return (
    <>
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full min-w-[480px]" role="img" aria-label="팀원의 결과와 판단·성장 위치">
      <rect x={sx(50)} y={T} width={PW / 2} height={PH / 2} fill="#EEF2FF" opacity=".55" />
      <line x1={sx(50)} y1={T} x2={sx(50)} y2={T + PH} stroke="#E2E8F0" strokeDasharray="4 4" />
      <line x1={L} y1={sy(50)} x2={L + PW} y2={sy(50)} stroke="#E2E8F0" strokeDasharray="4 4" />
      <line x1={L} y1={T} x2={L} y2={T + PH} stroke="#CBD5E1" />
      <line x1={L} y1={T + PH} x2={L + PW} y2={T + PH} stroke="#CBD5E1" />
      <g fontSize="11" fill={GREY}>
        <text x={L + 8} y={T + 16}>성장 중, 결과는 아직</text>
        <text x={L + PW - 8} y={T + 16} textAnchor="end" fill={INDIGO} fontWeight="600">핵심 기여</text>
        <text x={L + 8} y={T + PH - 8}>집중 지원 필요</text>
        <text x={L + PW - 8} y={T + PH - 8} textAnchor="end">결과는 내지만 성장 정체</text>
        <text x={L + PW / 2} y={H - 8} textAnchor="middle" fill="#64748B">결과 (실현된 가치) →</text>
        <text transform={`translate(16 ${T + PH / 2}) rotate(-90)`} textAnchor="middle" fill="#64748B">판단·성장 (만들어내는 가치) →</text>
      </g>
      {placed.map((p) => {
        const x = sx(p.x), y = sy(p.y), px = sx(p.prev_x), py = sy(p.prev_y);
        const moved = Math.hypot(x - px, y - py) > 6;
        const on = selected === p.user_id;
        return (
          <g key={p.user_id} onClick={() => onSelect?.(p.user_id)} className="cursor-pointer">
            <title>{`${p.full_name} — 결과 ${num(p.x, 0)}, 판단·성장 ${num(p.y, 0)}, 근거 ${p.evidence}건${p.withheld ? ' (판단 보류)' : ''}`}</title>
            {p.withheld ? (
              <>
                <circle cx={x} cy={y} r="9" fill="none" stroke={GREY} strokeWidth="1.5" strokeDasharray="3 3" />
                <text x={x} y={y + 24} textAnchor="middle" fontSize="11" fill={GREY}>{p.full_name} · 판단 보류</text>
              </>
            ) : (
              <>
                {moved && (
                  <>
                    <line x1={px} y1={py} x2={x} y2={y} stroke="#CBD5E1" strokeWidth="1.5" />
                    <circle cx={px} cy={py} r="3.5" fill="#fff" stroke={GREY} strokeWidth="1.5" />
                  </>
                )}
                <circle cx={x} cy={y} r={on ? 9 : 7} fill={on ? INDIGO : '#334155'} stroke="#fff" strokeWidth="2" />
                <text x={x + 12} y={y - 8} fontSize="12" fill={on ? INDIGO : '#334155'} fontWeight={on ? 700 : 500}>{p.full_name}</text>
              </>
            )}
            <circle cx={x} cy={y} r="18" fill="transparent" />
          </g>
        );
      })}
    </svg>
    {held.length > 0 && (
      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
        <span className="inline-flex items-center gap-1"><svg width="10" height="10" aria-hidden="true"><circle cx="5" cy="5" r="4" fill="none" stroke={GREY} strokeWidth="1.5" strokeDasharray="2 2" /></svg>판단 보류 (근거 부족)</span>
        {held.map((p) => (
          <button key={p.user_id} onClick={() => onSelect?.(p.user_id)} className={`border border-dashed rounded-full px-2 py-0.5 ${selected === p.user_id ? 'border-indigo-400 text-indigo-700' : 'border-slate-300'}`}>{p.full_name} · {p.evidence}건</button>
        ))}
      </div>
    )}
    </>
  );
}

// ---------- 실적 전망 ----------
function niceStep(raw: number) {
  const p = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1e-9))));
  const n = raw / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}
function monthsBetween(a: string, b: string) {
  const da = new Date(a), db = new Date(b);
  return (db.getFullYear() - da.getFullYear()) * 12 + db.getMonth() - da.getMonth();
}
export function ForecastChart({ fc }: { fc: Forecast }) {
  const W = 640, H = 262, L = 44, R = 92, T = 20, B = 36;
  const n = Math.max(1, monthsBetween(fc.period_start, fc.period_end));
  const cum = fc.series.map((s) => (fc.cumulative ? Number(s.cumulative) : Number(s.value)));
  const maxV = Math.max(...cum, fc.target ?? 0, fc.high ?? 0, 1) * 1.15;
  const sx = (i: number) => L + (i / n) * (W - L - R);
  const sy = (v: number) => T + (H - T - B) - (v / maxV) * (H - T - B);
  const idx = (p: string) => monthsBetween(fc.period_start, p);
  const pts = fc.series.map((s, i) => `${sx(idx(s.period))},${sy(cum[i])}`).join(' ');
  const last = fc.series[fc.series.length - 1];
  const li = last ? idx(last.period) : 0;
  const lv = cum[cum.length - 1] ?? 0;
  const step = niceStep(maxV / 4);
  const ticks = Array.from({ length: Math.floor(maxV / step) + 1 }, (_, i) => Math.round(i * step * 100) / 100);
  const labels: string[] = [];
  for (let i = 0; i <= n; i++) {
    const d = new Date(fc.period_start); d.setMonth(d.getMonth() + i);
    labels.push(`${d.getMonth() + 1}월`);
  }
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full min-w-[520px]" role="img"
      aria-label={`${fc.name} 실적 ${num(fc.actual)}${fc.unit}, 기준 전망 ${num(fc.base)}${fc.unit}, 범위 ${num(fc.low)}~${num(fc.high)}`}>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={L} y1={sy(t)} x2={W - R} y2={sy(t)} stroke="#F1F5F9" />
          <text x={L - 8} y={sy(t) + 4} textAnchor="end" fontSize="10" fill={GREY}>{t}</text>
        </g>
      ))}
      {labels.map((l, i) => <text key={i} x={sx(i)} y={H - 14} textAnchor="middle" fontSize="10" fill={GREY}>{l}</text>)}
      {fc.target != null && (
        <g>
          <line x1={L} y1={sy(fc.target)} x2={W - R} y2={sy(fc.target)} stroke="#0F172A" strokeDasharray="5 4" strokeWidth="1.2" />
          <text x={L + 6} y={sy(fc.target) - 6} fontSize="11" fontWeight="700" fill="#0F172A">목표 {fc.target}{fc.unit}</text>
        </g>
      )}
      {fc.base != null && fc.low != null && fc.high != null && fc.cumulative && (
        <>
          <polygon points={`${sx(li)},${sy(lv)} ${sx(n)},${sy(fc.high)} ${sx(n)},${sy(fc.low)}`} fill={INDIGO} opacity=".12" />
          <line x1={sx(li)} y1={sy(lv)} x2={sx(n)} y2={sy(fc.base)} stroke={INDIGO} strokeWidth="2" strokeDasharray="6 5" />
          <circle cx={sx(n)} cy={sy(fc.base)} r="4.5" fill={INDIGO} stroke="#fff" strokeWidth="2" />
          <g fontSize="11" fontFamily="IBM Plex Mono, monospace">
            <text x={sx(n) + 10} y={sy(fc.high) + 4} fill="#64748B">낙관 {num(fc.high)}</text>
            <text x={sx(n) + 10} y={sy(fc.base) + 4} fill={INDIGO} fontWeight="700">기준 {num(fc.base)}</text>
            <text x={sx(n) + 10} y={sy(fc.low) + 14} fill="#64748B">비관 {num(fc.low)}</text>
          </g>
        </>
      )}
      <polyline points={pts} fill="none" stroke={INDIGO} strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />
      {fc.series.map((s, i) => <circle key={s.period} cx={sx(idx(s.period))} cy={sy(cum[i])} r="3.5" fill={INDIGO} />)}
      {last && <text x={sx(li) + 6} y={sy(lv) + 18} fontSize="11" fill="#334155" fontFamily="IBM Plex Mono, monospace">{num(lv)}</text>}
    </svg>
  );
}

// ---------- 과제 포트폴리오 ----------
export function PortfolioChart({ rows }: { rows: PortfolioRow[] }) {
  const W = 540, H = 330, L = 44, T = 14, PW = 470, PH = 270;
  const maxShare = Math.max(40, ...rows.map((r) => r.share_pct ?? 0)) * 1.1;
  const sx = (v: number) => L + (v / maxShare) * PW;
  const sy = (c: number) => T + PH - ((c - 0.5) / 5) * PH;
  const midX = sx(15); // 팀 시간의 15% 이상이면 '많이 쓰는' 과제
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full min-w-[460px]" role="img" aria-label="과제별 미션 기여도와 팀 시간 투입 비중">
      <rect x={L} y={T} width={midX - L} height={sy(3) - T} fill="#EEF2FF" opacity=".5" rx="6" />
      <rect x={midX} y={sy(3)} width={L + PW - midX} height={T + PH - sy(3)} fill="#FEF3C7" opacity=".5" rx="6" />
      <line x1={midX} y1={T} x2={midX} y2={T + PH} stroke="#E2E8F0" strokeDasharray="4 4" />
      <line x1={L} y1={sy(3)} x2={L + PW} y2={sy(3)} stroke="#E2E8F0" strokeDasharray="4 4" />
      <line x1={L} y1={T} x2={L} y2={T + PH} stroke="#CBD5E1" />
      <line x1={L} y1={T + PH} x2={L + PW} y2={T + PH} stroke="#CBD5E1" />
      <g fontSize="11">
        <text x={L + 8} y={T + 16} fill={INDIGO} fontWeight="600">확대 검토</text>
        <text x={L + PW - 8} y={T + 16} textAnchor="end" fill="#64748B">집중 투자</text>
        <text x={L + 8} y={T + PH - 8} fill={GREY}>유지·정리</text>
        <text x={L + PW - 8} y={T + PH - 8} textAnchor="end" fill="#92400E" fontWeight="600">축소·재검토</text>
        <text x={L + PW / 2} y={H - 10} textAnchor="middle" fill="#64748B">팀 시간 투입 비중 →</text>
        <text transform={`translate(16 ${T + PH / 2}) rotate(-90)`} textAnchor="middle" fill="#64748B">미션 기여도 →</text>
      </g>
      {layoutLabels(rows.map((r) => ({ r, x: sx(r.share_pct ?? 0), y: sy(r.mission_contribution) }))).map(({ r, x, y, ly, right }) => {
        const waste = r.mission_contribution <= 2 && (r.share_pct ?? 0) >= 15;
        return (
          <g key={r.task_id}>
            <title>{`${r.title} — 시간 비중 ${num(r.share_pct)}%, 미션 기여도 ${r.mission_contribution}/5`}</title>
            {Math.abs(ly - y) > 2 && <line x1={x} y1={y} x2={right ? x - 10 : x + 10} y2={ly - 4} stroke="#CBD5E1" />}
            <circle cx={x} cy={y} r="7" fill={waste ? '#D97706' : '#334155'} stroke="#fff" strokeWidth="2" />
            <text x={right ? x - 12 : x + 12} y={ly} textAnchor={right ? 'end' : 'start'} fontSize="12" fill={waste ? '#92400E' : '#334155'} fontWeight={waste ? 700 : 400}>{r.title}</text>
          </g>
        );
      })}
    </svg>
  );
}

/** 겹치는 라벨을 아래로 밀어낸다 (간단한 충돌 회피) */
function layoutLabels<T extends { x: number; y: number; r: PortfolioRow }>(items: T[]) {
  const placed: { x: number; ly: number; right: boolean; w: number }[] = [];
  return [...items].sort((a, b) => a.y - b.y || a.x - b.x).map((it) => {
    const right = it.x > 380;
    const w = it.r.title.length * 12;
    let ly = it.y + 4;
    const x0 = right ? it.x - 12 - w : it.x + 12, x1 = right ? it.x - 12 : it.x + 12 + w;
    const hit = () =>
      placed.some((p) => Math.abs(p.ly - ly) < 15 && x0 < (p.right ? p.x - 12 : p.x + 12 + p.w) && x1 > (p.right ? p.x - 12 - p.w : p.x + 12)) ||
      items.some((o) => o !== it && o.x > x0 - 8 && o.x < x1 + 8 && Math.abs(o.y - (ly - 4)) < 11);
    let guard = 0;
    while (hit() && guard++ < 8) ly += 16;
    placed.push({ x: it.x, ly, right, w });
    return { ...it, ly, right };
  });
}

// ---------- 스파크라인 ----------
export function Sparkline({ values, w = 150, h = 44, label }: { values: number[]; w?: number; h?: number; label?: string }) {
  if (values.length < 2) return <span className="text-xs text-slate-400">기록 {values.length}건</span>;
  const min = Math.min(...values) - 0.2, max = Math.max(...values) + 0.2;
  const pts = values.map((v, i) => [4 + (i / (values.length - 1)) * (w - 8), h - 4 - ((v - min) / (max - min || 1)) * (h - 8)]);
  const lastP = pts[pts.length - 1];
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-label={label}>
      <polyline fill="none" stroke={INDIGO} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" points={pts.map((p) => p.join(',')).join(' ')} />
      <circle cx={lastP[0]} cy={lastP[1]} r="3.5" fill={INDIGO} />
    </svg>
  );
}

// ---------- 토네이도 (민감도) ----------
export function Tornado({ rows, unit = '' }: { rows: { label: string; value: number }[]; unit?: string }) {
  const max = Math.max(0.1, ...rows.map((r) => Math.abs(r.value)));
  return (
    <div className="space-y-2.5 text-xs">
      {rows.map((r, ri) => {
        const w = (Math.abs(r.value) / max) * 42;
        const neg = r.value < 0;
        return (
          <div key={`${r.label}-${ri}`} className="grid grid-cols-[110px_1fr] items-center gap-3">
            <span className="text-slate-600 text-right truncate" title={r.label}>{r.label}</span>
            <div className="relative h-5">
              <div className="absolute left-1/2 top-0 bottom-0 w-px bg-slate-300" />
              <div className={`absolute top-0.5 bottom-0.5 ${neg ? 'right-1/2 rounded-l bg-rose-500' : 'left-1/2 rounded-r bg-indigo-500'}`} style={{ width: `${w}%` }} />
              <span className="absolute top-0.5 font-mono num text-slate-700"
                style={neg ? { right: `calc(50% + ${w}% + 6px)` } : { left: `calc(50% + ${w}% + 6px)` }}>
                {(r.value > 0 ? '+' : r.value < 0 ? '−' : '') + Math.abs(r.value).toFixed(1)}{unit}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------- 기준 vs 시나리오 막대 ----------
export function CompareBars({ rows }: { rows: { label: string; base: number | null; value: number | null }[] }) {
  return (
    <div className="space-y-4 text-sm">
      {rows.map((r, ri) => {
        const d = r.base != null && r.value != null ? r.value - r.base : 0;
        return (
          <div key={`${r.label}-${ri}`}>
            <div className="flex justify-between gap-3">
              <span className="text-slate-700 truncate">{r.label}</span>
              <span className="font-mono num whitespace-nowrap">
                <span className="text-slate-400">{r.base ?? '-'}% →</span> <span className="font-semibold text-slate-900">{r.value ?? '-'}%</span>{' '}
                {d !== 0 && <span className={d > 0 ? 'text-indigo-600' : 'text-rose-600'}>({d > 0 ? '+' : '−'}{Math.abs(d)})</span>}
              </span>
            </div>
            <div className="mt-1.5 space-y-1">
              <div className="h-1.5 rounded-full bg-slate-100"><div className="h-1.5 rounded-full bg-slate-300" style={{ width: `${r.base ?? 0}%` }} /></div>
              <div className="h-2.5 rounded-full bg-slate-100"><div className="h-2.5 rounded-full bg-indigo-600 transition-all duration-300" style={{ width: `${r.value ?? 0}%` }} /></div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
