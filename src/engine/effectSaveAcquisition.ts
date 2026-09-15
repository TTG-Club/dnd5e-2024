/**
 * Спасбросок эффекта, который бросает не сервер, а игрок: запрос владельцу
 * сущности через ядро и разбор пришедшего исхода.
 *
 * Сервер прогоняет правила зон, аур и эффектов хода сам, но спасбросок по
 * правилам бросает владелец сущности — если он не включил «Авто-спасброски».
 * Ядро доставляет запрос (`ServerRollRequester`), здесь собирается его нагрузка
 * и читается ответ. Форма нагрузки и ответа — те же, что у запроса со страницы
 * (`savingThrowRequest.ts`): слот адресата не отличает серверный запрос.
 */

import type {
  RollRequestOutcome,
  ServerRollRequester,
  ServerRollRequestOptions,
} from '@vtt/shared';

import type { DnDSceneEntity } from './dndEntities.js';
import type { SavingThrowRequestPayload } from './savingThrowRequest.js';
import type { EffectSaveSpec, TurnSaveOutcome } from './turnEffects.js';

import { isNeutralRollAnswer } from '@vtt/shared';

import {
  buildAttackFormula,
  parseNaturalD20Roll,
  resolveSavingThrowRollMode,
} from './attackUtils.js';
import {
  collectBonusRollFormulas,
  resolveActorStats,
} from './effectPipeline.js';
import {
  formatSavingThrowRequestTitle,
  parseSavingThrowResult,
  resolveAutoSaves,
  SAVING_THROW_REQUEST_KIND,
} from './savingThrowRequest.js';
import {
  buildEffectSavingThrowContext,
  rollEffectSaveOutcome,
} from './turnEffects.js';

/**
 * Предел длины формулы нейтрального броска, которую принимает ядро. Длиннее —
 * ядро отвергло бы весь запрос, поэтому такую формулу не отправляем вовсе
 * (адресат без окна системы бросит тогда `1d20`).
 */
const FALLBACK_FORMULA_MAX_LENGTH = 64;

/** Заметки в сводку чата о том, как получен (или не получен) спасбросок */
export const EFFECT_SAVE_CHAT_NOTES = {
  declined: 'спасбросок не брошен — срабатывание отменено',
  timeout: 'нет ответа на спасбросок — срабатывание отменено',
  unreadable: 'ответ на спасбросок не распознан — срабатывание отменено',
  noRecipient: 'бросить некому — спасбросок брошен автоматически',
  rejected: 'запрос не принят — спасбросок брошен автоматически',
} as const;

/** Подписи того, кто просит бросок, в плашке адресата */
export const EFFECT_SAVE_REQUESTER_LABELS = {
  /** Зона без имени */
  zone: 'Зона',
  /** Приставка перед именем зоны */
  zonePrefix: 'Зона «',
  /** Аура, чей источник не опознан */
  aura: 'Аура',
  /** Приставка перед именем источника ауры */
  auraPrefix: 'Аура «',
  /** Приставка перед названием эффекта хода */
  effectPrefix: 'Эффект «',
  /** Закрывающая кавычка имени */
  nameSuffix: '»',
} as const;

/**
 * Подпись зоны для плашки запроса.
 *
 * @param zoneName - имя зоны, если задано
 * @returns «Зона «Болото»» или «Зона»
 */
export function formatZoneRequesterLabel(zoneName: string | undefined): string {
  const { zone, zonePrefix, nameSuffix } = EFFECT_SAVE_REQUESTER_LABELS;

  return zoneName ? `${zonePrefix}${zoneName}${nameSuffix}` : zone;
}

/**
 * Подпись ауры для плашки запроса: по имени того, кто её излучает.
 *
 * @param sourceName - имя сущности-источника ауры, если опознан
 * @returns «Аура «Паладин»» или «Аура»
 */
export function formatAuraRequesterLabel(
  sourceName: string | undefined,
): string {
  const { aura, auraPrefix, nameSuffix } = EFFECT_SAVE_REQUESTER_LABELS;

  return sourceName ? `${auraPrefix}${sourceName}${nameSuffix}` : aura;
}

/**
 * Подпись эффекта хода для плашки запроса.
 *
 * @param effectName - название эффекта с повторным спасброском
 * @returns «Эффект «Удержание личности»»
 */
export function formatEffectRequesterLabel(effectName: string): string {
  const { effectPrefix, nameSuffix } = EFFECT_SAVE_REQUESTER_LABELS;

  return `${effectPrefix}${effectName}${nameSuffix}`;
}

/**
 * Спрашивать ли спасбросок у игрока.
 *
 * Спрашиваем, когда ядро умеет доставить запрос и сущность не бросает сама
 * («Авто-спасброски» выключены — по умолчанию у персонажей). Существо ГМа с
 * включёнными авто-спасбросками бросает на сервере, как раньше.
 *
 * @param entity - сущность, которая бросает
 * @param requestRoll - запрос броска от ядра, если он есть
 * @returns `true`, если спасбросок нужно спросить
 */
export function shouldRequestEffectSave(
  entity: DnDSceneEntity,
  requestRoll: ServerRollRequester | undefined,
): requestRoll is ServerRollRequester {
  return requestRoll !== undefined && !resolveAutoSaves(entity);
}

/**
 * Формула нейтрального броска: кость по режиму, модификатор и бонусные кубики.
 * Ею бросит ядро, если у адресата не окажется окна системы.
 *
 * @param entity - сущность, которая бросает
 * @param spec - что бросать
 * @returns формула либо `undefined`, если она длиннее допустимого ядром
 */
