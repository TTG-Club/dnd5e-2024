/**
 * Локальные типы редактирования особенностей вида (форма «Создать/Редактировать
 * вид»). Подвид (вариант) сам владеет своими уровне-зависимыми особенностями —
 * поэтому редактируемая особенность и вложенная особенность подвида имеют общий
 * набор полей {@link EditableFeatureFields}.
 */

import type {
  ActiveEffect,
  ConditionKey,
  DamageDefenseEntry,
  GrantedSpellRef,
} from '@vtt/shared/system/dnd.js';

import type { EditableFeatGrants } from '../feat/featEditorTypes';

/** Оси скорости движения, редактируемые у особенности вида. */
export const MOVEMENT_AXES = [
  'walk',
  'fly',
  'swim',
  'climb',
  'burrow',
] as const;

export type MovementAxis = (typeof MOVEMENT_AXES)[number];

/** Общие поля особенности (как базовой, так и особенности подвида). */
export interface EditableFeatureFields {
  key: string;
  name: string;
  description: string;
  level: number;
  isInformationalOnly: boolean;
  movement: Record<MovementAxis, number>;
  darkvision: number;
  /** Выдаваемые заклинания: имя + опц. связь с компендиумом (`spellId`). */
  grantedSpells: GrantedSpellRef[];
  /**
   * Выданные заклинания готовить не нужно — отметка на весь список
   * особенности, как у группы класса, черты и предыстории. У вида это
   * по умолчанию так (врождённая магия), поэтому в запись пишется только
   * снятая отметка: `alwaysPrepared: false` у каждого заклинания.
   */
  grantedSpellsAlwaysPrepared: boolean;
  /** Активные эффекты особенности; переносятся на персонажа вместе с ней. */
  activeEffects: ActiveEffect[];
  /**
   * Дары особенности строками — та же редактируемая модель, что у черты
   * (`featDataToGrants`/`buildFeatData`): владения, выборы, правки листа.
   * Простые поля `movement`/`darkvision` выше остаются как быстрый путь.
   */
  grants: EditableFeatGrants;
}

/** Вариант особенности (подвид) с собственными вложенными особенностями. */
export interface EditableChoice {
  key: string;
  name: string;
  description: string;
  features: EditableFeatureFields[];
  /** Защиты от урона, которые даёт этот подвид (как у драконорождённых). */
  damageDefenses: DamageDefenseEntry[];
  /** Иммунитеты к состояниям, которые даёт этот подвид. */
  conditionImmunities: ConditionKey[];
}

/** Базовая особенность вида: общие поля плюс варианты-подвиды. */
export interface EditableFeature extends EditableFeatureFields {
  choices: EditableChoice[];
}

/** Создаёт пустую запись скорости движения (все оси по нулям). */
export function createEmptyMovement(): Record<MovementAxis, number> {
  return { walk: 0, fly: 0, swim: 0, climb: 0, burrow: 0 };
}

/**
 * Отметка «Подготавливать не нужно» для списка заклинаний особенности вида.
 * Врождённая магия вида подготовки не требует, поэтому отметка стоит, пока
 * запись прямо не сняла её у заклинаний.
 *
 * @param spells - выданные заклинания записи
 * @returns `true`, если готовить заклинания не нужно
 */
export function readGrantedSpellsAlwaysPrepared(
  spells: readonly GrantedSpellRef[],
): boolean {
  return spells.every((spell) => spell.alwaysPrepared !== false);
}

/**
 * Поле подготовки выданного заклинания вида для записи. Пишется только
 * снятая отметка: без поля заклинание вида и так всегда подготовлено.
 *
 * @param alwaysPrepared - отметка «Подготавливать не нужно» у особенности
 * @returns поле для записи заклинания
 */
export function writeGrantedSpellPreparation(
  alwaysPrepared: boolean,
): Pick<GrantedSpellRef, 'alwaysPrepared'> {
  return alwaysPrepared ? {} : { alwaysPrepared: false };
}
