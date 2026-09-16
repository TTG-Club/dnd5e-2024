import type {
  AbilityType,
  DamagePartTarget,
  MeasurementTemplate,
  SceneEntity,
  SpellSaveType,
  Token,
  TypedWebSocketClient,
} from '@vtt/shared';
import type {
  ActiveEffect,
  CreatureCategory,
  DamageDefenseOutcome,
  SaveDamageDefense,
  Spell,
  TargetHpGate,
} from '@vtt/shared/system/dnd.js';

import type { RollBonusEvaluator } from './rollBonusEvaluator';

import { useSpellTemplateStore } from '@/stores/spellTemplateStore';
import { generateId } from '@vtt/shared';
import {
  CREATURE_TYPE_LABELS,
  DAMAGE_TYPE_LABELS,
  damageReachesTarget,
  getTargetSpellEffects,
  hasSourceTurnSaveDc,
  isDndSceneEntity,
  listIgnoredResistances,
  resolveActorStats,
  SAVE_TYPE_LABELS,
  stampAppliedEffect,
  withInitializedDuration,
} from '@vtt/shared/system/dnd.js';

import { SAVING_THROW_ROLL_LABELS } from '../ui/actor/constants';
import { resolveActiveTurnActorId } from './encounterTurn';
import { useWorldEntities } from './useWorldEntities';

// Выбор эффектов заклинания по доставке живёт в движке (его проверяют тесты
// правил), клиентские пути берут его отсюда же, как раньше
export {
  getCasterSpellEffects,
  getTargetSpellEffects,
  getZoneSpellEffects,
} from '@vtt/shared/system/dnd.js';

/** Результат спасброска одной цели */
export interface SpellTargetResult {
  /** Имя актора-цели */
  actorName: string;
  /** ID актора */
  actorId: string;
  /** Бросок спасброска (1к20 + modifier) */
  saveRoll?: number;
  /** Модификатор спасброска */
  saveModifier?: number;
  /** Успешен ли спасбросок */
  savePassed?: boolean;
  /** Итоговый урон, применённый к цели */
  damageApplied: number;
  /** Итоговое лечение, применённое к цели (до клампа максимумом HP) */
  healApplied?: number;
  /** HP до применения */
  hpBefore: number;
  /** HP после применения */
  hpAfter: number;
  /** Полученные временные ХП (прирост; 0 — если текущие временные были выше) */
  tempHpGained?: number;
  /** Сработавшая защита от урона (иммунитет/сопротивление/уязвимость) */
  defenseOutcome?: DamageDefenseOutcome;
  /** Названия наложенных эффектов */
  appliedEffects?: string[];
}

/** Контекст для обработки заклинания */
export interface SpellResolutionContext {
  /** Заклинание */
  spell: Spell;
  /** Итоговый урон от броска кастера */
  damageTotal: number;
  /** DC спасброска заклинателя */
  spellSaveDC: number;
  /** Массив сущностей мира (акторы + существа, для поиска по actorId) */
  actors: SceneEntity[];
  /** Сокет для отправки обновлений сущностей */
  socket: TypedWebSocketClient;
  /** Переопределённый тип урона (выбран игроком для заклинаний с damageType: 'choice') */
  overrideDamageType?: string;
  /** ID заклинателя (для маршрутизации частей с target: 'self') */
  casterId?: string;
}

/**
 * Часть урона/лечения с уже разрешённой формулой (вход для броска в модалке).
 */
export interface SpellDamagePartInput {
  /** Формула с подставленными @-переменными (готова для роллера) */
  formula: string;
  /** Основной тип урона (для лечения не используется) */
  type?: string;
  /** Все типы урона части, если их несколько (напр. рубящий+огонь) */
  types?: string[];
  /** Является ли часть лечением */
  isHealing: boolean;
  /** Лечение временными ХП (`@heal.temp`): с текущими временными — большее */
  healTemp?: boolean;
  /** Цель части */
  target: DamagePartTarget;
  /** Применять только если по заклинанию был нанесён урон */
  requiresDamage: boolean;
  /** Гейт по состоянию HP цели (per-target ветка @target.full/@target.notFull) */
  targetGate?: TargetHpGate;
  /** Гейт по типу существа цели (per-target ветка @target.type.<тип>) */
  targetTypeGate?: CreatureCategory;
  /** Часть получает усиление высших кругов (слот-скейлинг) при броске */
  applySlotScaling?: boolean;
}

/**
 * Часть урона/лечения с уже брошенным значением (результат броска в модалке).
 */
