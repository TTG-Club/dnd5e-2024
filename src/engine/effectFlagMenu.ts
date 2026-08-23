/**
 * Меню «Готовые» для блока флагов формы активного эффекта.
 *
 * Флагов под сотню, и вписывать их ключами руками автор не обязан: меню
 * предлагает те же русские подписи, что и библиотека флагов, но разложенные по
 * разделам — атаки, проверки, спасброски, защиты от урона, прочее.
 *
 * У защит от урона разделов два уровня: сорок с лишним флагов одним списком не
 * помещаются даже на высокий экран, поэтому они разложены по виду защиты
 * (сопротивление, иммунитет, уязвимость) — внутри каждого ровно тринадцать
 * типов урона.
 *
 * Свой список флагов здесь НЕ заводится: разделы выводятся по приставке ключа
 * из того же {@link EFFECT_FLAG_LABELS}, которым живут библиотека флагов формы,
 * проверка `isEffectFlagKey` и авто-описание эффекта. Второй список рано или
 * поздно разошёлся бы с первым, и меню предлагало бы флаги, которых движок не
 * знает.
 *
 * @module system/dnd/effectFlagMenu
 */

import type { EffectFlagKey } from './activeEffectTypes.js';
import type { DamageDefenseKind } from './damageConstants.js';

import { typedObjectEntries } from '@vtt/shared';

import { EFFECT_FLAG_LABELS } from './activeEffectTypes.js';
import {
  DAMAGE_DEFENSE_KIND_LABELS,
  DAMAGE_TYPE_LABELS,
  isDefensibleDamageType,
} from './damageConstants.js';

/**
 * Раздел меню флагов. Виды защит от урона — тоже разделы, но вложенные: они
 * живут внутри «Защит от урона».
 */
export type EffectFlagGroup =
  | 'attack'
  | 'attacksAgainst'
  | 'abilityCheck'
  | 'skills'
  | 'saves'
  | 'saveAutoFail'
  | 'damageDefense'
  | DamageDefenseKind
  | 'other';

/**
 * Подписи разделов меню флагов. Виды защит переиспользуют единый справочник —
 * иначе «Сопротивление» пришлось бы держать в двух местах.
 */
const EFFECT_FLAG_GROUP_LABELS: Record<EffectFlagGroup, string> = {
  attack: 'Свои атаки',
  attacksAgainst: 'Атаки по носителю',
  abilityCheck: 'Проверки характеристик',
  skills: 'Навыки',
  saves: 'Спасброски',
  saveAutoFail: 'Автопровалы спасбросков',
  damageDefense: 'Защиты от урона',
  other: 'Прочее',
  ...DAMAGE_DEFENSE_KIND_LABELS,
};

/** Порядок разделов верхнего уровня — от самого частого к редкому. */
const GROUP_ORDER: readonly EffectFlagGroup[] = [
  'attack',
  'attacksAgainst',
  'abilityCheck',
  'saves',
  'saveAutoFail',
  'skills',
  'damageDefense',
  'other',
];

/** Виды защит в порядке показа — они же вложенные разделы «Защит от урона». */
const DAMAGE_DEFENSE_KINDS: readonly DamageDefenseKind[] = [
  'resistance',
  'immunity',
  'vulnerability',
];

/** Пункт меню флагов. */
export interface EffectFlagMenuItem {
  /** Ключ флага */
  key: EffectFlagKey;
  /**
   * Подпись пункта. У защит от урона — короткая (один тип урона): вид защиты
   * уже назван подписью вложенного раздела, и повторять его в каждой строке
   * значило бы читать «Сопротивление» четырнадцать раз подряд.
   */
  label: string;
}

/** Раздел меню со своими пунктами и (у защит) вложенными разделами. */
export interface EffectFlagMenuGroup {
  group: EffectFlagGroup;
  label: string;
  /** Пункты раздела; пусто у раздела, состоящего только из вложенных */
  items: EffectFlagMenuItem[];
  /** Вложенные разделы — второй уровень меню */
  groups?: EffectFlagMenuGroup[];
}

