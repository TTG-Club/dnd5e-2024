/**
 * «Провал спасброска — вместо этого успех» за ресурс.
 *
 * «Легендарное сопротивление» босса (3/день), черты и предметы игроков
 * устроены одинаково: носитель провалил спасбросок и может потратить единицу
 * ресурса, чтобы преуспеть. Движок отвечает на три вопроса — есть ли чем
 * заплатить, сколько осталось и как списать; спрашивает владельца клиент, до
 * того как по итогу броска лягут урон и эффекты (`saveOverrideOffer.ts`).
 *
 * Откуда берётся возможность:
 * - поле эффекта `saveOverride` — у своего эффекта, надетого предмета, черты
 *   существа (всё, что собирает `collectActiveEffects`);
 * - число у черты существа `saveSuccessPerDay` — «Легендарное сопротивление
 *   (3/день)» из статблока без отдельного эффекта.
 *
 * Чем платит: своим счётчиком N раз до отдыха — он живёт в общих счётчиках
 * лимитов носителя (`system.effectUsage`) и сбрасывается отдыхом вместе с
 * ними; либо ресурсом листа (`system.classCounters`), как применение эффекта.
 *
 * @module system/dnd/saveOverride
 */

import type { AbilityType } from '@vtt/shared';

import type {
  EffectSaveOverride,
  SaveOverridePeriod,
} from './activeEffectTypes.js';
import type { DnDSceneEntity } from './dndEntities.js';
import type { EffectTriggerUsageLedger } from './effectTriggerUsage.js';
import type { EffectPromptOption } from './triggerPrompt.js';
import type { ActorCounterState } from './types.js';

import { z } from 'zod';

import { isActorEntity, isCreatureEntity } from '@vtt/shared';

import { ABILITY_GENITIVE_LABELS, isAbilityType } from './consts.js';
import { collectActiveEffects } from './effectPipeline.js';
import { readTriggerUsage } from './effectTriggerUsage.js';

/** Откуда носитель может превратить провал в успех */
export interface SaveOverrideSource {
  /** Ключ счётчика: у своего счётчика — ключ в `effectUsage` */
  key: string;
  /** Подпись в вопросе и в чате: «Легендарное сопротивление» */
  label: string;
  /** Как платит */
  override: EffectSaveOverride;
}

/** Возможность, которой ещё есть чем заплатить */
export interface AvailableSaveOverride {
  source: SaveOverrideSource;
  /** Сколько раз ещё можно, считая этот */
  remaining: number;
}

/** Приставка ключа своего счётчика в общих счётчиках носителя */
const SAVE_OVERRIDE_USAGE_PREFIX = 'saveOverride:';

/** День статблока — это долгий отдых */
const TRAIT_OVERRIDE_PERIOD: SaveOverridePeriod = 'longRest';

/**
 * Все возможности носителя превратить провал в успех — с эффектов и с чисел
 * у черт существа.
 *
 * @param entity - носитель
 * @returns возможности в порядке эффектов, затем черт
 */
export function listSaveOverrideSources(
  entity: DnDSceneEntity,
): SaveOverrideSource[] {
  const fromEffects = collectActiveEffects(entity).flatMap((effect) =>
    effect.saveOverride
      ? [
          {
            key: `${SAVE_OVERRIDE_USAGE_PREFIX}${effect.id}`,
            label: effect.name,
            override: effect.saveOverride,
          },
        ]
      : [],
  );

  const fromTraits = isCreatureEntity(entity)
    ? (entity.system.traits ?? []).flatMap((trait) => {
        const perDay = trait.saveSuccessPerDay;

        return typeof perDay === 'number'
          && Number.isInteger(perDay)
          && perDay > 0
          ? [
              {
                key: `${SAVE_OVERRIDE_USAGE_PREFIX}trait:${trait.name}`,
                label: trait.name,
                override: {
                  limit: { max: perDay, per: TRAIT_OVERRIDE_PERIOD },
                },
              },
            ]
          : [];
      })
    : [];

  return [...fromEffects, ...fromTraits];
}

/**
 * Ресурс листа, которым платит возможность.
 *
 * @param entity - носитель
 * @param override - как платит
 * @returns счётчик либо `undefined`, если платит не ресурсом листа
 */
function findOverrideCounter(
  entity: DnDSceneEntity,
  override: EffectSaveOverride,
): ActorCounterState | undefined {
  if (!override.counter || !isActorEntity(entity)) {
    return undefined;
  }

  return (entity.system.classCounters ?? []).find(
    (counter) => counter.counterKey === override.counter,
  );
}

/**
 * Сколько раз ещё можно превратить провал в успех этой возможностью.
 *
 * @param entity - носитель
 * @param source - возможность
 * @returns остаток; 0 — платить нечем
 */
export function countSaveOverrideUses(
  entity: DnDSceneEntity,
  source: SaveOverrideSource,
): number {
  const { override } = source;

  if (override.counter) {
    return Math.max(0, findOverrideCounter(entity, override)?.current ?? 0);
  }

  if (!override.limit) {
    return 0;
  }

  const used = readTriggerUsage(entity)[source.key]?.used ?? 0;

  return Math.max(0, override.limit.max - used);
}

/**
 * Первая возможность, которой ещё есть чем заплатить.
 *
 * @param entity - носитель, проваливший спасбросок
 * @returns возможность с остатком либо `null`
 */
export function findSaveOverride(
  entity: DnDSceneEntity,
): AvailableSaveOverride | null {
  for (const source of listSaveOverrideSources(entity)) {
    const remaining = countSaveOverrideUses(entity, source);

    if (remaining > 0) {
      return { source, remaining };
    }
  }

  return null;
}

