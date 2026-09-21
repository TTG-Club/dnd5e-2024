import type {
  AbilityType,
  RollRequestOptions,
  RollRequestOutcome,
  SceneEntity,
} from '@vtt/shared';
import type {
  ConditionRef,
  SavingThrowCircumstances,
  SavingThrowRequestPayload,
  SavingThrowResult,
} from '@vtt/shared/system/dnd.js';

import type { CheckRollResult } from '../ui/actor/diceRollTypes';
import type { ActorSaveInfo } from './spellResolutionShared';

import { getRollRequestService } from '@/core/api/rollRequestService';
import { useModalManager } from '@/shared_ui/composables/useModalManager';
import { useChatStore } from '@/stores/chatStore';
import { useDiceRollerStore } from '@/stores/diceRollerStore';
import { useWorldStore } from '@/stores/worldStore';
import {
  getEntityOwnerIds,
  isEntityOwner,
  isNeutralRollAnswer,
} from '@vtt/shared';
import {
  buildAttackFormula,
  formatSavingThrowRequestTitle,
  getNaturalD20Roll,
  isDndSceneEntity,
  listSavingThrowBonusKeys,
  parseNaturalD20Roll,
  parseSavingThrowResult,
  resolveActorStats,
  resolveAutoSaves,
  resolveSavingThrowModifier,
  resolveSavingThrowRollMode,
  SAVING_THROW_REQUEST_KIND,
} from '@vtt/shared/system/dnd.js';

import { SAVING_THROW_ROLL_LABELS } from '../ui/actor/constants';
import { buildRollBonusEvaluator } from './rollBonusEvaluator';
import {
  determineRollMode,
  formatSavingThrowRollLabel,
  formatSavingThrowTitle,
} from './spellResolutionShared';
import { useWorldEntities } from './useWorldEntities';

/** Префикс сообщений композабла в консоли */
const SAVING_THROW_LOG_PREFIX = '[SavingThrow]';

/**
 * Цель спасброска и всё, что нужно, чтобы его разрешить, — своим броском или
 * запросом владельцу.
 */
export interface SavingThrowTarget {
  /** Сущность, которая бросает */
  entity: SceneEntity;
  /** Характеристика спасброска */
  ability: AbilityType;
  /** Сложность (СЛ) */
  dc: number;
  /** Состояние, которого спасбросок позволяет избежать */
  againstCondition?: ConditionRef;
  /** Спасбросок концентрации: «Боевой заклинатель» даёт преимущество */
  againstConcentration?: boolean;
  /**
   * Спасбросок навязан магией — от этого зависят флаги вроде «Мантии
   * сопротивления заклинаниям». По умолчанию `true`: спасброски заклинаний и
   * действий существ навязаны магией. Поле явное, потому что оно едет в
   * нагрузке запроса — адресат обязан считать ТЕМ ЖЕ флагом, что и инициатор.
   */
  againstMagic?: boolean;
  /**
   * Спасбросок навязан именно заклинанием, а не ударом или действием
   * существа: «Кольцо отражения заклинаний». Едет в нагрузке запроса.
   */
  againstSpell?: boolean;
  /** Преимущество или помеха самого спасброска (срабатывание эффекта) */
  mode?: SavingThrowCircumstances['mode'];
  /**
   * Сущность, от чьего имени идёт действие (заклинатель, атакующий). По ней
   * сервер проверяет право игрока просить бросок; ГМу поле не требуется, но
   * без него запрос игрока сервер отклонит.
   */
  sourceEntityId?: string;
  /** Чем бьют («Огненный шар», «Укус») — в подпись запроса у адресата */
  sourceName?: string;
  /**
   * Согласная цель вправе не бросать: в окне появится «Не сопротивляюсь».
   * Решает владелец цели — тот, кто накладывает, только разрешает.
   */
  allowWilling?: boolean;
}

/**
 * Чем окно спасброска отличается у своего броска и у броска по чужому запросу.
 */
export interface SavingThrowModalOptions {
  /**
   * Ключ окна. У запроса — по его идентификатору: ядро может доставить один и
   * тот же запрос повторно (переподключение), и второе окно тогда не нужно.
   * Без ключа окна открываются независимо друг от друга.
   */
  modalKey?: string;
  /** Бросок ЗА адресата: ГМ или инициатор взял чужой запрос на себя */
  takeover?: boolean;
  /** Бросок сделан */
  onResult: (result: SavingThrowResult) => void;
  /** Окно закрыли, не бросив */
  onCancel: () => void;
}

