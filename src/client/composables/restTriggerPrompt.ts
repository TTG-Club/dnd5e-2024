/**
 * Срабатывания «после отдыха» на столе: вопрос владельцу и сводка в чат.
 *
 * Отдых выполняет клиент — кнопкой листа, без сервера. Срабатывание отдыха с
 * галочкой «спрашивать» или ценой ресурсом идёт тем же порядком, что и на
 * остальных путях: разбор цены → отказ при нехватке → вопрос владельцу →
 * списание → действия. Вопрос задаёт плашка стола: отдыхает тот, кто нажал
 * кнопку на своём листе. Что срабатывания сделали и какие из них отменены
 * (отказ, цена не по карману) — уходит строкой в чат.
 */

import type {
  DnDActor,
  DnDCreature,
  EffectPromptAsker,
  LongRestOptions,
  RestTriggerOptions,
  RestType,
  SelfTriggerReport,
} from '@vtt/shared/system/dnd.js';

import { useModalManager } from '@/shared_ui/composables/useModalManager';
import {
  askRestTriggers,
  listRestEndedCastIds,
  REST_TRIGGER_SUMMARY_LABEL,
} from '@vtt/shared/system/dnd.js';

import { EFFECT_QUESTION_PROMPT_MODAL } from '../ui/effect/constants';
import { sendSelfTriggerReport } from './effectPayChoice';
import { requestEndCasts, waitForCastsEnded } from './spellCasts';

/**
 * Вопрос срабатывания плашкой стола. Закрытая плашка — отказ.
 *
 * @param payload - вопрос и закрытый список вариантов
 * @returns ответ человека
 */
const askOnTable: EffectPromptAsker = (payload) =>
  new Promise((resolve) => {
    useModalManager().openModal(EFFECT_QUESTION_PROMPT_MODAL, {
      allowMultiple: true,
      question: payload.question,
      options: payload.options,
      sourceName: payload.sourceName,
      effectSummary: payload.effectSummary,
      onAnswer: (optionId: string) => {
        resolve({ optionId });
      },
      onCancel: () => {
        resolve({ optionId: null });
      },
    });
  });

/**
 * Отдых со срабатываниями «после отдыха»: сперва владельца спрашивают о тех из
 * них, что требуют согласия или цены, затем вызывающий применяет отдых с
 * ответами, и сводка срабатываний уходит в чат.
 *
 * Отдых заканчивает концентрацию отдыхающего (`listRestEndedCastIds`) — тем же
 * путём, что кнопка «Прервать концентрацию»: сервер снимает метку, эффекты
 * каста со всех существ и его зону. Отдых ждёт ответа сервера: лист сохраняет
 * сущность целиком и иначе вернул бы только что снятую метку.
 *
 * Сущность перечитывает сам вызывающий: пока человек отвечал, лист мог
 * измениться, а цена списывается с того, что есть на момент применения.
 *
 * @param entity - отдыхающий на момент нажатия (с уже потраченными костями
 *   хитов короткого отдыха)
 * @param restType - тип отдыха
 * @param options - параметры долгого отдыха: от них зависит, что вернётся
 * @param apply - применение отдыха с ответами и сбором сводки
 */
export async function runRestWithTriggers(
  entity: DnDActor | DnDCreature,
  restType: RestType,
  options: LongRestOptions,
  apply: (triggerOptions: RestTriggerOptions) => void,
): Promise<void> {
  const endedCastIds = listRestEndedCastIds(entity.activeEffects, restType);

  requestEndCasts(entity.id, endedCastIds);
  await waitForCastsEnded(entity.id, endedCastIds);

  const triggerAnswers = await askRestTriggers(
    entity,
    restType,
    askOnTable,
    options,
  );

  const triggerReport: SelfTriggerReport = { notes: [], results: [] };

  apply({ triggerAnswers, triggerReport });

  sendSelfTriggerReport(entity.name, triggerReport, REST_TRIGGER_SUMMARY_LABEL);
}
