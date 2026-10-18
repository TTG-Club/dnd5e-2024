/**
 * Запрос броска от мастера: окно «Запросить бросок» (слот ядра
 * `promptGmRollRequest`) и рассылка запросов по выбранным сущностям.
 *
 * Спасбросок идёт тем же путём, что и спасброски заклинаний
 * (`resolveSavingThrowsForTargets`): чужим сущностям — запросом владельцам,
 * существам мастера — авто-броском. Проверка устроена так же: игрокам —
 * запрос с окном проверки, существам мастера — бросок без окна, персонажу без
 * игрока в сети — окно у самого мастера. Когда все ответили, мастер получает
 * уведомление с итогом: кто прошёл, кто провалил, кто не бросил.
 */

import type { GmRollRequestContext } from '@/core/systems/uiSystemRegistry';
import type {
  AbilityType,
  RollRequestOptions,
  RollRequestOutcome,
  SkillType,
} from '@vtt/shared';
import type {
  AbilityCheckRequestPayload,
  DnDSceneEntity,
  SavingThrowResult,
} from '@vtt/shared/system/dnd.js';

import type { GmRollRequestKind } from '../ui/roll-request/constants';

import { getRollRequestService } from '@/core/api/rollRequestService';
import { useModalManager } from '@/shared_ui/composables/useModalManager';
import { isCreatureEntity } from '@vtt/shared';
import {
  ABILITY_CHECK_REQUEST_KIND,
  buildAttackFormula,
  formatAbilityCheckRequestTitle,
  formatSavingThrowRequestTitle,
} from '@vtt/shared/system/dnd.js';

import { useSystemToastStore } from '../stores/systemToastStore';
import {
  GM_ROLL_REQUEST_ICON,
  GM_ROLL_REQUEST_LOG_PREFIX,
  GM_ROLL_REQUEST_MODAL,
  GM_ROLL_REQUEST_SUMMARY_LABELS,
} from '../ui/roll-request/constants';
import {
  openRequestedCheckModal,
  readRequestedCheckAnswer,
  rollRequestedCheck,
} from './requestedCheckRoll';
import { resolveCheckRollSetup } from './skillCheckRoll';
import { useSpellSavingThrows } from './useSpellSavingThrows';
import { useWorldEntities } from './useWorldEntities';

/** Что мастер выбрал в окне */
export interface GmRollRequestInput {
  /** Кому: сущности мира, по одной записи на каждую */
  entityIds: readonly string[];
  /** Что бросить */
  kind: GmRollRequestKind;
  /** Характеристика спасброска или проверки характеристики */
  ability: AbilityType;
  /** Навык проверки навыка */
  skill: SkillType;
  /** Сложность */
  dc: number;
}

/** Окно мастера, открытое сейчас: повторный вход заменяет его новым */
let openRequestModalId: string | null = null;

/**
 * Слот ядра `promptGmRollRequest`: открывает окно мастера «Запросить бросок»
 * с сущностями, которые пришли из меню фишки (или без них — с карты).
 *
 * Открытое окно закрывается и встаёт заново: менеджер окон поднял бы
 * прежнее с прежним списком адресатов, а мастер выделил уже других.
 *
 * @param context - сцена и сущности от ядра
 */
export function promptGmRollRequest(context: GmRollRequestContext): void {
  const modalManager = useModalManager();

  if (openRequestModalId !== null) {
    modalManager.closeModal(openRequestModalId);
  }

  openRequestModalId = modalManager.openModal(GM_ROLL_REQUEST_MODAL, {
    sceneId: context.sceneId,
    initialEntityIds: context.entityIds,
  });
}

/**
 * Нагрузка запроса проверки по выбору мастера.
 *
 * @param input - выбор мастера
 * @returns нагрузка проверки характеристики или навыка
 */