function buildEffectSaveFallbackFormula(
  entity: DnDSceneEntity,
  spec: EffectSaveSpec,
): string | undefined {
  const stats = resolveActorStats(entity);

  const rollMode = resolveSavingThrowRollMode({
    flags: stats.activeFlags,
    ability: spec.ability,
    againstMagic: spec.againstMagic,
    againstCondition: spec.againstCondition,
    againstConcentration: spec.againstConcentration,
  });

  const context = buildEffectSavingThrowContext(entity);

  const formula = buildAttackFormula(
    stats.saves[spec.ability] ?? 0,
    rollMode,
    collectBonusRollFormulas(
      context.effects,
      `save.${spec.ability}`,
      {
        hasAdvantage: rollMode === 'advantage',
        hasDisadvantage: rollMode === 'disadvantage',
        self: context.self,
      },
      context.formulaContext,
    ),
  );

  return formula.length <= FALLBACK_FORMULA_MAX_LENGTH ? formula : undefined;
}

/**
 * Собирает серверный запрос спасброска эффекта.
 *
 * @param entity - сущность, чей владелец бросает
 * @param spec - что бросать
 * @param requesterLabel - кто просит («Зона «Болото»»)
 * @returns опции запроса для ядра
 */
export function buildEffectSaveRollRequest(
  entity: DnDSceneEntity,
  spec: EffectSaveSpec,
  requesterLabel: string,
): ServerRollRequestOptions {
  const payload: SavingThrowRequestPayload = {
    kind: SAVING_THROW_REQUEST_KIND,
    ability: spec.ability,
    dc: spec.dc,
    againstMagic: spec.againstMagic,
    againstCondition: spec.againstCondition,
    ...(spec.againstConcentration ? { againstConcentration: true } : {}),
    sourceName: spec.effectName,
  };

  return {
    entityId: entity.id,
    requesterLabel,
    title: formatSavingThrowRequestTitle(
      spec.ability,
      spec.dc,
      spec.effectName,
    ),
    fallbackFormula: buildEffectSaveFallbackFormula(entity, spec),
    payload,
  };
}

/**
 * Читает ответ игрока: результат окна системы или бросок нейтрального окна
 * ядра (у адресата не сработал слот, и он бросил формулу из запроса).
 *
 * @param entity - сущность, которая бросала (живая, на момент ответа)
 * @param spec - что бросали
 * @param answer - непрозрачный `result` исхода
 * @returns исход спасброска либо `null`, если форма ответа незнакома
 */
export function readEffectSaveAnswer(
  entity: DnDSceneEntity,
  spec: EffectSaveSpec,
  answer: unknown,
): TurnSaveOutcome | null {
  const parsed = parseSavingThrowResult(answer);

  if (parsed) {
    return {
      effectName: spec.effectName,
      ability: spec.ability,
      dc: spec.dc,
      roll: parsed.roll,
      total: parsed.total,
      passed: parsed.passed,
    };
  }

  if (!isNeutralRollAnswer(answer)) {
    return null;
  }

  const natural = parseNaturalD20Roll(answer.rollData);

  if (natural === undefined) {
    return null;
  }

  // Модификатор уже сидит в итоге нейтрального броска; автопровал формула не
  // знает, поэтому его учитываем здесь
  const autoFail = resolveActorStats(entity).activeFlags.has(
    `save.autoFail.${spec.ability}`,
  );

  return {
    effectName: spec.effectName,
    ability: spec.ability,
    dc: spec.dc,
    roll: natural,
    total: answer.total,
    passed: !autoFail && answer.total >= spec.dc,
  };
}

/** Чем закончился запрос спасброска для правил эффекта */
export type EffectSaveAcquisition =
  | {
      /** Спасбросок есть — применяем эффект по нему */
      status: 'rolled';
      save: TurnSaveOutcome;
      /** Заметка в чат, если бросок сделан не игроком */
      note: string | null;
    }
  | {
      /** Спасброска нет — срабатывание отменяется */
      status: 'cancelled';
      note: string;
    };

/**
 * Приводит исход запроса к спасброску эффекта.
 *
 * Отказ игрока и истёкший срок отменяют срабатывание — так же, как у
 * спасброска от заклинания со страницы. Когда бросить некому или ядро запрос не
 * приняло, спасбросок бросает сервер: иначе зона молча переставала бы работать.
 *
 * @param entity - сущность, которая бросала (живая, на момент ответа)
 * @param spec - что бросали
 * @param outcome - исход запроса от ядра
 * @returns спасбросок или отмена срабатывания
 */
export function settleEffectSaveOutcome(
  entity: DnDSceneEntity,
  spec: EffectSaveSpec,
  outcome: RollRequestOutcome,
): EffectSaveAcquisition {
  if (outcome.status === 'answered' || outcome.status === 'takenOver') {
    const save = readEffectSaveAnswer(entity, spec, outcome.result);

    return save
      ? { status: 'rolled', save, note: null }
      : { status: 'cancelled', note: EFFECT_SAVE_CHAT_NOTES.unreadable };
  }

  if (outcome.status === 'declined' || outcome.status === 'timeout') {
    return {
      status: 'cancelled',
      note: EFFECT_SAVE_CHAT_NOTES[outcome.status],
    };
  }

  // Бросить некому (`noRecipient`) или ядро запрос не приняло (`rejected`)
  return {
    status: 'rolled',
    save: rollEffectSaveOutcome(entity, spec),
    note: EFFECT_SAVE_CHAT_NOTES[outcome.status],
  };
}