/**
 * Вид защиты от урона, заданный приставкой ключа флага.
 *
 * @param key - ключ флага
 * @returns вид защиты либо undefined (флаг не про защиту от урона)
 */
function damageDefenseKindOfFlag(key: string): DamageDefenseKind | undefined {
  return DAMAGE_DEFENSE_KINDS.find((kind) => key.startsWith(`${kind}.`));
}

/**
 * Раздел, к которому относится флаг. Определяется приставкой ключа — так новый
 * флаг попадает в меню сам, без правки этого файла.
 *
 * Порядок проверок важен: автопровал спасброска начинается с той же приставки
 * `save.`, что и обычные спасброски, и должен отобраться раньше.
 *
 * @param key - ключ флага
 */
function groupOfFlag(key: string): EffectFlagGroup {
  if (key.startsWith('save.autoFail.')) {
    return 'saveAutoFail';
  }

  if (key.startsWith('save.')) {
    return 'saves';
  }

  if (key.startsWith('attacksAgainst.')) {
    return 'attacksAgainst';
  }

  if (key.startsWith('attack.')) {
    return 'attack';
  }

  if (key.startsWith('abilityCheck.')) {
    return 'abilityCheck';
  }

  if (key.startsWith('skill.')) {
    return 'skills';
  }

  return damageDefenseKindOfFlag(key) ?? 'other';
}

/**
 * Подпись пункта. У защиты от урона — только тип урона: вид защиты назван
 * подписью вложенного раздела.
 *
 * @param key - ключ флага
 * @param fullLabel - подпись из справочника флагов
 */
function itemLabel(key: string, fullLabel: string): string {
  const kind = damageDefenseKindOfFlag(key);

  if (!kind) {
    return fullLabel;
  }

  const damageType = key.slice(kind.length + 1);

  return isDefensibleDamageType(damageType)
    ? DAMAGE_TYPE_LABELS[damageType]
    : fullLabel;
}

/** Собирает раздел по накопленным пунктам; пустой раздел не показывается. */
function buildGroup(
  group: EffectFlagGroup,
  byGroup: ReadonlyMap<EffectFlagGroup, EffectFlagMenuItem[]>,
): EffectFlagMenuGroup | undefined {
  if (group !== 'damageDefense') {
    const items = byGroup.get(group) ?? [];

    return items.length > 0
      ? { group, label: EFFECT_FLAG_GROUP_LABELS[group], items }
      : undefined;
  }

  // Защиты от урона: свои пунктов нет, всё лежит по видам защиты
  const groups = DAMAGE_DEFENSE_KINDS.map((kind) =>
    buildGroup(kind, byGroup),
  ).filter((nested): nested is EffectFlagMenuGroup => nested !== undefined);

  return groups.length > 0
    ? {
        group,
        label: EFFECT_FLAG_GROUP_LABELS[group],
        items: [],
        groups,
      }
    : undefined;
}

/** Собирает меню флагов разделами. */
function buildFlagMenu(): EffectFlagMenuGroup[] {
  const byGroup = new Map<EffectFlagGroup, EffectFlagMenuItem[]>();

  for (const [key, label] of typedObjectEntries(EFFECT_FLAG_LABELS)) {
    const group = groupOfFlag(key);
    const items = byGroup.get(group) ?? [];

    items.push({ key, label: itemLabel(key, label) });
    byGroup.set(group, items);
  }

  return GROUP_ORDER.map((group) => buildGroup(group, byGroup)).filter(
    (group): group is EffectFlagMenuGroup => group !== undefined,
  );
}

/**
 * Меню флагов разделами — готово к показу выпадающим списком.
 * Считается один раз: список флагов статичен.
 */
export const EFFECT_FLAG_MENU: readonly EffectFlagMenuGroup[] = buildFlagMenu();