/**
 * Собирает формулу спасброска: кость по режиму плюс модификатор.
 *
 * Одна на два применения — свой автобросок и `fallbackFormula` запроса (ею
 * ядро бросит само, если у адресата не окажется окна системы).
 *
 * @param info - модификатор и флаги преимущества/помехи цели
 * @returns формула для роллера
 */
function buildSavingThrowFormula(info: ActorSaveInfo): string {
  return buildAttackFormula(
    info.modifier,
    determineRollMode(info.hasAdvantage, info.hasDisadvantage),
    info.evaluateBonusRollFormulas({
      hasAdvantage: info.hasAdvantage,
      hasDisadvantage: info.hasDisadvantage,
    }),
  );
}

/**
 * Собирает результат спасброска по итогу броска.
 *
 * @param total - итог броска (кость, модификатор и бонусные кубики)
 * @param natural - оставленная натуральная кость d20
 * @param info - модификатор и флаги цели (нужен автопровал)
 * @param dc - сложность
 * @returns результат спасброска
 */
function buildSavingThrowResult(
  total: number,
  natural: number,
  info: ActorSaveInfo,
  dc: number,
): SavingThrowResult {
  return {
    roll: natural,
    modifier: total - natural,
    total,
    passed: !info.autoFail && total >= dc,
  };
}

/**
 * Рассчитывает модификатор спасброска актора с учётом Active Effects.
 *
 * @param entity - сущность-цель
 * @param saveAbility - характеристика спасброска
 * @param options - контекст спасброска для флагов преимущества/помехи
 * @param options.againstMagic - спасбросок навязан магией
 * @param options.againstSpell - спасбросок навязан заклинанием
 * @param options.againstCondition - состояние, которого он позволяет избежать
 * @param options.againstConcentration - спасбросок концентрации
 * @param options.mode - преимущество или помеха самого спасброска
 * @returns модификатор спасброска и флаги (преимущество/помеха/автопровал)
 */
function getActorSaveInfo(
  entity: SceneEntity,
  saveAbility: AbilityType,
  options: SavingThrowCircumstances,
): ActorSaveInfo {
  // Ядро видит entity как Base*; D&D-форму подтверждает гвард. Без данных
  // системы считать нечего: спасбросок идёт «голым» кубиком, а не роняет каст
  if (!isDndSceneEntity(entity)) {
    return {
      modifier: 0,
      evaluateBonusRollFormulas: () => [],
      hasAdvantage: false,
      hasDisadvantage: false,
      autoFail: false,
    };
  }

  const stats = resolveActorStats(entity);

  const modifier = resolveSavingThrowModifier(stats, saveAbility, options);

  // `againstMagic` приходит от вызывающего: Мантия сопротивления заклинаниям
  // должна сработать на спасброске от заклинания и промолчать на спасброске
  // от яда. Через сеть флаг едет в нагрузке запроса — у адресата тот же счёт.
  const rollMode = resolveSavingThrowRollMode({
    flags: stats.activeFlags,
    ability: saveAbility,
    againstMagic: options.againstMagic,
    againstSpell: options.againstSpell,
    againstCondition: options.againstCondition,
    againstConcentration: options.againstConcentration,
    mode: options.mode,
  });

  const hasAdvantage = rollMode === 'advantage';
  const hasDisadvantage = rollMode === 'disadvantage';

  const autoFail = stats.activeFlags.has(`save.autoFail.${saveAbility}`);

  const { findCurrentDndEntity } = useWorldEntities();

  return {
    modifier,
    evaluateBonusRollFormulas: buildRollBonusEvaluator(
      // Окно могло остаться открытым после замены сущности новым снимком мира
      () => findCurrentDndEntity(entity.id),
      listSavingThrowBonusKeys(saveAbility, options),
    ),
    hasAdvantage,
    hasDisadvantage,
    autoFail,
  };
}

/**
 * Считает данные спасброска цели по её контексту.
 *
 * @param target - цель спасброска
 * @returns модификатор и флаги цели
 */
