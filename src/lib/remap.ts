import type { Cue } from '../types';
import { MIN_DURATION } from './time';

const EPS = 1e-6;

/** 一组锚点：旧版时间 oldT → 新版时间 newT（单位：秒） */
export interface RemapAnchor {
  oldT: number;
  newT: number;
}

export type AnchorIssueCode = 'too-few' | 'empty' | 'old-not-strict' | 'new-not-strict';

export interface AnchorIssue {
  code: AnchorIssueCode;
  /** 出问题的锚点序号（从 0 起），用于在界面上标出对应行 */
  rows: number[];
  message: string;
}

export type CueIssueCode = 'negative-start' | 'too-short' | 'overlap';

export interface CueIssue {
  code: CueIssueCode;
  cueId: string;
  /** 重叠对象（仅 overlap） */
  otherId?: string;
  message: string;
}

export interface RemappedCue {
  cue: Cue;
  oldStart: number;
  oldEnd: number;
  newStart: number;
  newEnd: number;
  /** 起点落在锚点区间之外（按首段/末段斜率外推） */
  extrapolatedStart: boolean;
  extrapolatedEnd: boolean;
  issues: CueIssueCode[];
}

export interface RemapPreview {
  anchors: RemapAnchor[];
  cues: RemappedCue[];
  issues: CueIssue[];
  affectedIds: Set<string>;
  get valid(): boolean;
}

/**
 * 校验锚点：至少两组，旧版时间与新版时间都必须严格递增。
 * rows 会标出违反递增的相邻行（两行都标出）。
 */
export function validateAnchors(anchors: RemapAnchor[]): AnchorIssue | null {
  if (anchors.length === 0) {
    return { code: 'empty', rows: [], message: '请至少填写两组锚点' };
  }
  if (anchors.length < 2) {
    return { code: 'too-few', rows: anchors.map((_, i) => i), message: '至少需要两组锚点' };
  }
  const badOld: number[] = [];
  const badNew: number[] = [];
  for (let i = 1; i < anchors.length; i++) {
    if (!(anchors[i].oldT > anchors[i - 1].oldT)) {
      badOld.push(i - 1, i);
    }
    if (!(anchors[i].newT > anchors[i - 1].newT)) {
      badNew.push(i - 1, i);
    }
  }
  if (badOld.length > 0) {
    return {
      code: 'old-not-strict',
      rows: [...new Set(badOld)],
      message: '旧版时间必须严格递增（不能相等或倒退）',
    };
  }
  if (badNew.length > 0) {
    return {
      code: 'new-not-strict',
      rows: [...new Set(badNew)],
      message: '新版时间必须严格递增（不能相等或倒退）',
    };
  }
  return null;
}

/**
 * 构造锚点分段线性映射：
 * - 落在相邻锚点区间内的时间按该段斜率线性映射；
 * - 区间外（早于第一组 / 晚于最后一组）按最近一段的斜率外推。
 */
export function buildMapper(anchors: RemapAnchor[]): (t: number) => number {
  return (t: number) => {
    if (t <= anchors[0].oldT) {
      const a = anchors[0];
      const b = anchors[1];
      return a.newT + ((t - a.oldT) * (b.newT - a.newT)) / (b.oldT - a.oldT);
    }
    if (t >= anchors[anchors.length - 1].oldT) {
      const b = anchors[anchors.length - 1];
      const a = anchors[anchors.length - 2];
      return b.newT + ((t - b.oldT) * (b.newT - a.newT)) / (b.oldT - a.oldT);
    }
    for (let i = 0; i + 1 < anchors.length; i++) {
      const a = anchors[i];
      const b = anchors[i + 1];
      if (t >= a.oldT && t <= b.oldT) {
        return a.newT + ((t - a.oldT) * (b.newT - a.newT)) / (b.oldT - a.oldT);
      }
    }
    return t; // 理论上不可达
  };
}