/** Что меняется у носителя от траты */
export interface SaveOverrideSpending {
  effectUsage?: EffectTriggerUsageLedger;
  classCounters?: ActorCounterState[];
}

/**
 * Поля носителя после траты одной единицы — для патча сущности. Сама
 * сущность не меняется: на клиенте это объект стора хоста.
 *
 * @param entity - носитель
 * @param source - возможность
 * @returns изменённые поля `system`
 */
export function spendSaveOverride(
  entity: DnDSceneEntity,
  source: SaveOverrideSource,
): SaveOverrideSpending {
  const { override } = source;

  if (override.counter && isActorEntity(entity)) {
    return {
      classCounters: (entity.system.classCounters ?? []).map((counter) =>
        counter.counterKey === override.counter
          ? { ...counter, current: Math.max(0, counter.current - 1) }
          : counter,
      ),
    };
  }

  if (!override.limit) {
    return {};
  }

  const ledger = readTriggerUsage(entity);
  const used = (ledger[source.key]?.used ?? 0) + 1;

  return {
    effectUsage: {
      ...ledger,
      [source.key]: { used, per: override.limit.per },
    },
  };
}

/**
 * Метка нагрузки вопроса «преуспеть вместо провала?» в канале запросов ядра.
 * Отдельная, а не общий вопрос: у адресата ответ «да» ещё и списывает ресурс —
 * у существа ведущего писать в него вправе только ведущий.
 */
export const SAVE_OVERRIDE_REQUEST_KIND = 'saveOverride';

/** Самая длинная строка нагрузки вопроса */
const MAX_SAVE_OVERRIDE_TEXT_LENGTH = 300;

/** Zod-схема нагрузки вопроса «преуспеть вместо провала?» */
const saveOverrideRequestPayloadSchema = z.object({
  kind: z.literal(SAVE_OVERRIDE_REQUEST_KIND),
  /** Характеристика проваленного спасброска — для текста вопроса */
  ability: z.custom<AbilityType>(isAbilityType),
  /** Что бросали: «Огненный шар» — для заголовка окна */
  sourceName: z.string().max(MAX_SAVE_OVERRIDE_TEXT_LENGTH).optional(),
});

/** Нагрузка вопроса «преуспеть вместо провала?» */
export type SaveOverrideRequestPayload = z.infer<
  typeof saveOverrideRequestPayloadSchema
>;

/**
 * Разбирает нагрузку вопроса «преуспеть вместо провала?».
 *
 * @param value - нагрузка запроса
 * @returns нагрузка либо `null`, если это другой запрос
 */
export function parseSaveOverrideRequestPayload(
  value: unknown,
): SaveOverrideRequestPayload | null {
  const parsed = saveOverrideRequestPayloadSchema.safeParse(value);

  return parsed.success ? parsed.data : null;
}

/** Подписи вопроса и чата */
export const SAVE_OVERRIDE_LABELS = {
  /** Заголовок запроса в плашках ядра */
  requestTitle: 'Провал в успех',
  /** Кнопка согласия: что это замена провала и сколько осталось — в вопросе */
  accept: 'Преуспеть',
  /** Кнопка отказа */
  decline: 'Оставить провал',
  remainingPrefix: ' (осталось ',
  remainingSuffix: ')',
  /** Середина строки чата */
  chatVerdict: ' — провал спасброска становится успехом',
} as const;

/** Ответ «преуспеть» */
export const SAVE_OVERRIDE_ACCEPT = 'accept';

/** Ответ «оставить провал» */
export const SAVE_OVERRIDE_DECLINE = 'decline';

/**
 * Варианты ответа. Остаток назван в вопросе, а не на кнопке: с ним кнопки не
 * помещались в одну строку плашки.
 */
export const SAVE_OVERRIDE_OPTIONS: readonly EffectPromptOption[] = [
  { id: SAVE_OVERRIDE_ACCEPT, label: SAVE_OVERRIDE_LABELS.accept },
  { id: SAVE_OVERRIDE_DECLINE, label: SAVE_OVERRIDE_LABELS.decline },
];

/**
 * Вопрос владельцу: «Аболет проваливает спасбросок Мудрости. Легендарное
 * сопротивление (осталось 3): преуспеть вместо провала?»
 *
 * @param entityName - кто провалил
 * @param ability - характеристика спасброска
 * @param label - чем платит
 * @param remaining - сколько раз ещё можно, считая этот
 * @returns текст вопроса
 */
export function formatSaveOverrideQuestion(
  entityName: string,
  ability: AbilityType,
  label: string,
  remaining: number,
): string {
  return `${entityName} проваливает спасбросок ${ABILITY_GENITIVE_LABELS[ability]}. ${label}${SAVE_OVERRIDE_LABELS.remainingPrefix}${remaining}${SAVE_OVERRIDE_LABELS.remainingSuffix}: преуспеть вместо провала?`;
}

/**
 * Строка чата после траты: «Аболет: Легендарное сопротивление — провал
 * спасброска становится успехом (осталось 2)».
 *
 * @param entityName - кто преуспел
 * @param label - чем заплатил
 * @param remainingAfter - сколько осталось после траты
 * @returns строка чата
 */
export function formatSaveOverrideChatLine(
  entityName: string,
  label: string,
  remainingAfter: number,
): string {
  return `${entityName}: ${label}${SAVE_OVERRIDE_LABELS.chatVerdict}${SAVE_OVERRIDE_LABELS.remainingPrefix}${remainingAfter}${SAVE_OVERRIDE_LABELS.remainingSuffix}`;
}
