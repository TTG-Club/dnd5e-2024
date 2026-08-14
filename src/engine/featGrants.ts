/**
 * Чистые хелперы применения «даров» черты к актору.
 *
 * Эти функции используются и редактором черты (предпросмотр), и листом актёра
 * (применение при перетаскивании черты на персонажа и откат при удалении).
 * Применение владений к `system.proficiencies` остаётся на стороне клиента,
 * где доступны типы актора; здесь — только переносимые на актора структуры
 * (заклинания-источники, флаги защит, синтетический эффект черты).
 */

import type { DefensibleDamageType } from '@vtt/shared';

import type {
  ActiveEffect,
  EffectChange,
  EffectFlagKey,
} from './activeEffectTypes.js';
import type { DamageDefenseKind } from './damageConstants.js';
import type {
  FeatData,
  FeatHitPointsModifier,
  FeatModifiers,
} from './featTypes.js';
import type { GrantedSpellSource } from './grantedSpells.js';

import { generateId } from '@vtt/shared';

import { ABILITY_OPTIONS, isAbilityType } from './consts.js';
import { isDefensibleDamageType } from './damageConstants.js';

/**
 * Провенанс эффекта/заклинания, выданного чертой. По `originId === feat:<id>`
 * эффекты черты снимаются при её удалении, не задевая чужие источники.
 */
export const FEAT_ORIGIN_PREFIX = 'feat:';

/**
 * Провенанс даров предыстории. Та же машинерия даров (`buildFeatGrantEffect`,
 * `prepareTransferredFeatEffects`), но с префиксом `background:` — оптовый
 * фильтр `originId.startsWith('background:')` снимает все эффекты предыстории
 * одним проходом при её замене/удалении.
 */
export const BACKGROUND_ORIGIN_PREFIX = 'background:';

/**
 * Стабильный id синтетического эффекта-даров, выведенный из префикса провенанса:
 * `feat:` → `feat-grant:<id>` (как было), `background:` → `background-grant:<id>`.
 *
 * @param featureId - id источника даров (черты на акторе или ключ предыстории)
 * @param originPrefix - префикс провенанса
 */
function grantEffectId(featureId: string, originPrefix: string): string {
  return `${originPrefix.replace(/:$/, '-grant:')}${featureId}`;
}

/**
 * Формула прибавки к максимуму хитов.
 *
 * Слагаемое «за каждый уровень после взятия» пишется формулой с `@level`, а не
 * числом: оно растёт вместе с персонажем, и пересчитывать эффект на каждом
 * повышении уровня не пришлось бы — пайплайн эффектов считает `value` как
 * формулу при каждом обращении к листу.
 *
 * @param modifier - прибавка к хитам из механики черты
 * @param acquisitionLevel - уровень персонажа на момент взятия черты
 * @returns строка формулы или `null`, если прибавки нет
 */
function hitPointsFormula(
  modifier: FeatHitPointsModifier,
  acquisitionLevel: number,
): string | null {
  const parts: string[] = [];

  const flat =
    (modifier.flat ?? 0)
    + (modifier.perAcquisitionLevel ?? 0) * acquisitionLevel;

  if (flat !== 0) {
    parts.push(String(flat));
  }

  const perLevel = modifier.perLevelAfterAcquisition ?? 0;

  if (perLevel !== 0) {
    parts.push(`${perLevel} * (@level - ${acquisitionLevel})`);
  }

  return parts.length > 0 ? parts.join(' + ') : null;
}

/**
 * Разворачивает постоянные модификаторы черты в изменения активного эффекта.
 *
 * Скорость «равна скорости ходьбы» выражается формулой не может: `@`-переменной
 * скорости у пайплайна нет. Такой вид движения ставится режимом `upgrade` от
 * базовой скорости ходьбы персонажа — её передаёт вызывающий; без неё флаг
 * пропускается, чтобы не выставить полёт нулём.
 *
 * @param modifiers - постоянные модификаторы черты
 * @param context - уровень взятия и базовая скорость ходьбы персонажа
 */
function modifierChanges(
  modifiers: FeatModifiers,
  context: FeatGrantContext,
): EffectChange[] {
  const changes: EffectChange[] = [];
  const acquisitionLevel = context.acquisitionLevel ?? 1;

  if (modifiers.hitPoints) {
    const formula = hitPointsFormula(modifiers.hitPoints, acquisitionLevel);

    if (formula) {
      changes.push({
        key: 'hitPoints.max',
        mode: 'add',
        value: formula,
        priority: 20,
      });
    }
  }

  const speed = modifiers.speed;

  if (speed) {
    if (speed.walkBonus) {
      changes.push({
        key: 'movement.walk',
        mode: 'add',
        value: String(speed.walkBonus),
        priority: 20,
      });
    }

    for (const type of ['fly', 'climb', 'swim'] as const) {
      const explicit = speed[type];

      const equalsWalk =
        speed[
          `${type}EqualsWalk` as
            'flyEqualsWalk' | 'climbEqualsWalk' | 'swimEqualsWalk'
        ];

      const value = explicit ?? (equalsWalk ? context.walkSpeed : undefined);

      if (value) {
        changes.push({
          key: `movement.${type}`,
          mode: 'upgrade',
          value: String(value),
          priority: 20,
        });
      }
    }
  }

  if (modifiers.armorClassBonus) {
    changes.push({
      key: 'armorClass',
      mode: 'add',
      value: String(modifiers.armorClassBonus),
      priority: 20,
    });
  }

  if (modifiers.initiativeProficiencyBonus) {
    changes.push({
      key: 'initiative',
      mode: 'add',
      value: '@prof',
      priority: 20,
    });
  }

  return changes;
}

