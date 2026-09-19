/**
 * Получатель действий «по выбору»: кандидаты, вопрос человеку и разбор ответа.
 *
 * Правила сплошь и рядом говорят «одно существо на твой выбор»: аура лечит
 * одного союзника в начале хода, проклятие бьёт одного врага рядом. Движок сам
 * такой выбор сделать не вправе — его делает человек. Здесь собрано всё, что
 * для этого нужно обеим сторонам канала: кто может быть выбран
 * ({@link listChoiceCandidates}), у кого спросить ({@link resolveChooserId}),
 * какой формы вопрос и ответ (схемы ниже — как у спасброска, ОДИН раз на обе
 * стороны) и что делать с ответом ({@link readChoiceAnswer}).
 *
 * Что достанется выбранным, здесь не решается: это обычные действия
 * срабатывания — урон, лечение (`@heal`), временные хиты (`@heal.temp`),
 * состояние, отметка. Выбор отвечает только на вопрос «кому».
 *
 * @module system/dnd/triggerChoice
 */

import type { RollRequestOutcome } from '@vtt/shared';

import type { ActiveEffect } from './activeEffectTypes.js';
import type { DnDSceneEntity } from './dndEntities.js';
import type {
  EffectTriggerArea,
  EffectTriggerChoice,
} from './effectTriggerTypes.js';

import { z } from 'zod';

import {
  DEFAULT_TRIGGER_CHOICE_COUNT,
  DEFAULT_TRIGGER_CHOOSER,
} from './effectTriggerTypes.js';
import { resolveEntityCurrentHp, resolveEntityMaxHp } from './hitPoints.js';
import { isTriggerConditionMet } from './triggerConditions.js';

/** Части подписи запроса выбора: «Аура жизни — Выберите цель (1)» */
export const TARGET_CHOICE_REQUEST_TITLE_PARTS = {
  /** Подпись самого выбора */
  pick: 'Выберите цель',
  /** Сколько целей: «… (2)» */
  countPrefix: ' (',
  countSuffix: ')',
  /** Разделитель источника и подписи */
  sourceSeparator: ' — ',
} as const;

/**
 * Подпись запроса для плашек ядра: «Аура жизни — Выберите цель (1)».
 *
 * @param count - сколько целей просят выбрать
 * @param sourceName - чей это выбор (название эффекта), если известно
 * @returns короткая подпись запроса
 */
export function formatTargetChoiceRequestTitle(
  count: number,
  sourceName?: string,
): string {
  const { pick, countPrefix, countSuffix, sourceSeparator } =
    TARGET_CHOICE_REQUEST_TITLE_PARTS;

  const title = `${pick}${countPrefix}${count}${countSuffix}`;

  return sourceName ? `${sourceName}${sourceSeparator}${title}` : title;
}

/**
 * Метка нашей нагрузки. По ней слот адресата отличает выбор цели от
 * спасброска: канал у них общий.
 */
export const TARGET_CHOICE_REQUEST_KIND = 'targetChoice';

/** Кандидат в нагрузке запроса: то, что показывает окно выбирающего */
const targetChoiceCandidateSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  /** Хиты кандидата — по ним и выбирают, кого лечить */
  hp: z.object({ current: z.number(), max: z.number() }).optional(),
});

/** Кандидат выбора */
export type TargetChoiceCandidate = z.infer<typeof targetChoiceCandidateSchema>;

/**
 * Нагрузка запроса выбора: список кандидатов и сколько из них взять.
 *
 * Кандидатов считает инициатор (у него сцена), а не адресат: у окна выбирающего
 * своего доступа к соседям по сцене нет.
 */
export const targetChoiceRequestPayloadSchema = z.object({
  /** Метка формы — у чужого запроса она другая */
  kind: z.literal(TARGET_CHOICE_REQUEST_KIND),
  /** Из кого выбирать */
  candidates: z.array(targetChoiceCandidateSchema).min(1),
  /** Сколько целей просят выбрать */
  count: z.number().int().min(1),
  /** Выбор добровольный: окно показывает «Отказаться» */
  optional: z.boolean().optional(),
  /** Чей выбор — «Аура жизни»: уходит в заголовок окна */
  sourceName: z.string().optional(),
  /** Что с выбранными сделают — короткой строкой для окна */
  effectSummary: z.string().optional(),
});

/** Нагрузка запроса выбора (форма — `targetChoiceRequestPayloadSchema`) */
export type TargetChoiceRequestPayload = z.infer<
  typeof targetChoiceRequestPayloadSchema
>;

/**
 * Разбирает нагрузку запроса выбора.
 *
 * @param value - непрозрачный `payload` запроса от ядра
 * @returns нагрузка выбора либо `null`, если форма чужая
 */
export function parseTargetChoiceRequestPayload(
  value: unknown,
): TargetChoiceRequestPayload | null {
  const parsed = targetChoiceRequestPayloadSchema.safeParse(value);

  return parsed.success ? parsed.data : null;
}

/** Ответ на запрос выбора: кого выбрали */
export const targetChoiceResultSchema = z.object({
  chosenIds: z.array(z.string().min(1)),
});