/** 对每条字幕的起点、终点分别做映射；文本与 id 原样保留 */
export function remapCues(cues: Cue[], anchors: RemapAnchor[]): Cue[] {
  const map = buildMapper(anchors);
  return cues.map((c) => ({ ...c, start: map(c.start), end: map(c.end) }));
}

/**
 * 生成应用前预览：逐条映射并检查三类问题——
 * 负起点、时长不足 300ms、相邻字幕重叠。任何一条存在问题则 valid=false，禁止应用。
 */
export function previewRemap(cues: Cue[], anchors: RemapAnchor[]): RemapPreview {
  const map = buildMapper(anchors);
  const firstOld = anchors[0].oldT;
  const lastOld = anchors[anchors.length - 1].oldT;

  // 预览按时间轴顺序检查；应用时仍按原数组顺序写回（文本/id 不变）
  const ordered = cues
    .map((cue) => {
      const newStart = map(cue.start);
      const newEnd = map(cue.end);
      const issues: CueIssueCode[] = [];
      if (newStart < -EPS) issues.push('negative-start');
      if (newEnd - newStart < MIN_DURATION - EPS) issues.push('too-short');
      return {
        cue: { ...cue, start: newStart, end: newEnd },
        oldStart: cue.start,
        oldEnd: cue.end,
        newStart,
        newEnd,
        extrapolatedStart: cue.start < firstOld - EPS,
        extrapolatedEnd: cue.end > lastOld + EPS,
        issues,
      } satisfies RemappedCue;
    })
    .sort((a, b) => a.newStart - b.newStart || a.newEnd - b.newEnd);

  const all: CueIssue[] = [];
  const affected = new Set<string>();

  for (const rc of ordered) {
    for (const code of rc.issues) {
      all.push({
        code,
        cueId: rc.cue.id,
        message:
          code === 'negative-start'
            ? `起点 ${formatSigned(rc.newStart)} 为负数`
            : `时长仅 ${formatDuration(rc.newEnd - rc.newStart)}，不足 300ms`,
      });
      affected.add(rc.cue.id);
    }
  }

  // 相邻字幕重叠（按新起点排序后逐对检查；输入本身重叠时也会被发现）
  for (let i = 0; i + 1 < ordered.length; i++) {
    const cur = ordered[i];
    const next = ordered[i + 1];
    if (cur.newEnd > next.newStart + EPS) {
      const msg = `与下一条字幕重叠（${formatSigned(cur.newEnd)} > ${formatSigned(next.newStart)}）`;
      all.push({ code: 'overlap', cueId: cur.cue.id, otherId: next.cue.id, message: msg });
      all.push({ code: 'overlap', cueId: next.cue.id, otherId: cur.cue.id, message: msg });
      affected.add(cur.cue.id);
      affected.add(next.cue.id);
      if (!cur.issues.includes('overlap')) cur.issues.push('overlap');
      if (!next.issues.includes('overlap')) next.issues.push('overlap');
    }
  }

  // 恢复调用方的原始顺序，便于与当前字幕列表一一对应
  const indexById = new Map(cues.map((c, i) => [c.id, i]));
  ordered.sort((a, b) => (indexById.get(a.cue.id) ?? 0) - (indexById.get(b.cue.id) ?? 0));

  return {
    anchors,
    cues: ordered,
    issues: all,
    affectedIds: affected,
    get valid() {
      return all.length === 0;
    },
  };
}

function formatDuration(seconds: number): string {
  return `${Math.max(0, Math.round(seconds * 1000))}ms`;
}

function formatSigned(seconds: number): string {
  const sign = seconds < -EPS ? '-' : '';
  const v = Math.abs(seconds);
  const h = Math.floor(v / 3600);
  const m = Math.floor((v % 3600) / 60);
  const s = Math.floor(v % 60);
  const ms = Math.round((v - Math.floor(v)) * 1000);
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${sign}${pad(h)}:${pad(m)}:${pad(s)}.${pad(ms, 3)}`;
}