function buildCheckPayload(
  input: GmRollRequestInput,
): AbilityCheckRequestPayload {
  return input.kind === 'skill'
    ? {
        kind: ABILITY_CHECK_REQUEST_KIND,
        check: 'skill',
        skill: input.skill,
        dc: input.dc,
      }
    : {
        kind: ABILITY_CHECK_REQUEST_KIND,
        check: 'ability',
        ability: input.ability,
        dc: input.dc,
      };
}

/**
 * Подпись запроса — заголовок уведомления с итогом.
 *
 * @param input - выбор мастера
 * @returns «Спасбросок Ловкость (DC 15)», «Проверка навыка Скрытность (DC 12)»
 */
function formatRequestTitle(input: GmRollRequestInput): string {
  return input.kind === 'save'
    ? formatSavingThrowRequestTitle(input.ability, input.dc)
    : formatAbilityCheckRequestTitle(buildCheckPayload(input), input.dc);
}

/**
 * Проверка у мастера: существо бросает без окна, персонаж — окном.
 *
 * @param entity - кто бросает
 * @param payload - что проверяют
 * @returns результат или `null`, если окно закрыли, не бросив
 */
function resolveCheckLocally(
  entity: DnDSceneEntity,
  payload: AbilityCheckRequestPayload,
): Promise<SavingThrowResult | null> {
  if (isCreatureEntity(entity)) {
    return Promise.resolve(rollRequestedCheck(entity, payload));
  }

  return new Promise((resolve) => {
    const modalId = openRequestedCheckModal(entity, payload, {
      onResult: resolve,
      onCancel: () => {
        resolve(null);
      },
    });

    // Окно не открылось — ждать его ответа нечего
    if (modalId === null) {
      resolve(null);
    }
  });
}

/**
 * Запрос проверки владельцу сущности для ядра.
 *
 * @param entity - кто бросает
 * @param payload - что проверяют
 * @returns параметры запроса
 */
function buildCheckRequestOptions(
  entity: DnDSceneEntity,
  payload: AbilityCheckRequestPayload,
): RollRequestOptions {
  const setup = resolveCheckRollSetup(entity, payload);

  return {
    entityId: entity.id,
    title: formatAbilityCheckRequestTitle(payload, payload.dc),
    // Ею ядро бросит само, если у адресата не окажется окна системы
    fallbackFormula: buildAttackFormula(setup.modifier, setup.rollMode),
    payload,
  };
}

/**
 * Приводит исход запроса проверки к результату. Ответ даёт результат, отказ и
 * срок — «без броска», а отсутствие игрока в сети и отказ сервера — бросок у
 * мастера, как у спасбросков заклинаний.
 *
 * @param entity - кто бросает
 * @param payload - что проверяют
 * @param outcome - исход запроса от ядра
 * @returns результат или `null`, если броска не было
 */
function resolveCheckOutcome(
  entity: DnDSceneEntity,
  payload: AbilityCheckRequestPayload,
  outcome: RollRequestOutcome,
): Promise<SavingThrowResult | null> {
  switch (outcome.status) {
    case 'answered':
    case 'takenOver': {
      const result = readRequestedCheckAnswer(outcome.result, payload.dc);

      if (!result) {
        console.warn(
          `${GM_ROLL_REQUEST_LOG_PREFIX} Незнакомая форма ответа на проверку «${entity.name}»`,
          outcome.result,
        );
      }

      return Promise.resolve(result);
    }
    case 'declined':
    case 'timeout':
      return Promise.resolve(null);
    case 'rejected':
      console.warn(
        `${GM_ROLL_REQUEST_LOG_PREFIX} Запрос проверки не принят: ${outcome.reason}`,
      );

      break;
    case 'noRecipient':
      break;
  }

  return resolveCheckLocally(entity, payload);
}

/**
 * Разрешает проверку у всех выбранных сущностей. Запросы игрокам уходят одной
 * пачкой до своих бросков: игроки бросают, пока мастер занят своими окнами.
 *
 * @param entities - кто бросает (без повторов)
 * @param payload - что проверяют
 * @returns карта «id сущности → результат»; `null` — броска не было
 */