export interface RolledSpellDamagePart {
  /** Брошенное значение части (сумма) */
  amount: number;
  /** Брошенная формула (после масштабирования/крита), напр. "2к8" */
  formula: string;
  /** Значения отдельных кубиков (для разбивки в чате) */
  values: number[];
  /** Основной тип урона */
  type?: string;
  /** Все типы урона части, если их несколько (напр. рубящий+огонь) */
  types?: string[];
  /** Является ли часть лечением */
  isHealing: boolean;
  /** Лечение временными ХП (`@heal.temp`): с текущими временными — большее */
  healTemp?: boolean;
  /** Цель части */
  target: DamagePartTarget;
  /** Применять только если по заклинанию был нанесён урон */
  requiresDamage: boolean;
  /** Гейт по состоянию HP цели (per-target ветка @target.full/@target.notFull) */
  targetGate?: TargetHpGate;
  /** Гейт по типу существа цели (per-target ветка @target.type.<тип>) */
  targetTypeGate?: CreatureCategory;
  /** Часть брошена критом: событиям урона цели нужен крит */
  critical?: boolean;
}

/** Контекст AoE шаблона */
export interface AoeContext {
  /** Шаблон измерения на сцене */
  template: MeasurementTemplate;
  /** Токены сцены */
  tokens: readonly Token[];
  /** Размер клетки в пикселях */
  gridSize: number;
}

/** Результат информации о спасброске актора */
export interface ActorSaveInfo {
  modifier: number;
  evaluateBonusRollFormulas: RollBonusEvaluator;
  hasAdvantage: boolean;
  hasDisadvantage: boolean;
  autoFail: boolean;
}

/**
 * Собирает строку в чат о свёрнутом действии: окно спасброска закрыли, не
 * бросив.
 *
 * Общая для обоих путей разрешения (многочастного и одночастного): отмена
 * должна выглядеть в чате одинаково, кто бы её ни поймал.
 *
 * @param actionName - название заклинания или действия существа
 * @returns готовая строка сообщения
 */
export function formatSaveCancelledMessage(actionName: string): string {
  return `${actionName}${SAVING_THROW_ROLL_LABELS.cancelledSuffix}`;
}

/**
 * Подпись броска спасброска для чата: «Спасбросок Ловкости — Арт».
 *
 * @param ability - характеристика спасброска
 * @param entityName - имя цели
 * @returns подпись броска
 */
export function formatSavingThrowRollLabel(
  ability: AbilityType,
  entityName: string,
): string {
  const abilityLabel = SAVE_TYPE_LABELS[ability];

  return `${SAVING_THROW_ROLL_LABELS.rollPrefix}${abilityLabel}${SAVING_THROW_ROLL_LABELS.nameSeparator}${entityName}`;
}

/**
 * Заголовок окна спасброска: подпись броска плюс сложность.
 *
 * Общий у своего окна и у окна адресата по запросу — цель и сложность в них
 * одни и те же, и расходиться подписи не должны.
 *
 * @param ability - характеристика спасброска
 * @param entityName - имя цели
 * @param dc - сложность
 * @returns заголовок окна
 */
export function formatSavingThrowTitle(
  ability: AbilityType,
  entityName: string,
  dc: number,
): string {
  return `${formatSavingThrowRollLabel(ability, entityName)}${SAVING_THROW_ROLL_LABELS.dcPrefix}${dc}${SAVING_THROW_ROLL_LABELS.dcSuffix}`;
}

/**
 * Определяет режим атаки из флагов преимущества/помехи.
 *
 * @param hasAdvantage - есть ли преимущество
 * @param hasDisadvantage - есть ли помеха
 * @returns строковый режим для DiceRollModal
 */
export function determineRollMode(
  hasAdvantage: boolean,
  hasDisadvantage: boolean,
): 'normal' | 'advantage' | 'disadvantage' {
  if (hasAdvantage && !hasDisadvantage) {
    return 'advantage';
  }

  if (hasDisadvantage && !hasAdvantage) {
    return 'disadvantage';
  }

  return 'normal';
}

/**
 * Проверяет, проходит ли часть гейт состояния HP цели.
 *
 * Части без гейта применяются всегда. Гейт `full` пропускает часть только
 * к целям с полным HP, `notFull` — только к раненым, `halfOrLess` — только
 * к целям с HP ≤ половины (отложенное условие «Окровавлен»). Состояние цели
 * оценивается в момент применения, отдельно для каждой цели.
 *
 * @param part - брошенная часть
 * @param entity - сущность-цель
 * @returns true если часть применяется к этой цели
 */
export function partPassesTargetGate(
  part: RolledSpellDamagePart,
  entity: SceneEntity,
): boolean {
  if (!part.targetGate && !part.targetTypeGate) {
    return true;
  }

  // Чужая запись ни хитов, ни типа в D&D-форме не несёт — условная ветка ей не
  // достаётся вовсе, а не «проходит по умолчанию»
  return isDndSceneEntity(entity) && damageReachesTarget(part, entity);
}