function resolveTargetSaveInfo(target: SavingThrowTarget): ActorSaveInfo {
  return getActorSaveInfo(target.entity, target.ability, {
    againstMagic: target.againstMagic ?? true,
    againstSpell: target.againstSpell,
    againstCondition: target.againstCondition,
    againstConcentration: target.againstConcentration,
    mode: target.mode,
  });
}

/**
 * Собирает запрос броска для ядра: адрес, подпись, нагрузка и формула
 * нейтрального броска на случай, если у адресата не окажется окна системы.
 *
 * @param target - цель спасброска
 * @returns параметры запроса для `rollRequests`
 */
function buildRollRequestOptions(
  target: SavingThrowTarget,
): RollRequestOptions {
  const payload: SavingThrowRequestPayload = {
    kind: SAVING_THROW_REQUEST_KIND,
    ability: target.ability,
    dc: target.dc,
    againstMagic: target.againstMagic ?? true,
    ...(target.againstSpell ? { againstSpell: true } : {}),
    againstCondition: target.againstCondition,
    ...(target.againstConcentration ? { againstConcentration: true } : {}),
    // Режим самого спасброска едет к адресату: у него тот же счёт флагов
    ...(target.mode ? { mode: target.mode } : {}),
    ...(target.allowWilling ? { allowWilling: true } : {}),
    sourceName: target.sourceName,
  };

  return {
    entityId: target.entity.id,
    sourceEntityId: target.sourceEntityId,
    title: formatSavingThrowRequestTitle(
      target.ability,
      target.dc,
      target.sourceName,
    ),
    fallbackFormula: buildSavingThrowFormula(resolveTargetSaveInfo(target)),
    payload,
  };
}

/**
 * Разбирает ответ на запрос: свой результат или бросок нейтрального окна ядра.
 *
 * @param target - цель спасброска
 * @param answer - непрозрачный `result` из исхода запроса
 * @returns результат спасброска либо `null`, если форма ответа незнакома
 */
function readSavingThrowAnswer(
  target: SavingThrowTarget,
  answer: unknown,
): SavingThrowResult | null {
  const parsed = parseSavingThrowResult(answer);

  if (parsed) {
    return parsed;
  }

  // Нейтральное окно ядра: у адресата не сработал наш слот, и он бросил
  // нашу же `fallbackFormula` — модификатор в итоге уже сидит.
  if (isNeutralRollAnswer(answer)) {
    // Бросок пришёл с чужого клиента: без оставленной d20 форма ответа
    // незнакома, и падать на ней нельзя — вызывающий честно сообщит об этом
    const natural = parseNaturalD20Roll(answer.rollData);

    if (natural === undefined) {
      return null;
    }

    return buildSavingThrowResult(
      answer.total,
      natural,
      resolveTargetSaveInfo(target),
      target.dc,
    );
  }

  return null;
}

/**
 * Композабл для обработки спасбросков от заклинаний.
 *
 * Спасбросок цели под ЧУЖИМ владением уходит запросом её владельцу
 * (`api.rollRequests`): по правилам бросает владелец, а не тот, кто нажал.
 * Свои цели и цели без владельца по-прежнему бросают здесь же.
 */