async function resolveChecks(
  entities: readonly DnDSceneEntity[],
  payload: AbilityCheckRequestPayload,
): Promise<Map<string, SavingThrowResult | null>> {
  const { isForeignOwnedTarget } = useSpellSavingThrows();
  const results = new Map<string, SavingThrowResult | null>();

  const foreignEntities = entities.filter(isForeignOwnedTarget);

  const ownEntities = entities.filter(
    (entity) => !isForeignOwnedTarget(entity),
  );

  const foreignOutcomes =
    foreignEntities.length > 0
      ? getRollRequestService().requestMany(
          foreignEntities.map((entity) =>
            buildCheckRequestOptions(entity, payload),
          ),
        )
      : null;

  for (const entity of ownEntities) {
    results.set(entity.id, await resolveCheckLocally(entity, payload));
  }

  if (foreignOutcomes) {
    const outcomes = await foreignOutcomes;

    for (const [index, outcome] of outcomes.entries()) {
      const entity = foreignEntities[index];

      results.set(
        entity.id,
        await resolveCheckOutcome(entity, payload, outcome),
      );
    }
  }

  return results;
}

/**
 * Строка участника в итоге: «Гримли (17)».
 *
 * @param name - имя бросавшего
 * @param total - итог броска
 * @returns строка итога
 */
function formatSummaryEntry(name: string, total: number): string {
  const { totalPrefix, totalSuffix } = GM_ROLL_REQUEST_SUMMARY_LABELS;

  return `${name}${totalPrefix}${total}${totalSuffix}`;
}

/**
 * Текст уведомления с итогом: «Успех: Гримли, Элара. Провал: Гоблин».
 *
 * @param entities - кто бросал
 * @param results - результаты по id сущности
 * @returns текст итога
 */
function formatSummary(
  entities: readonly DnDSceneEntity[],
  results: ReadonlyMap<string, SavingThrowResult | null>,
): string {
  const labels = GM_ROLL_REQUEST_SUMMARY_LABELS;
  const passed: string[] = [];
  const failed: string[] = [];
  const missing: string[] = [];

  for (const entity of entities) {
    const result = results.get(entity.id);

    if (!result) {
      missing.push(entity.name);
    } else if (result.passed) {
      passed.push(formatSummaryEntry(entity.name, result.total));
    } else {
      failed.push(formatSummaryEntry(entity.name, result.total));
    }
  }

  const parts: [prefix: string, names: string[]][] = [
    [labels.passed, passed],
    [labels.failed, failed],
    [labels.missing, missing],
  ];

  return parts
    .filter(([, names]) => names.length > 0)
    .map(([prefix, names]) => `${prefix}${names.join(labels.nameSeparator)}`)
    .join(labels.partSeparator);
}

/**
 * Рассылает запрос мастера и, когда все ответили, показывает ему итог.
 *
 * @param input - выбор мастера
 */
export async function sendGmRollRequest(
  input: GmRollRequestInput,
): Promise<void> {
  const { findCurrentDndEntity } = useWorldEntities();

  // Одна сущность — один бросок, даже если её выбрали дважды
  const entities = [...new Set(input.entityIds)]
    .map((entityId) => findCurrentDndEntity(entityId))
    .filter((entity) => entity !== undefined);

  if (entities.length === 0) {
    return;
  }

  const results =
    input.kind === 'save'
      ? await useSpellSavingThrows().resolveSavingThrowsForTargets(
          entities.map((entity) => ({
            entity,
            ability: input.ability,
            dc: input.dc,
            // Спасбросок по слову мастера не навязан магией: иначе «Мантия
            // сопротивления заклинаниям» дала бы преимущество на ровном месте
            againstMagic: false,
          })),
        )
      : await resolveChecks(entities, buildCheckPayload(input));

  useSystemToastStore().add({
    title: formatRequestTitle(input),
    description: formatSummary(entities, results),
    icon: GM_ROLL_REQUEST_ICON,
  });
}
