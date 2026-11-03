#!/usr/bin/env python3
"""데모 팀 여러 개 — 마케팅기획팀 데모 SQL을 틀로, 팀별 문장 묶음(supabase/demo/teams/<key>.json)을 끼워 팀마다 SQL을 만든다.

  python3 scripts/build-demo-teams.py segments   → supabase/demo/segments.json (틀에서 바꿀 문장 목록, 팀 문장 묶음을 쓸 때 본다)
  python3 scripts/build-demo-teams.py build      → supabase/dashboard/06_demo_team_<key>.sql (팀마다 하나)

틀: seed_demo_team(010) + demo_accounts.sql + 016 · 017 · 039 의 데모 블록 + 042 + 047
팀 문장 묶음: { key, name, label, email_prefix, cast: [팀장, 팀원1..6], ranks: {이름: 직급}, default_member, map: { "<문장 id>": "새 문장" } }
  · 구조(날짜 · 상태 · 숫자 · 관계)는 마케팅 데모와 같고 문장만 바뀐다 — 화면 장면이 모든 팀에서 똑같이 갖춰진다
"""
import json, re, sys, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent / 'supabase'
MIG = ROOT / 'migrations'
TEAM_NAME = '마케팅기획팀 (데모)'
CAST = [['demo', '이정재'], ['demo_p1', '김현정'], ['demo_p2', '박서연'], ['demo_p3', '최다은'], ['demo_p4', '정우성'], ['demo_p5', '이동욱'], ['demo_p6', '한수진']]


def do_blocks(path):
    """파일 안의 데모 DO 블록만 (is_demo 를 도는 것)"""
    s = path.read_text()
    out = []
    for m in re.finditer(r'\ndo \$\$.*?\nend \$\$;', s, re.S):
        if 'is_demo' in m.group(0):
            out.append(m.group(0).strip())
    return out


def template():
    demo = (MIG / '20261014000010_demo.sql').read_text().split('\n')
    start = next(i for i, l in enumerate(demo) if l.startswith('create or replace function public.seed_demo_team'))
    seed = '\n'.join(demo[start:])
    parts = [seed, (ROOT / 'demo_accounts.sql').read_text()]
    for f in ['20261020000016_leader_notes.sql', '20261021000017_coaching.sql', '20261112000039_invite_note.sql']:
        parts += do_blocks(MIG / f)
    parts += [(MIG / '20261114000042_demo_workspace_plus.sql').read_text(), (MIG / '20261118000047_demo_core_works.sql').read_text(), (MIG / '20261119000049_demo_board_plus.sql').read_text()]
    return strip_comments('\n\n'.join(parts))


SQ = re.compile(r"(?<![A-Za-z0-9_])(E?)'((?:[^']|'')*)'")
DQ = re.compile(r'"((?:[^"\\]|\\.)*)"')
KO = re.compile('[가-힣]')


def strip_comments(s):
    """-- 주석을 지운다 (따옴표 · $태그$ 문자열 안은 그대로). 주석 속 따옴표가 문자열 짝을 흐트러뜨리지 않게"""
    out, i, n = [], 0, len(s)
    tag = None
    while i < n:
        if tag:
            j = s.find(tag, i)
            j = n if j < 0 else j + len(tag)
            out.append(s[i:j]); i = j; tag = None; continue
        c = s[i]
        if c == "'":
            j = i + 1
            while j < n:
                if s[j] == "'" and j + 1 < n and s[j + 1] == "'": j += 2; continue
                if s[j] == "'": break
                j += 1
            out.append(s[i:j + 1]); i = j + 1; continue
        if c == '$':
            m = re.match(r'\$[A-Za-z_]*\$', s[i:])
            if m: tag = m.group(0); out.append(tag); i += len(tag); continue
        if c == '-' and s.startswith('--', i):
            j = s.find('\n', i); i = n if j < 0 else j; continue
        out.append(c); i += 1
    return ''.join(out)


def segments(t):
    code = strip_comments(t)
    seen, out = {}, []
    names = {c[1] for c in CAST}
    def add(text, kind):
        if text in seen or not KO.search(text) or text == TEAM_NAME or text in names:
            return
        seen[text] = len(out)
        i = t.find(text)
        out.append({'id': len(out), 'kind': kind, 'text': text, 'ctx': t[max(0, i - 90):i].replace('\n', ' ')[-90:] if i >= 0 else ''})
    for m in SQ.finditer(code):
        raw = m.group(2).replace("''", "'")
        if raw.lstrip().startswith(('{', '[')):
            continue   # JSON 문자열은 안의 "..." 로
        add(raw, 'sq')
    for m in DQ.finditer(code):
        add(m.group(1), 'dq')
    return out


def safe(x):
    return x.replace("'", '’').replace('"', '”')