/** Ответ на запрос выбора */
export type TargetChoiceResult = z.infer<typeof targetChoiceResultSchema>;

/**
 * Разбирает ответ на запрос выбора.
 *
 * @param value - непрозрачный `result` из исхода запроса
 * @returns ответ либо `null`, если форма чужая
 */
export function parseTargetChoiceResult(
  value: unknown,
): TargetChoiceResult | null {
  const parsed = targetChoiceResultSchema.safeParse(value);

  return parsed.success ? parsed.data : null;
}

/** Чем инициатор ищет кандидатов на сцене */
export interface ChoiceCandidateOptions {
  /** Кто стоит в радиусе от субъекта — сцена приходит от ядра */
  listEntitiesInArea?: (
    subject: DnDSceneEntity,
    area: EffectTriggerArea,
  ) => DnDSceneEntity[];
}

/**
 * Кандидаты выбора: те же, кого задел бы «всем в радиусе», просеянные условием
 * кандидата.
 *
 * Условие берётся из общего словаря условий и проверяется НА КАНДИДАТЕ:
 * `self.creatureType === "undead"` — «только нежить», `self.hp.value <= 10` —
 * «только раненые». Второго словаря для отбора не заводится.
 *
 * @param subject - субъект: от его фишки считается радиус
 * @param choice - блок «по выбору»
 * @param options - чем искать соседей по сцене
 * @returns кандидаты; пусто — выбирать не из кого
 */
export function listChoiceCandidates(
  subject: DnDSceneEntity,
  choice: EffectTriggerChoice,
  options: ChoiceCandidateOptions = {},
): DnDSceneEntity[] {
  const area: EffectTriggerArea = {
    radius: choice.radius,
    ...(choice.target ? { target: choice.target } : {}),
  };

  const nearby = options.listEntitiesInArea?.(subject, area) ?? [];

  return nearby.filter((candidate) =>
    isTriggerConditionMet(candidate, { condition: choice.condition }),
  );
}

/**
 * Кандидаты в форме нагрузки запроса.
 *
 * @param candidates - кандидаты
 * @returns строки для окна выбирающего
 */
export function toChoiceCandidatePayload(
  candidates: readonly DnDSceneEntity[],
): TargetChoiceCandidate[] {
  return candidates.map((candidate) => ({
    id: candidate.id,
    name: candidate.name,
    hp: {
      current: resolveEntityCurrentHp(candidate),
      max: resolveEntityMaxHp(candidate),
    },
  }));
}

/**
 * Чей владелец выбирает: носитель эффекта или тот, кто эффект наложил.
 *
 * У ауры заклинателя субъект и наложивший — одно лицо. Разойдутся они там, где
 * эффект висит на жертве, а решает заклинатель («выбери, кого задеть»).
 *
 * @param subject - субъект срабатывания
 * @param effect - эффект, чьё срабатывание идёт
 * @param choice - блок «по выбору»
 * @returns идентификатор сущности, чьего владельца спрашивают
 */
export function resolveChooserId(
  subject: DnDSceneEntity,
  effect: ActiveEffect,
  choice: EffectTriggerChoice,
): string {
  const chooser = choice.chooser ?? DEFAULT_TRIGGER_CHOOSER;

  // Наложившего может не быть (эффект из компендиума, не из каста) — тогда
  // спрашиваем носителя: иначе спросить было бы некого
  return chooser === 'source' && effect.sourceActorId
    ? effect.sourceActorId
    : subject.id;
}

/**
 * Сколько целей просят выбрать, но не больше, чем есть кандидатов.
 *
 * @param choice - блок «по выбору»
 * @param candidateCount - сколько кандидатов нашлось
 * @returns сколько целей просить
 */
export function resolveChoiceCount(
  choice: EffectTriggerChoice,
  candidateCount: number,
): number {
  return Math.min(choice.count ?? DEFAULT_TRIGGER_CHOICE_COUNT, candidateCount);
}

/**
 * Разбирает исход запроса выбора в список получателей.
 *
 * Ответ приезжает с чужого клиента, поэтому проверяется полностью: выбранные
 * обязаны быть из числа кандидатов, и их не больше, чем просили. Лишнее молча
 * отбрасывается — соврать движку выбором нельзя.
 *
 * @param outcome - исход запроса от ядра
 * @param candidates - кандидаты, которых отправляли в запросе
 * @param choice - блок «по выбору»
 * @returns выбранные получатели; `null` — ответа нет (отказ, срок, отклонён)
 */
export function readChoiceAnswer(
  outcome: RollRequestOutcome,
  candidates: readonly DnDSceneEntity[],
  choice: EffectTriggerChoice,
): DnDSceneEntity[] | null {
  if (outcome.status !== 'answered' && outcome.status !== 'takenOver') {
    return null;
  }

  const answer = parseTargetChoiceResult(outcome.result);

  if (!answer) {
    return null;
  }

  const chosen = candidates.filter((candidate) =>
    answer.chosenIds.includes(candidate.id),
  );

  return chosen.slice(0, resolveChoiceCount(choice, candidates.length));
}