/** Презентация синтетического эффекта-даров (по умолчанию — черта). */
export interface GrantEffectPresentation {
  /** Префикс провенанса (`originId`). По умолчанию `feat:`. */
  originPrefix?: string;
  /** Префикс имени эффекта («Черта», «Предыстория»). По умолчанию «Черта». */
  namePrefix?: string;
  /** Существительное в род. падеже для описания («черты», «предыстории»). */
  noun?: string;
  /** Иконка эффекта. По умолчанию `tabler:star`. */
  icon?: string;
}

/**
 * Числа персонажа, без которых постоянные модификаторы черты не развернуть.
 * Передаются на применении: движок даров актора не видит.
 */
export interface FeatGrantContext {
  /**
   * Суммарный уровень персонажа на момент взятия черты — основа прибавки к
   * хитам. Не передан — считается первым уровнем.
   */
  acquisitionLevel?: number;
  /**
   * Базовая скорость ходьбы персонажа: от неё берутся виды движения, заданные
   * флагом «равна скорости ходьбы». Не передана — такие флаги пропускаются.
   */
  walkSpeed?: number;
  /**
   * Типы урона, выбранные игроком для сопротивления
   * ({@code modifiers.resistanceFromChoiceKey}). До выбора черта не знает, к чему
   * даёт сопротивление, поэтому в её дарах их нет.
   */
  chosenResistances?: string[];
  /**
   * Характеристики, выбранные игроком для повышения
   * ({@code abilityScoreIncrease.fromChoiceKey}) — так устроен «Устойчивый».
   */
  chosenAbilities?: string[];
}

/**
 * Формирует `originId` эффектов, принадлежащих источнику даров.
 *
 * @param featureId - id источника (черты на акторе или ключ предыстории)
 * @param originPrefix - префикс провенанса (по умолчанию `feat:`)
 */
export function featOriginId(
  featureId: string,
  originPrefix: string = FEAT_ORIGIN_PREFIX,
): string {
  return `${originPrefix}${featureId}`;
}

/**
 * Принадлежит ли активный эффект указанному источнику даров.
 *
 * @param effect - активный эффект
 * @param featureId - id источника даров
 * @param originPrefix - префикс провенанса (по умолчанию `feat:`)
 */
export function isFeatOwnedEffect(
  effect: ActiveEffect,
  featureId: string,
  originPrefix: string = FEAT_ORIGIN_PREFIX,
): boolean {
  return effect.originId === featOriginId(featureId, originPrefix);
}

/**
 * Собирает связи «заклинание компендиума → черта-источник» из `featData`.
 * Берёт только связанные с компендиумом (`spellId`) заклинания; дедуп по
 * `spellId`. Используется резолвером granted-заклинаний для подгрузки данных.
 *
 * @param feat - черта (имя-источник + блоб даров)
 * @param feat.name - имя черты (источник при выдаче/откате)
 * @param feat.featData - блоб даров черты с выдаваемыми заклинаниями
 */
export function collectFeatGrantedSpellSources(feat: {
  name: string;
  featData?: FeatData | null;
}): GrantedSpellSource[] {
  const sources: GrantedSpellSource[] = [];
  const seenSpellIds = new Set<string>();

  for (const ref of feat.featData?.grantedSpells ?? []) {
    if (!ref.spellId || seenSpellIds.has(ref.spellId)) {
      continue;
    }

    seenSpellIds.add(ref.spellId);

    sources.push({
      spellId: ref.spellId,
      featureName: feat.name,
      packId: ref.packId,
    });
  }

  return sources;
}

/**
 * Собирает флаги защит от урона (`resistance/immunity/vulnerability.<type>`) из
 * даров черты. Дедуп по типу урона: для типа берётся последний заданный вид.
 *
 * @param featData - блоб даров черты
 */