def build_team(t, segs, team):
    s = t
    # 이름 (팀원 이름은 문장 속에도 있지만, 문장은 map 이 통째로 바꾼다 — 여기서는 홀로 쓰인 이름 리터럴만)
    names = dict(zip([c[1] for c in CAST], team['cast']))
    by_text = {g['text']: g for g in segs}
    # 긴 것부터 바꾼다 (짧은 문장이 긴 문장 속에 들어 있을 수 있음)
    order = sorted(segs, key=lambda g: -len(g['text']))
    miss = []
    def sq_sub(m):
        raw = m.group(2).replace("''", "'")
        if raw in names:
            return f"{m.group(1)}'{names[raw]}'"
        if raw == TEAM_NAME:
            return f"'{team['name']} (데모)'"
        g = by_text.get(raw)
        if g is None:
            return m.group(0)
        new = team['map'].get(str(g['id']))
        if new is None:
            miss.append(g['id']); return m.group(0)
        return f"{m.group(1)}'" + safe(new).replace("'", "''") + "'"
    def dq_sub(m):
        raw = m.group(1)
        if raw in names:
            return f'"{names[raw]}"'
        g = by_text.get(raw)
        if g is None:
            return m.group(0)
        new = team['map'].get(str(g['id']))
        if new is None:
            miss.append(g['id']); return m.group(0)
        return '"' + safe(new) + '"'
    s = DQ.sub(dq_sub, s)
    s = SQ.sub(sq_sub, s)
    # 문장 목록에 안 잡히는 배열 리터럴 (노하우 태그) — 마케팅 말만 일반어로
    s = s.replace("'{우선순위,예산,CAC}'", "'{우선순위,예산,비용}'")
    # 계정 주소
    p = team['email_prefix']
    cast_sql = ', '.join(f"['{p if i == 0 else f'{p}_p{i}'}','{n}']" for i, n in enumerate(team['cast']))
    s = re.sub(r"cast_ text\[\]\[\] := array\[.*?\];", f"cast_ text[][] := array[{cast_sql}];", s, count=1)
    s = s.replace("'demo@' || dom", f"'{p}@' || dom").replace("'^demo_p[0-9]+@'", f"'^{p}_p[0-9]+@'")
    s = s.replace("or email like '%@demo.ateam'", '')
    s = s.replace("u.email = 'demo@ateam.com' or u.email ~ '^demo_p[0-9]+@ateam\\.com$'", f"u.email = '{p}@ateam.com' or u.email ~ '^{p}_p[0-9]+@ateam\\.com$'")
    s = s.replace("'^demo_p[0-9]+@' || replace(dom, '.', '\\.') || '$'", f"'^{p}_p[0-9]+@' || replace(dom, '.', '\\.') || '$'")
    head = (f"-- =====================================================================\n-- ATEAM 데모 — {team['name']} (데모) · 팀장 {team['cast'][0]} + 팀원 6 · 약 6개월치 기록\n"
            f"-- 06_demo_accounts.sql(마케팅기획팀)을 먼저 Run 한 프로젝트에서 Run. 다시 Run 하면 이 팀만 처음 상태로 돌아갑니다.\n"
            f"-- 계정: {p}@ateam.com · {p}_p1~p6@ateam.com (비밀번호는 06 과 같음) — 자동 생성 파일 (scripts/build-demo-teams.py)\n"
            "-- =====================================================================\n")
    tail = settings_sql(team['name'] + ' (데모)', team['key'], team['label'], team['ranks'], team['default_member'])
    return head + s + '\n\n' + tail, sorted(set(miss))


def settings_sql(name, key, label, ranks, default_member):
    j = json.dumps({'demo_key': key, 'demo_label': label, 'demo_ranks': ranks, 'demo_default_member': default_member}, ensure_ascii=False).replace("'", "''")
    return f"-- 데모 팀 표시 (데모 띠의 팀 고르기 · 직급 · 팀원 화면 기본 계정)\nupdate public.teams set settings = coalesce(settings, '{{}}'::jsonb) || '{j}'::jsonb where is_demo and name = '{name}';\n"


if __name__ == '__main__':
    cmd = sys.argv[1] if len(sys.argv) > 1 else 'build'
    t = template()
    if cmd == 'segments':
        segs = segments(t)
        (ROOT / 'demo').mkdir(exist_ok=True)
        (ROOT / 'demo' / 'template.sql').write_text(t)
        (ROOT / 'demo' / 'segments.json').write_text(json.dumps(segs, ensure_ascii=False, indent=0))
        print(len(segs), 'segments', sum(len(g['text']) for g in segs), 'chars')
    else:
        # 팀 문장 묶음의 id 는 이 목록 기준 — 틀이 바뀌어도 다시 만들지 않는다 (바뀐 문장은 '없음'으로 보고)
        segs = json.loads((ROOT / 'demo' / 'segments.json').read_text())
        for f in sorted((ROOT / 'demo' / 'teams').glob('*.json')):
            team = json.loads(f.read_text())
            sql, miss = build_team(t, segs, team)
            out = ROOT / 'dashboard' / f"06_demo_team_{team['key']}.sql"
            out.write_text(sql)
            print(out.name, 'missing', len(miss), miss[:20])
