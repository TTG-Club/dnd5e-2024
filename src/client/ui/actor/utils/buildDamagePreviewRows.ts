/**
 * Строки итога формулы урона для показа под полем ввода.
 *
 * Ветки и слагаемые приходят готовыми из движка (`previewDamagePart`) — здесь
 * только подписи: условие ветки словами и плашки типов урона или лечения.
 */

import type {
  DamagePartPreview,
  DamagePreviewBranch,
  DamagePreviewSegment,
  TargetHpGate,
} from '@vtt/shared/system/dnd.js';

import {
  CHOICE_DAMAGE_TYPE,
  CREATURE_CATEGORIES,
} from '@vtt/shared/system/dnd.js';

import { DAMAGE_PART_LABELS } from '../constants';

/** Плашка слагаемого: тип урона или вид лечения */
export interface DamagePreviewBadge {
  /** Подпись плашки */
  label: string;
  /** Цвет плашки */
  color: 'neutral' | 'success' | 'info' | 'warning' | 'error';
}

/** Слагаемое итога, готовое к показу */
export interface DamagePreviewSegmentRow {
  /** Формула словами */
  formula: string;
  /** Плашки типов урона или вида лечения */
  badges: DamagePreviewBadge[];
}

/** Строка итога: условие ветки и её слагаемые */
export interface DamagePreviewRow {
  /** Ключ строки для списка */
  key: string;
  /** Условие ветки словами; пусто — ветка для любой цели */
  condition: string;
  /** Слагаемые ветки */
  segments: DamagePreviewSegmentRow[];
}

/** Подписи условия по хитам цели */
const HP_GATE_LABELS: Record<TargetHpGate, string> = {
  full: DAMAGE_PART_LABELS.previewFullHp,
  notFull: DAMAGE_PART_LABELS.previewNotFullHp,
  halfOrLess: DAMAGE_PART_LABELS.previewHalfHp,
};

/**
 * Плашка типа урона. Тип, которого нет в мире, красный: при броске он не
 * найдёт ни защит, ни подписи — скорее всего, это опечатка в токене.
 *
 * @param damageType - ключ типа урона
 * @param typeLabels - названия типов урона мира по ключу
 * @returns плашка типа
 */
function describeDamageType(
  damageType: string,
  typeLabels: ReadonlyMap<string, string>,
): DamagePreviewBadge {
  if (damageType === CHOICE_DAMAGE_TYPE) {
    return { label: DAMAGE_PART_LABELS.previewChoiceType, color: 'neutral' };
  }

  const label = typeLabels.get(damageType);

  return label
    ? { label, color: 'neutral' }
    : { label: damageType, color: 'error' };
}

/**
 * Плашки слагаемого: вид лечения, типы урона или «без типа» — урон без типа
 * жёлтый, потому что в правилах 2024 года у любого урона есть тип.
 *
 * @param segment - слагаемое итога
 * @param typeLabels - названия типов урона мира по ключу
 * @returns плашки слагаемого
 */
function describeSegmentBadges(
  segment: DamagePreviewSegment,
  typeLabels: ReadonlyMap<string, string>,
): DamagePreviewBadge[] {
  if (segment.healing === 'hp') {
    return [{ label: DAMAGE_PART_LABELS.healing, color: 'success' }];
  }

  if (segment.healing === 'temp') {
    return [{ label: DAMAGE_PART_LABELS.previewTempHp, color: 'info' }];
  }

  if (segment.types.length === 0) {
    return [{ label: DAMAGE_PART_LABELS.previewUntyped, color: 'warning' }];
  }

  return segment.types.map((damageType) =>
    describeDamageType(damageType, typeLabels),
  );
}

/**
 * Условие ветки словами.
 *
 * @param branch - ветка итога
 * @returns условие; пустая строка — ветка для любой цели
 */
function describeBranchCondition(branch: DamagePreviewBranch): string {
  const conditions: string[] = [];

  if (branch.hpGate) {
    conditions.push(HP_GATE_LABELS[branch.hpGate]);
  }

  if (branch.typeGate) {
    conditions.push(
      `${CREATURE_CATEGORIES[branch.typeGate]}${DAMAGE_PART_LABELS.previewTypeGateSuffix}`,
    );
  }

  return conditions.join(' · ');
}

/**
 * Строки итога формулы урона: по одной на ветку, с условием и плашками.
 *
 * @param preview - итог формулы из движка
 * @param typeLabels - названия типов урона мира по ключу
 * @returns строки для показа
 */
export function buildDamagePreviewRows(
  preview: DamagePartPreview,
  typeLabels: ReadonlyMap<string, string>,
): DamagePreviewRow[] {
  return preview.branches.map((branch, branchIndex) => ({
    key: `${branchIndex}:${branch.hpGate ?? ''}:${branch.typeGate ?? ''}`,
    condition: describeBranchCondition(branch),
    segments: branch.segments.map((segment) => ({
      formula: segment.formula,
      badges: describeSegmentBadges(segment, typeLabels),
    })),
  }));
}
