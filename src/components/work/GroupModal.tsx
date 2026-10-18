// 그룹 만들기 · 고치기 — 이름, 연결 목표(선택), 멤버
import { useMemo, useState } from 'react';
import { Trash2, Users } from 'lucide-react';
import { useTeam } from '../../state/session';
import { useItems } from '../../lib/items';
import { useDeleteGroup, useSaveGroup, type WorkGroup } from '../../lib/groups';
import { cx } from '../../lib/format';
import { Button, Field, Modal, inputCls } from '../ui';

export function GroupModal({ group, onClose, onSaved }: { group?: WorkGroup | null; onClose: () => void; onSaved?: (id: string) => void }) {
  const { team, uid, members, isLeader } = useTeam();
  const items = useItems(team.id);
  const goals = useMemo(() => (items.data ?? []).filter((i) => !i.parent_id && i.status !== 'dropped'), [items.data]);
  const people = members.filter((m) => m.role === 'member');
  const [name, setName] = useState(group?.name ?? '');
  const [goal, setGoal] = useState(group?.item_id ?? '');
  const [who, setWho] = useState<Set<string>>(new Set(group ? group.work_group_members.map((m) => m.user_id) : isLeader ? [] : [uid]));
  const save = useSaveGroup();
  const del = useDeleteGroup();
  const canDelete = !!group && (isLeader || group.created_by === uid);
  const flip = (id: string) => setWho((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  return (
    <Modal open onClose={onClose} title={<span className="inline-flex items-center gap-2"><Users size={17} className="text-indigo-600" />{group ? '그룹 고치기' : '그룹 만들기'}</span>}>
      <div className="space-y-4">
        <p className="text-sm text-slate-600 rounded-lg bg-slate-50 px-3 py-2">프로젝트·TF 단위로 멤버를 묶습니다. 그룹에 올린 자료와 대화는 그룹 멤버 모두와 팀장님이 함께 봅니다.</p>
        <Field label="그룹 이름"><input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="예) 신제품 런칭 TF" autoFocus /></Field>
        <Field label="연결 목표" hint="선택">
          <select className={inputCls} value={goal} onChange={(e) => setGoal(e.target.value)}>
            <option value="">연결 안 함</option>{goals.map((g) => <option key={g.id} value={g.id}>{g.title}</option>)}
          </select>
        </Field>
        <Field label="멤버" hint="팀장님은 항상 함께 봅니다">
          <div className="flex flex-wrap gap-1.5">
            {people.map((m) => (
              <button key={m.user_id} type="button" onClick={() => flip(m.user_id)}
                className={cx('text-xs rounded-full border px-2.5 py-1', who.has(m.user_id) ? 'border-indigo-500 bg-indigo-50 text-indigo-700 font-semibold' : 'border-slate-200 text-slate-500')}>
                {m.profiles?.full_name}{m.user_id === uid ? ' (나)' : ''}</button>
            ))}
          </div>
        </Field>
        <div className="flex items-center gap-2">
          {canDelete && (
            <button type="button" className="text-xs text-slate-400 hover:text-rose-600 inline-flex items-center gap-1"
              onClick={() => { if (confirm('그룹을 지울까요? 올린 자료는 올린 사람의 스페이스에 남습니다.')) del.mutate(group!.id, { onSuccess: onClose }); }}><Trash2 size={12} />그룹 지우기</button>
          )}
          <Button className="ml-auto" disabled={!name.trim() || !who.size} loading={save.isPending}
            onClick={() => save.mutate({ id: group?.id, name, item_id: goal || null, members: [...who] }, { onSuccess: (id) => { onSaved?.(id); onClose(); } })}>
            {group ? '저장' : '만들기'}</Button>
        </div>
      </div>
    </Modal>
  );
}
