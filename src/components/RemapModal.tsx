import { useMemo, useState } from 'react';
import type { Cue } from '../types';
import { MIN_DURATION, formatTimestamp, parseTimestamp } from '../lib/time';
import {
  previewRemap,
  validateAnchors,
  type CueIssueCode,
  type RemapAnchor,
} from '../lib/remap';

interface RemapModalProps {
  cues: Cue[];
  onClose: () => void;
  /** 应用：一次性替换当前字幕时间（保留文本与 id），由调用方产生一条撤销记录 */
  onApply: (next: Cue[]) => void;
}

interface RowDraft {
  oldStr: string;
  newStr: string;
}

const ISSUE_LABEL: Record<CueIssueCode, string> = {
  'negative-start': '负起点',
  'too-short': '时长不足 300ms',
  overlap: '相邻重叠',
};

/** 允许负数秒的格式化（外推可能产生负的新时间，用于预览告警展示） */
function formatSigned(seconds: number): string {
  if (seconds >= 0) return formatTimestamp(seconds);
  const s = Math.abs(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  const ms = Math.round((s - Math.floor(s)) * 1000);
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return `-${pad(h)}:${pad(m)}:${pad(sec)}.${pad(ms, 3)}`;
}

function identityRows(cues: Cue[]): RowDraft[] {
  const sorted = [...cues].sort((a, b) => a.start - b.start);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  // 单条字幕时用其起终点作为两个锚点
  const t0 = first.start;
  const t1 = last.end > first.start ? last.end : first.end;
  return [
    { oldStr: formatTimestamp(t0), newStr: formatTimestamp(t0) },
    { oldStr: formatTimestamp(t1), newStr: formatTimestamp(t1) },
  ];
}

export default function RemapModal({ cues, onClose, onApply }: RemapModalProps) {
  const [rows, setRows] = useState<RowDraft[]>(() => identityRows(cues));

  /** 解析所有行；非法时间戳记录在 parseErrors 中（行号 → 侧别） */
  const parsed = useMemo(() => {
    const anchors: RemapAnchor[] = [];
    const parseErrors = new Map<number, Set<'old' | 'new'>>();
    rows.forEach((r, i) => {
      const oldT = parseTimestamp(r.oldStr);
      const newT = parseTimestamp(r.newStr);
      if (oldT === null || newT === null) {
        const sides = new Set<'old' | 'new'>();
        if (oldT === null) sides.add('old');
        if (newT === null) sides.add('new');
        parseErrors.set(i, sides);
        return;
      }
      anchors.push({ oldT, newT });
    });
    return { anchors, parseErrors };
  }, [rows]);

  // 行内可能含无法解析的输入；只有全部可解析时才用解析后的锚点做校验/预览
  const allParsed = parsed.parseErrors.size === 0;
  const anchorIssue = useMemo(
    () => (allParsed ? validateAnchors(parsed.anchors) : null),
    [allParsed, parsed.anchors],
  );

  const preview = useMemo(() => {
    if (!allParsed || anchorIssue) return null;
    return previewRemap(cues, parsed.anchors);
  }, [allParsed, anchorIssue, cues, parsed.anchors]);

  const affectedCount = preview ? preview.affectedIds.size : 0;

  const updateRow = (i: number, side: 'old' | 'new', value: string) => {
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, [side === 'old' ? 'oldStr' : 'newStr']: value } : r)));
  };
  const addRow = () => {
    setRows((rs) => {
      const last = rs[rs.length - 1];
      // 在末行基础上 +1s 给个可编辑的初值，保证严格递增的起点
      const oldT = parseTimestamp(last.oldStr);
      const newT = parseTimestamp(last.newStr);
      const nextOld = (oldT ?? 0) + 1;
      const nextNew = (newT ?? 0) + 1;
      return [...rs, { oldStr: formatTimestamp(nextOld), newStr: formatTimestamp(nextNew) }];
    });
  };
  const removeRow = (i: number) => setRows((rs) => rs.filter((_, idx) => idx !== i));

  return (
    <div className="modal-backdrop" onPointerDown={onClose}>
      <div className="modal modal-wide" onPointerDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>剪辑版本时间映射</h2>
          <button className="btn icon" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="remap-body">
          <p className="modal-hint remap-intro">
            输入至少两组「旧版时间 → 新版时间」锚点，两侧时间都必须严格递增。
            字幕起止点按相邻锚点分段线性映射，区间外按最近一段斜率外推。
          </p>

          <div className="anchor-editor">
            <div className="anchor-row anchor-row-head">
              <span className="anchor-col-idx">#</span>
              <span className="anchor-col-time">旧版时间</span>
              <span className="anchor-arrow">→</span>
              <span className="anchor-col-time">新版时间</span>
              <span className="anchor-col-del" />
            </div>
            {rows.map((r, i) => {
              const errSides = parsed.parseErrors.get(i);
              const flagged = anchorIssue?.rows.includes(i) ?? false;
              return (
                <div className={`anchor-row${flagged ? ' flagged' : ''}`} key={i}>
                  <span className="anchor-col-idx">{i + 1}</span>
                  <input
                    className={`anchor-input${errSides?.has('old') ? ' bad' : ''}`}
                    value={r.oldStr}
                    spellCheck={false}
                    aria-label={`第 ${i + 1} 组旧版时间`}
                    placeholder="00:00:00.000"
                    onChange={(e) => updateRow(i, 'old', e.target.value)}
                  />
                  <span className="anchor-arrow">→</span>
                  <input
                    className={`anchor-input${errSides?.has('new') ? ' bad' : ''}`}
                    value={r.newStr}
                    spellCheck={false}
                    aria-label={`第 ${i + 1} 组新版时间`}
                    placeholder="00:00:00.000"
                    onChange={(e) => updateRow(i, 'new', e.target.value)}
                  />
                  <span className="anchor-col-del">
                    <button
                      className="btn tiny danger"
                      title="删除该锚点"
                      disabled={rows.length <= 2}
                      onClick={() => removeRow(i)}
                    >
                      ✕
                    </button>
                  </span>
                </div>
              );
            })}
            <div className="anchor-add">
              <button className="btn small" onClick={addRow}>
                ＋ 添加锚点
              </button>
            </div>
          </div>

          {!allParsed && <div className="modal-error">存在无法解析的时间戳，请使用 HH:MM:SS.mmm 格式（红框处）</div>}
          {anchorIssue && <div className="modal-error">{anchorIssue.message}</div>}

          {preview && (
            <>
              <div className={`preview-summary${preview.valid ? '' : ' invalid'}`}>
                {preview.valid ? (
                  <span className="summary-ok">✓ 预览通过：{preview.cues.length} 条字幕均可安全映射</span>
                ) : (
                  <span className="summary-bad">
                    ⚠ {affectedCount} 条字幕存在问题，已禁止应用（{preview.issues.length} 处）
                  </span>
                )}
              </div>

              <div className="preview-scroll">
                <table className="preview-table">
                  <thead>
                    <tr>
                      <th className="col-idx">#</th>
                      <th className="col-old">旧版 起 → 止</th>
                      <th className="col-new">新版 起 → 止</th>
                      <th className="col-dur">时长</th>
                      <th className="col-issue">问题</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.cues.map((rc, i) => {
                      const hit = rc.issues.length > 0;
                      return (
                        <tr key={rc.cue.id} className={hit ? 'row-bad' : ''}>
                          <td className="col-idx">{i + 1}</td>
                          <td className="col-old mono">
                            {formatTimestamp(rc.oldStart)} → {formatTimestamp(rc.oldEnd)}
                          </td>
                          <td className="col-new mono">
                            <span className={rc.newStart < -1e-6 ? 'neg-time' : ''}>
                              {formatSigned(rc.newStart)}
                            </span>
                            {' → '}
                            <span className={rc.newEnd < -1e-6 ? 'neg-time' : ''}>
                              {formatSigned(rc.newEnd)}
                            </span>
                            {(rc.extrapolatedStart || rc.extrapolatedEnd) && (
                              <span className="ext-tag" title="区间外按最近一段斜率外推">
                                外推
                              </span>
                            )}
                          </td>
                          <td className="col-dur mono">
                            <span className={rc.newEnd - rc.newStart < MIN_DURATION - 1e-6 ? 'neg-time' : ''}>
                              {Math.max(0, Math.round((rc.newEnd - rc.newStart) * 1000))}ms
                            </span>
                          </td>
                          <td className="col-issue">
                            {rc.issues.map((code) => (
                              <span key={code} className="issue-tag">
                                {ISSUE_LABEL[code]}
                              </span>
                            ))}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>

        <div className="modal-actions">
          <button className="btn" onClick={onClose}>
            取消
          </button>
          <button
            className="btn primary"
            disabled={!preview || !preview.valid}
            onClick={() => {
              if (!preview) return;
              // 按当前字幕顺序写回新时间，文本与 id 保留
              const byId = new Map(preview.cues.map((rc) => [rc.cue.id, rc.cue]));
              onApply(cues.map((c) => byId.get(c.id) ?? c));
            }}
          >
            应用映射
          </button>
        </div>
      </div>
    </div>
  );
}
