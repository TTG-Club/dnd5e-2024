/**
 * Проверка характеристики или навыка по запросу мастера — обе стороны
 * канала: окно у адресата (и у того, кто бросает за него), бросок без окна
 * за существо мастера и разбор пришедшего ответа.
 *
 * Ответ едет в форме результата спасброска (`SavingThrowResult`): кость,
 * модификатор, итог и успех против Сл — инициатору больше ничего не нужно.
 */

import type {
  AbilityCheckRequestPayload,
  DnDSceneEntity,
  SavingThrowResult,
} from '@vtt/shared/system/dnd.js';

import type { CheckRollResult } from '../ui/actor/diceRollTypes';

import { useChatStore } from '@/stores/chatStore';
import { useDiceRollerStore } from '@/stores/diceRollerStore';
import { isNeutralRollAnswer } from '@vtt/shared';
import {
  buildAttackFormula,
  formatAbilityCheckName,
  getNaturalD20Roll,
  parseNaturalD20Roll,
  parseSavingThrowResult,
  withRequestSource,
} from '@vtt/shared/system/dnd.js';

import {
  ABILITY_CHECK_ROLL_LABELS,
  SAVING_THROW_ROLL_LABELS,
} from '../ui/actor/constants';
import { openDiceRollWindow } from './diceRollWindow';
import { resolveCheckRollSetup } from './skillCheckRoll';

/** Чем окно проверки по запросу отличается у адресата и у мастера */
export interface RequestedCheckModalOptions {
  /** Ключ окна: повторная доставка того же запроса второго окна не открывает */
  modalKey?: string;
  /** Бросок ЗА адресата: мастер взял запрос на себя */
  takeover?: boolean;
  /** Бросок сделан */
  onResult: (result: SavingThrowResult) => void;
  /** Окно закрыли, не бросив */
  onCancel: () => void;
}

/**
 * Итог проверки против Сл.
 *
 * @param total - итог броска (кость, модификатор и бонусные кубики)
 * @param natural - оставленная натуральная кость d20
 * @param dc - сложность
 * @returns результат проверки
 */
function buildCheckResult(
  total: number,
  natural: number,
  dc: number,
): SavingThrowResult {
  return {
    roll: natural,
    modifier: total - natural,
    total,
    passed: total >= dc,
  };
}

/**
 * Подпись броска в чате: «Проверка навыка Скрытность — Гримли».
 *
 * @param entity - кто бросает
 * @param payload - что проверяют
 * @returns подпись броска
 */
function formatCheckRollLabel(
  entity: DnDSceneEntity,
  payload: AbilityCheckRequestPayload,
): string {
  return `${formatAbilityCheckName(payload)}${SAVING_THROW_ROLL_LABELS.nameSeparator}${entity.name}`;
}

/**
 * Открывает окно проверки по запросу: модификатор, режим и кости считаются по
 * сущности бросающего, как на листе. Окно само пишет бросок в чат с успехом
 * или провалом против Сл.
 *
 * @param entity - кто бросает
 * @param payload - нагрузка запроса
 * @param options - ключ окна, признак броска за адресата и исход
 * @returns идентификатор окна либо `null`, если окно с этим ключом уже открыто
 */
export function openRequestedCheckModal(
  entity: DnDSceneEntity,
  payload: AbilityCheckRequestPayload,
  options: RequestedCheckModalOptions,
): string | null {
  const setup = resolveCheckRollSetup(entity, payload);

  // Сложность и имя бросающего окно показывает над формулой, в заголовке
  // остаётся только сама проверка
  const title = withRequestSource(
    formatAbilityCheckName(payload),
    payload.sourceName,
  );

  return openDiceRollWindow(
    {
      title: options.takeover
        ? `${SAVING_THROW_ROLL_LABELS.takeoverPrefix}${title}`
        : title,
      rollLabel: formatCheckRollLabel(entity, payload),
      rollButtonText: ABILITY_CHECK_ROLL_LABELS.button,
      actorName: entity.name,
      modifier: setup.modifier,
      evaluateBonusRollFormulas: setup.evaluateBonusRollFormulas,
      initialRollMode: setup.rollMode,
      targetDc: payload.dc,
      onCheckRoll: (result: CheckRollResult) => {
        options.onResult(
          buildCheckResult(result.total, result.natural, payload.dc),
        );
      },
      onCancel: options.onCancel,
    },
    options.modalKey === undefined ? {} : { modalKey: options.modalKey },
  );
}

/**
 * Бросает проверку без окна — за существо мастера, чтобы десяток гоблинов не
 * открыл десяток окон. Бросок уходит в чат с успехом или провалом.
 *
 * @param entity - кто бросает
 * @param payload - что проверяют и против какой Сл
 * @returns результат проверки
 */
export function rollRequestedCheck(
  entity: DnDSceneEntity,
  payload: AbilityCheckRequestPayload,
): SavingThrowResult {
  const setup = resolveCheckRollSetup(entity, payload);

  const formula = buildAttackFormula(
    setup.modifier,
    setup.rollMode,
    setup.evaluateBonusRollFormulas({
      hasAdvantage: setup.rollMode === 'advantage',
      hasDisadvantage: setup.rollMode === 'disadvantage',
    }),
  );

  const rollData = useDiceRollerStore().parseAndRoll(formula);

  const result = buildCheckResult(
    rollData.total,
    getNaturalD20Roll(rollData),
    payload.dc,
  );

  rollData.label = `${formatCheckRollLabel(entity, payload)}${
    result.passed
      ? SAVING_THROW_ROLL_LABELS.successSuffix
      : SAVING_THROW_ROLL_LABELS.failureSuffix
  }`;

  useChatStore().sendMessage(formula, 'roll', rollData);

  return result;
}

/**
 * Разбирает ответ на запрос проверки: свой результат или бросок нейтрального
 * окна ядра (у адресата не сработал наш слот, и он бросил `fallbackFormula`).
 *
 * @param answer - непрозрачный `result` из исхода запроса
 * @param dc - сложность
 * @returns результат проверки либо `null`, если форма ответа незнакома
 */
export function readRequestedCheckAnswer(
  answer: unknown,
  dc: number,
): SavingThrowResult | null {
  const parsed = parseSavingThrowResult(answer);

  if (parsed) {
    return parsed;
  }

  if (!isNeutralRollAnswer(answer)) {
    return null;
  }

  // Без оставленной d20 форма ответа незнакома — по ней исход не считается
  const natural = parseNaturalD20Roll(answer.rollData);

  return natural === undefined
    ? null
    : buildCheckResult(answer.total, natural, dc);
}