/** Подписи гейт-веток состояния HP цели (для чата и описаний выбора цели). */
export const TARGET_GATE_LABELS: Record<TargetHpGate, string> = {
  full: 'при полном HP',
  notFull: 'при неполном HP',
  halfOrLess: 'при HP ≤ половины',
};

/**
 * Формирует суффикс гейт-ветки для строки части в чате.
 *
 * Гейты складываются: часть может быть и «по нежити», и «при полном HP».
 *
 * @param targetGate - гейт по состоянию HP (если есть)
 * @param targetTypeGate - гейт по типу существа (если есть)
 * @returns суффикс вида « (по нежити, при полном HP)» или пустая строка
 */
export function formatTargetGateSuffix(
  targetGate: TargetHpGate | undefined,
  targetTypeGate?: CreatureCategory,
): string {
  const parts: string[] = [];

  if (targetTypeGate) {
    parts.push(`по цели: ${CREATURE_TYPE_LABELS[targetTypeGate]}`);
  }

  if (targetGate) {
    parts.push(TARGET_GATE_LABELS[targetGate]);
  }

  return parts.length > 0 ? ` (${parts.join(', ')})` : '';
}

/**
 * Type guard: является ли тип спасброска характеристикой (не `none`).
 *
 * `SpellSaveType` — это `'none' | AbilityType`, поэтому отсечение `'none'`
 * безопасно сужает значение до `AbilityType` без приведения типов.
 *
 * @param saveType - тип спасброска заклинания
 * @returns true, если это характеристика для спасброска
 */
export function isSaveAbility(
  saveType: SpellSaveType,
): saveType is AbilityType {
  return saveType !== 'none';
}

/**
 * Сопротивления, которые игнорирует урон атакующего («Сила могилы»).
 *
 * @param attackerId - атакующий; без него — ничего
 * @returns типы урона
 */
export function resolveAttackerIgnoredResistances(
  attackerId: string | undefined,
): string[] {
  if (!attackerId) {
    return [];
  }

  const attacker = useWorldEntities().findCurrentWorldEntity(attackerId);

  return attacker && isDndSceneEntity(attacker)
    ? listIgnoredResistances(resolveActorStats(attacker).activeFlags)
    : [];
}

/**
 * Защиты цели от урона «половина при успехе» спасброска заклинания, оружия
 * или действия: «Увёртливость» и «успех против магии — без урона».
 *
 * @param entity - цель
 * @param spell - заклинание или псевдо-заклинание броска
 * @returns защиты либо `undefined`, если спасброска или данных системы нет
 */
export function buildSaveDamageDefense(
  entity: SceneEntity,
  spell: Spell,
): SaveDamageDefense | undefined {
  if (!isSaveAbility(spell.saveType) || !isDndSceneEntity(entity)) {
    return undefined;
  }

  return {
    flags: resolveActorStats(entity).activeFlags,
    ability: spell.saveType,
    // Спасброски этих путей навязаны магией — как и у запроса броска
    againstMagic: true,
  };
}

/**
 * Эффект в момент наложения по текущему ходу боя: наложивший запоминается
 * всегда, точная turn-длительность привязывается к ходу. Одна точка для всех
 * путей наложения заклинания — иначе путь без неё терял «ход наложившего» и
 * «до конца хода заклинателя».
 *
 * @param effect - накладываемый эффект
 * @param parties - носитель, наложивший и каст
 * @param parties.carrierId - сущность, на которую ложится эффект
 * @param parties.sourceId - наложивший, если известен
 * @param parties.castId - каст с концентрацией: его конец снимет эффект
 * @returns эффект, готовый лечь на носителя
 */
export function stampEffectOnApply(
  effect: ActiveEffect,
  parties: { carrierId: string; sourceId?: string; castId?: string },
): ActiveEffect {
  const { castId, ...stampParties } = parties;

  const stamped = stampAppliedEffect(effect, {
    ...stampParties,
    activeTurnActorId: resolveActiveTurnActorId(),
  });

  return castId ? { ...stamped, castId } : stamped;
}

/**
 * Нужен ли эффектам на цель разбор оркестратором, а не прямое наложение: свой
 * спасбросок, урон эффекта или повторный спасбросок с Сл 0 («Сл заклинателя»).
 * Прямое наложение ничего из этого не умеет — эффект лёг бы без броска, без
 * урона, а повторный спасбросок против Сл 0 проходился бы всегда.
 *
 * @param spell - заклинание
 * @returns `true`, если хоть один эффект на цель требует разбора
 */
export function targetEffectsNeedResolution(spell: Spell): boolean {
  return getTargetSpellEffects(spell).some(
    (effect) =>
      effect.applySave !== undefined
      || (effect.damageParts?.length ?? 0) > 0
      || hasSourceTurnSaveDc(effect),
  );
}