export function useSpellSavingThrows() {
  const diceRollerStore = useDiceRollerStore();
  const chatStore = useChatStore();
  const worldStore = useWorldStore();
  const { openModal } = useModalManager();

  /**
   * Открывает окно спасброска — одно на оба применения: свой бросок и бросок
   * по чужому запросу. Подписи, модификатор и режим считаются здесь же, чтобы
   * две стороны канала не разъезжались.
   *
   * @param target - цель спасброска
   * @param options - ключ окна, режим «за адресата» и коллбэки
   * @returns идентификатор окна либо `null`, если окно с этим ключом уже открыто
   */
  function openSavingThrowModal(
    target: SavingThrowTarget,
    options: SavingThrowModalOptions,
  ): string | null {
    const info = resolveTargetSaveInfo(target);

    const title = formatSavingThrowTitle(
      target.ability,
      target.entity.name,
      target.dc,
    );

    return openModal('DiceRollModal', {
      ...(options.modalKey
        ? { _modalKey: options.modalKey }
        : { allowMultiple: true }),
      title: options.takeover
        ? `${SAVING_THROW_ROLL_LABELS.takeoverPrefix}${title}`
        : title,
      rollLabel: formatSavingThrowRollLabel(target.ability, target.entity.name),
      rollButtonText: SAVING_THROW_ROLL_LABELS.button,
      modifier: info.modifier,
      initialRollMode: determineRollMode(
        info.hasAdvantage,
        info.hasDisadvantage,
      ),
      autoFail: info.autoFail,
      allowWilling: target.allowWilling === true,
      targetDc: target.dc,
      evaluateBonusRollFormulas: info.evaluateBonusRollFormulas,
      onCheckRoll: (result: CheckRollResult) => {
        const outcome = buildSavingThrowResult(
          result.total,
          result.natural,
          info,
          target.dc,
        );

        // Согласие — провал при любой Сл: при Сл 1 условная единица иначе
        // «прошла» бы спасбросок
        options.onResult(
          result.willing ? { ...outcome, passed: false } : outcome,
        );
      },
      onCancel: options.onCancel,
    });
  }

  /**
   * Бросает спасбросок за цель автоматически и пишет бросок в чат.
   *
   * @param target - цель спасброска
   * @returns результат спасброска
   */
  function rollSavingThrow(target: SavingThrowTarget): SavingThrowResult {
    const info = resolveTargetSaveInfo(target);

    if (info.autoFail) {
      return {
        roll: 1,
        modifier: info.modifier,
        total: 1 + info.modifier,
        passed: false,
      };
    }

    const formula = buildSavingThrowFormula(info);
    const rollData = diceRollerStore.parseAndRoll(formula);
    const total = rollData.total;

    const result = buildSavingThrowResult(
      total,
      getNaturalD20Roll(rollData),
      info,
      target.dc,
    );

    rollData.label = `${formatSavingThrowRollLabel(target.ability, target.entity.name)}${
      result.passed
        ? SAVING_THROW_ROLL_LABELS.successSuffix
        : SAVING_THROW_ROLL_LABELS.failureSuffix
    }`;

    chatStore.sendMessage(formula, 'roll', rollData);

    return result;
  }

  /**
   * Запрашивает ручной бросок спасброска через DiceRollModal У СЕБЯ.
   *
   * Окно можно закрыть, не бросив, — тогда промис отдаёт `null`. Это НЕ провал
   * спасброска и не успех: вызывающий обязан свернуть начатое действие целиком
   * (без такого ответа оно повисало навсегда — молча, без урона и без чата).
   *
   * @param target - цель спасброска
   * @returns промис с результатом спасброска или `null`, если окно закрыли
   */
  function requestManualSavingThrow(
    target: SavingThrowTarget,
  ): Promise<SavingThrowResult | null> {
    return new Promise((resolve) => {
      openSavingThrowModal(target, {
        onResult: resolve,
        onCancel: () => {
          resolve(null);
        },
      });
    });
  }

  /**
   * Разрешает спасбросок СВОЕЙ цели: авто-бросок или окно по `autoSaves`.
   *
   * @param target - цель спасброска
   * @returns промис с результатом или `null`, если окно закрыли
   */
  function resolveSavingThrowLocally(
    target: SavingThrowTarget,
  ): Promise<SavingThrowResult | null> {
    if (resolveAutoSaves(target.entity)) {
      return Promise.resolve(rollSavingThrow(target));
    }

    return requestManualSavingThrow(target);
  }

  /**
   * Под чужим ли владением цель: такая бросает сама, у своего владельца.
   *
   * Сущность без владельца и своя собственная бросают здесь же — просить
   * некого. В сети ли владелец, не проверяем: ядро само ответит
   * `noRecipient`, и мы откатимся на свой бросок.
   *
   * @param entity - сущность-цель
   * @returns true, если спасбросок надо просить у другого пользователя
   */
  function isForeignOwnedTarget(entity: SceneEntity): boolean {
    return (
      getEntityOwnerIds(entity).length > 0
      && !isEntityOwner(entity, worldStore.connectionState.loggedAsUserId)
    );
  }

  /**
   * Приводит исход запроса к результату спасброска.
   *
   * Каждый из шести исходов разобран явно: ответ и бросок «за адресата» дают
   * результат, отказ и таймаут сворачивают действие (`null`), а отсутствие
   * адресата и отказ сервера откатывают на СВОЙ бросок — ровно то поведение,
   * что было до появления канала.
   *
   * @param target - цель спасброска
   * @param outcome - исход запроса от ядра
   * @returns результат спасброска или `null`, если действие свёрнуто
   */
  function resolveRequestOutcome(
    target: SavingThrowTarget,
    outcome: RollRequestOutcome,
  ): Promise<SavingThrowResult | null> {
    switch (outcome.status) {
      case 'answered':
      case 'takenOver': {
        const result = readSavingThrowAnswer(target, outcome.result);

        if (!result) {
          // Ответ чужой формы — бросать второй раз нельзя (адресат уже
          // написал свой бросок в чат), поэтому сворачиваем действие.
          console.warn(
            `${SAVING_THROW_LOG_PREFIX} Незнакомая форма ответа на спасбросок «${target.entity.name}»`,
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
          `${SAVING_THROW_LOG_PREFIX} Запрос спасброска не принят: ${outcome.reason}`,
        );

        break;
      case 'noRecipient':
        break;
    }

    // Адресата нет в сети либо сервер запрос не принял — бросаем сами, ровно
    // как до появления канала.
    return resolveSavingThrowLocally(target);
  }

  /**
   * Разрешает спасбросок одной цели: запросом её владельцу или своим броском.
   *
   * @param target - цель спасброска
   * @returns промис с результатом или `null`, если бросок отменили
   */
  async function resolveSavingThrowForTarget(
    target: SavingThrowTarget,
  ): Promise<SavingThrowResult | null> {
    if (!isForeignOwnedTarget(target.entity)) {
      return resolveSavingThrowLocally(target);
    }

    const outcome = await getRollRequestService().request(
      buildRollRequestOptions(target),
    );

    return resolveRequestOutcome(target, outcome);
  }

  /**
   * Разрешает спасброски сразу нескольких целей.
   *
   * Запросы чужим владельцам уходят ОДНОЙ пачкой и ждут параллельно: пятеро
   * задетых площадью игроков бросают одновременно, а не в очередь. Пока они
   * бросают, свои цели разбираются здесь — авто-броски первыми (их результат
   * уходит в чат сразу), затем окна по одному.
   *
   * @param targets - цели спасброска (по одной записи на сущность)
   * @returns карта «id сущности → результат»; `null` — бросок отменили
   */
  async function resolveSavingThrowsForTargets(
    targets: readonly SavingThrowTarget[],
  ): Promise<Map<string, SavingThrowResult | null>> {
    const results = new Map<string, SavingThrowResult | null>();

    const foreignTargets: SavingThrowTarget[] = [];
    const autoTargets: SavingThrowTarget[] = [];
    const manualTargets: SavingThrowTarget[] = [];

    // Одна сущность — один спасбросок, даже если её токен попал в область
    // дважды: иначе владельцу прилетело бы два окна на одно и то же.
    const uniqueTargets = new Map<string, SavingThrowTarget>();

    for (const target of targets) {
      if (!uniqueTargets.has(target.entity.id)) {
        uniqueTargets.set(target.entity.id, target);
      }
    }

    for (const target of uniqueTargets.values()) {
      if (isForeignOwnedTarget(target.entity)) {
        foreignTargets.push(target);
      } else if (resolveAutoSaves(target.entity)) {
        autoTargets.push(target);
      } else {
        manualTargets.push(target);
      }
    }

    // Пачка уходит ДО своих бросков: адресаты получают окна сразу и бросают,
    // пока инициатор занят своими.
    const foreignOutcomes =
      foreignTargets.length > 0
        ? getRollRequestService().requestMany(
            foreignTargets.map(buildRollRequestOptions),
          )
        : null;

    for (const target of [...autoTargets, ...manualTargets]) {
      results.set(target.entity.id, await resolveSavingThrowLocally(target));
    }

    if (foreignOutcomes) {
      const outcomes = await foreignOutcomes;

      for (const [index, outcome] of outcomes.entries()) {
        const target = foreignTargets[index];

        results.set(
          target.entity.id,
          await resolveRequestOutcome(target, outcome),
        );
      }
    }

    return results;
  }

  return {
    isForeignOwnedTarget,
    openSavingThrowModal,
    rollSavingThrow,
    resolveSavingThrowForTarget,
    resolveSavingThrowsForTargets,
  };
}