export function collectFeatDamageDefenseFlags(
  featData: FeatData | null | undefined,
): EffectFlagKey[] {
  const kindByType = new Map<DefensibleDamageType, DamageDefenseKind>();

  for (const entry of featData?.damageDefenses ?? []) {
    kindByType.set(entry.damageType, entry.kind);
  }

  const flags: EffectFlagKey[] = [];

  for (const [damageType, kind] of kindByType) {
    flags.push(`${kind}.${damageType}`);
  }

  return flags;
}

/**
 * Строит синтетический пассивный эффект даров черты: фиксированное повышение
 * характеристик (`ability.* add`), флаги защит от урона и иммунитеты к
 * состояниям. Возвращает `null`, если черта ничего из этого не даёт.
 *
 * Прибавка характеристик «на выбор» (`abilityScoreIncrease.choice`) сюда НЕ
 * входит — она требует выбора игрока и применяется отдельно.
 *
 * @param featureId - id примененной черты на акторе (для провенанса/отката)
 * @param featName - имя черты (для названия эффекта)
 * @param featData - блоб даров черты
 * @param presentation - провенанс и подписи (по умолчанию — черта)
 */
export function buildFeatGrantEffect(
  featureId: string,
  featName: string,
  featData: FeatData | null | undefined,
  presentation: GrantEffectPresentation = {},
  context: FeatGrantContext = {},
): ActiveEffect | null {
  const {
    originPrefix = FEAT_ORIGIN_PREFIX,
    namePrefix = 'Черта',
    noun = 'черты',
    icon = 'tabler:star',
  } = presentation;

  const changes: EffectChange[] = [];

  for (const { value: ability } of ABILITY_OPTIONS) {
    const bonus = featData?.abilityScoreIncrease?.fixed?.[ability];

    if (typeof bonus === 'number' && bonus !== 0) {
      changes.push({
        key: `ability.${ability}`,
        mode: 'add',
        value: String(bonus),
        priority: 20,
      });
    }
  }

  if (featData?.modifiers) {
    changes.push(...modifierChanges(featData.modifiers, context));
  }

  const flags = collectFeatDamageDefenseFlags(featData);

  // Сопротивление по выбору: тип урона известен только после того, как игрок выбрал,
  // поэтому в дарах черты его нет — он приходит контекстом применения.
  // Выбор приходит строкой из записи листа, поэтому сверяется гвардом: чужой
  // тип урона дал бы флаг, который движок не понимает, и сопротивление молча
  // не работало бы
  for (const damageType of context.chosenResistances ?? []) {
    if (!isDefensibleDamageType(damageType)) {
      continue;
    }

    const flag: EffectFlagKey = `resistance.${damageType}`;

    if (!flags.includes(flag)) {
      flags.push(flag);
    }
  }

  // Повышение выбранной характеристики («Устойчивый» поднимает ту, спасбросками
  // которой овладел): само число берётся из описания повышения
  const chosenAmount = featData?.abilityScoreIncrease?.choice?.amount ?? 1;

  for (const ability of context.chosenAbilities ?? []) {
    // Характеристика тоже приходит строкой выбора — сверяем со справочником
    if (!isAbilityType(ability)) {
      continue;
    }

    changes.push({
      key: `ability.${ability}`,
      mode: 'add',
      value: String(chosenAmount),
      priority: 20,
    });
  }

  const conditionImmunities = featData?.conditionImmunities ?? [];

  if (
    changes.length === 0
    && flags.length === 0
    && conditionImmunities.length === 0
  ) {
    return null;
  }

  const effect: ActiveEffect = {
    id: grantEffectId(featureId, originPrefix),
    name: `${namePrefix}: ${featName}`,
    description: `Дары ${noun} «${featName}».`,
    icon,
    disabled: false,
    origin: 'feature',
    originId: featOriginId(featureId, originPrefix),
    transfer: false,
    duration: { type: 'permanent' },
    changes,
    flags,
  };

  if (conditionImmunities.length > 0) {
    effect.conditionImmunities = [...conditionImmunities];
  }

  return effect;
}

/**
 * Готовит активные эффекты, авторски заданные на черте, к переносу на актора:
 * каждому эффекту выдаётся новый id и провенанс черты (`originId = feat:<id>`),
 * `transfer` сбрасывается (на акторе эффект уже «развёрнут»). Отключённые
 * (`disabled`) эффекты сохраняются как есть — игрок может включить их позже.
 *
 * @param featureId - id примененной черты на акторе
 * @param authoredEffects - активные эффекты, заданные на черте (GameItem.activeEffects)
 * @param originPrefix - префикс провенанса (по умолчанию `feat:`)
 */
export function prepareTransferredFeatEffects(
  featureId: string,
  authoredEffects: ReadonlyArray<ActiveEffect> | undefined,
  originPrefix: string = FEAT_ORIGIN_PREFIX,
): ActiveEffect[] {
  return (authoredEffects ?? []).map((effect) => ({
    ...effect,
    id: generateId('effect'),
    origin: 'feature',
    originId: featOriginId(featureId, originPrefix),
    transfer: false,
  }));
}