/**
 * Собирает строку чата о наложенных эффектах заклинания. Одна форма на
 * заклинателя, выбранную цель и несколько целей эффекта — чтобы касты из
 * листа и с хотбара выглядели в чате одинаково.
 *
 * @param spellName - название заклинания
 * @param targetNames - имена получивших эффекты
 * @param effects - наложенные эффекты
 * @returns готовая строка сообщения
 */
export function formatSpellEffectsMessage(
  spellName: string,
  targetNames: readonly string[],
  effects: readonly ActiveEffect[],
): string {
  const effectNames = effects.map((effect) => effect.name).join(', ');

  return `${spellName}\n→ ${targetNames.join(', ')}: [${effectNames}]`;
}

/**
 * Создаёт независимые копии эффектов для наложения на сущность: новый уникальный
 * `id` (чтобы повторные касты не конфликтовали) и `origin: 'spell'`. Применяется
 * к эффектам, накладываемым на заклинателя (target-эффекты идут через
 * `targetStore.applyEffectsToTarget`, у которого свой инстанцирующий хелпер).
 *
 * @param effects - исходные эффекты заклинания
 * @returns новые эффекты, готовые к добавлению в `activeEffects`
 */
export function instantiateSpellEffects(
  effects: ActiveEffect[],
): ActiveEffect[] {
  return effects.map((effect) =>
    withInitializedDuration({
      ...effect,
      id: generateId('effect'),
      origin: 'spell',
    }),
  );
}

/**
 * Возвращает локализованное название типа урона или исходную строку.
 *
 * @param type - тип урона
 * @returns русское название или исходная строка
 */
export function getDamageTypeLabel(
  type: string | undefined,
): string | undefined {
  if (!type) {
    return undefined;
  }

  const labels: Record<string, string> = DAMAGE_TYPE_LABELS;

  return labels[type] ?? type;
}

/**
 * Лейбл вида части: «Лечение» / «Временные ХП» / локализованный тип урона.
 *
 * @param part - часть урона/лечения (брошенная или входная)
 * @param part.isHealing - является ли часть лечением
 * @param part.healTemp - лечение временными ХП (`@heal.temp`)
 * @param part.type - тип урона (для лечения не используется)
 * @param part.types - все типы урона части, если их несколько (рубящий+огонь)
 * @returns подпись вида для чата и описаний
 */
export function getPartKindLabel(part: {
  isHealing: boolean;
  healTemp?: boolean;
  type?: string;
  types?: string[];
}): string {
  if (part.isHealing) {
    return part.healTemp ? 'Временные ХП' : 'Лечение';
  }

  // Несколько типов (напр. рубящий+огонь) — показываем через « и »
  if (part.types && part.types.length > 1) {
    const labels = part.types
      .map((type) => getDamageTypeLabel(type) ?? type)
      .filter(Boolean);

    if (labels.length > 0) {
      return labels.join(' и ');
    }
  }

  return getDamageTypeLabel(part.type) ?? 'Урон';
}

/**
 * Формирует строку разбивки брошенной части для чата: формула, лейбл
 * (тип урона/«Лечение»), гейт-ветка, выпавшие кубики, сумма и маркер защиты.
 *
 * @param rolledPart - брошенная часть
 * @param defenseSuffix - суффикс защиты цели (уязв./сопр./иммун.), если есть
 * @returns строка вида «1к8 Огонь (при полном HP): [5] = 5»
 */
export function formatRolledPartLine(
  rolledPart: RolledSpellDamagePart,
  defenseSuffix = '',
): string {
  const label = getPartKindLabel(rolledPart);

  const gateSuffix = formatTargetGateSuffix(
    rolledPart.targetGate,
    rolledPart.targetTypeGate,
  );

  const diceBreakdown =
    rolledPart.values.length > 0 ? `[${rolledPart.values.join(', ')}] = ` : '';

  return `${rolledPart.formula} ${label}${gateSuffix}: ${diceBreakdown}${rolledPart.amount}${defenseSuffix}`;
}

/**
 * Снимает размещённый AoE-шаблон отменённого каста: чистит кэш его данных и
 * убирает шаблон со сцены.
 *
 * Шаблон встаёт на карту ДО окна броска, поэтому закрытое без броска окно
 * обязано его убрать — иначе отменённая область висит на сцене до её
 * перезагрузки. Доведённый до применения каст снимает шаблон сам: там его
 * данные сперва забирают в кэш, по нему считаются задетые цели.
 *
 * @param templateId - id размещённого шаблона
 */
export function discardSpellTemplate(templateId: string): void {
  const templateStore = useSpellTemplateStore();

  templateStore.removePlacedTemplate(templateId);
  templateStore.deleteTemplate(templateId);
}
