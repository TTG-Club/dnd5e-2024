/**
 * Оплата цены ресурсом на столе: применение и включение эффекта, каст
 * заклинания, кнопка «При действии».
 *
 * Порядок один на все пути: разбор цены по листу платящего → отказ, если
 * ресурса не хватает → плашка выбора там, где платить можно по-разному →
 * списание и строка в чат → продолжение с потраченным (`@paid.*`). Закрытая
 * плашка и отказ ничего не списывают.
 *
 * Ресурсы листа боевой канал не несёт, поэтому оплата сохраняется обычным
 * сохранением сущности — и ДО наложения эффектов: полное сохранение, пришедшее
 * вторым, вернуло бы эффекты прежними.
 */

import type {
  DnDSceneEntity,
  EffectPaid,
  EffectPay,
  PaidSource,
  PayContext,
  PayPlan,
  PaySettlement,
} from '@vtt/shared/system/dnd.js';

import { emitEntityCombatState, emitEntityUpdate } from '@/core/entityUtils';
import { useModalManager } from '@/shared_ui/composables/useModalManager';
import { useChatStore } from '@/stores/chatStore';
import { generateId } from '@vtt/shared';
import {
  bindSourcePaid,
  collectSourcePay,
  defaultPayPicks,
  payNeedsChoice,
  payUsesCastLevel,
  planEffectPay,
  settleEffectPay,
  sheetResourcesDiffer,
  usesPaidHitDiceRoll,
  withSheetResources,
} from '@vtt/shared/system/dnd.js';

import { useSystemToastStore } from '../stores/systemToastStore';
import {
  EFFECT_PAY_MODAL_KEY_PREFIX,
  EFFECT_PAY_PROMPT_LABELS,
  EFFECT_PAY_PROMPT_MODAL,
} from '../ui/effect/payLabels';
import { useWorldEntities } from './useWorldEntities';

/** Что и чем оплачивают */
export interface EffectPayRequest {
  /** Кто платит — актуальная запись мира */
  payer: DnDSceneEntity;
  /** Цена */
  pay: EffectPay;
  /** За что платят: заклинание, умение, предмет — для плашки и чата */
  sourceName: string;
  /** Круг каста, предмет-источник и нужен ли бросок костей */
  context?: PayContext;
  /**
   * Запись платящего после оплаты. Нет — обычным сохранением сущности мира;
   * лист передаёт свою запись, чтобы его сохранение не затёрло оплату, а
   * применение — чтобы тем же сохранением ушёл и прежний расход источника.
   */
  commit?: (paidPayer: DnDSceneEntity) => void;
}

/** Источник с эффектами и собственным уроном: заклинание, применение */
export interface PayableSource extends PaidSource {
  name: string;
}

/**
 * Предупреждает, что цена не по карману.
 *
 * @param sourceName - за что платят
 * @param shortfall - чего не хватает
 */
export function warnPayShortfall(sourceName: string, shortfall: string): void {
  useSystemToastStore().add({
    title: `${EFFECT_PAY_PROMPT_LABELS.shortfallTitle}: ${sourceName}`,
    description: shortfall,
    color: 'warning',
  });
}

/**
 * Сохраняет платящего после оплаты и пишет в чат, что потрачено.
 *
 * @param request - что и чем оплачивают
 * @param settlement - итог оплаты
 */
function commitPaySettlement(
  request: EffectPayRequest,
  settlement: PaySettlement,
): void {
  if (request.commit) {
    request.commit(settlement.entity);
  } else {
    const socket = useChatStore().getSocket();

    if (socket) {
      emitEntityUpdate(socket, settlement.entity);
    }
  }

  if (settlement.notes.length > 0) {
    useChatStore().sendMessage(
      `${request.payer.name}${EFFECT_PAY_PROMPT_LABELS.chatMiddle}${request.sourceName}${EFFECT_PAY_PROMPT_LABELS.chatSuffix}${settlement.notes.join(EFFECT_PAY_PROMPT_LABELS.chatJoiner)}`,
      'text',
    );
  }
}

/**
 * Спрашивает выбор там, где платить можно по-разному, и отдаёт ключи выбранных
 * вариантов. Без выбора отвечает сразу и синхронно; закрытая плашка — отмена.
 *
 * @param plan - разбор цены
 * @param sourceName - за что платят
 * @param proceed - продолжение с ключами выбранных вариантов
 */
export function choosePayOptions(
  plan: PayPlan,
  sourceName: string,
  proceed: (optionIds: ReadonlySet<string>) => void,
): void {
  const fixed = plan.prices
    .filter((entry) => entry.options.length === 1)
    .flatMap((entry) => entry.options.map((option) => option.id));

  if (!payNeedsChoice(plan)) {
    proceed(new Set((defaultPayPicks(plan) ?? []).map((option) => option.id)));

    return;
  }

  useModalManager().openModal(EFFECT_PAY_PROMPT_MODAL, {
    _modalKey: generateId(EFFECT_PAY_MODAL_KEY_PREFIX),
    sourceName,
    prices: plan.prices.filter((entry) => entry.options.length > 1),
    onConfirm: (optionIds: string[]) => {
      proceed(new Set([...fixed, ...optionIds]));
    },
  });
}

/**
 * Оплачивает цену и продолжает действие с потраченным. Не хватает ресурса —
 * предупреждение, действие не продолжается.
 *
 * @param request - что и чем оплачивают
 * @param proceed - продолжение с потраченным и платящим после оплаты
 */
export function runWithEffectPay(
  request: EffectPayRequest,
  proceed: (paid: EffectPaid, paidPayer: DnDSceneEntity) => void,
): void {
  const plan = planEffectPay(request.payer, request.pay, request.context);

  if (plan.shortfall !== null) {
    warnPayShortfall(request.sourceName, plan.shortfall);

    return;
  }

  choosePayOptions(plan, request.sourceName, (optionIds) => {
    // Платящий перечитывается: пока выбирали, лист мог измениться
    const payer =
      useWorldEntities().findCurrentDndEntity(request.payer.id)
      ?? request.payer;

    const livePlan = planEffectPay(payer, request.pay, request.context);

    const picks = livePlan.prices.flatMap((entry) =>
      entry.options.filter((option) => optionIds.has(option.id)).slice(0, 1),
    );

    if (livePlan.shortfall !== null || picks.length < livePlan.prices.length) {
      warnPayShortfall(
        request.sourceName,
        livePlan.shortfall ?? EFFECT_PAY_PROMPT_LABELS.shortfallTitle,
      );

      return;
    }

    const settlement = settleEffectPay(payer, livePlan, picks, request.context);

    commitPaySettlement({ ...request, payer }, settlement);
    proceed(settlement.paid, settlement.entity);
  });
}

/** С чем оплачивается источник */
export interface SourcePayOptions {
  /** Круг каста: формулы количества читают `@castLevel` */
  castLevel?: number;
  /** Предмет, с которого пришёл эффект */
  itemId?: string;
  /** Запись платящего после оплаты; нет — обычным сохранением сущности */
  commit?: (paidPayer: DnDSceneEntity) => void;
}

/**
 * Оплачивает цену источника (заклинания, применения) и продолжает с ним же,
 * но уже с потраченным в формулах эффектов и собственного урона. У источника
 * без цены продолжает сразу и синхронно — тем же источником.
 *
 * @param source - заклинание или псевдо-заклинание применения
 * @param payer - кто платит
 * @param options - круг каста, предмет-источник и запись оплаты
 * @param proceed - продолжение; `paid` — была ли оплата, `paidPayer` —
 *   платящий после неё (без оплаты — прежний)
 */
export function runWithSourcePay<Source extends PayableSource>(
  source: Source,
  payer: DnDSceneEntity,
  options: SourcePayOptions,
  proceed: (
    paidSource: Source,
    paid: boolean,
    paidPayer: DnDSceneEntity,
  ) => void,
): void {
  const pay = collectSourcePay(source.activeEffects);

  if (!pay) {
    proceed(source, false, payer);

    return;
  }

  runWithEffectPay(
    {
      payer,
      pay,
      sourceName: source.name,
      context: {
        ...(options.castLevel === undefined
          ? {}
          : { castLevel: options.castLevel }),
        ...(options.itemId === undefined ? {} : { itemId: options.itemId }),
        rollHitDice: usesPaidHitDiceRoll(source),
      },
      ...(options.commit ? { commit: options.commit } : {}),
    },
    (paid, paidPayer) => {
      proceed(bindSourcePaid(source, paid), true, paidPayer);
    },
  );
}

/**
 * Оплачивает цену каста сверх ячейки («потратьте две Кости Хитов, иначе
 * заклинание провалится») и продолжает каст оплаченным заклинанием.
 *
 * Количество цены, которое растёт от круга (`@castLevel`), требует круг до
 * оплаты: его спрашивают плашкой, и дальше каст идёт уже этим кругом.
 *
 * @param spell - заклинание
 * @param caster - заклинатель
 * @param options - закреплённый круг, доступные круги и запись оплаты
 * @param options.lockedLevel - круг, выбранный раньше (область, снаряды, цели)
 * @param options.availableLevels - круги, которыми можно наложить
 * @param options.commit - запись заклинателя после оплаты
 * @param proceed - продолжение каста: заклинание, закреплённый круг и
 *   заклинатель после оплаты
 */
export function runWithSpellCastPay<Source extends PayableSource>(
  spell: Source,
  caster: DnDSceneEntity,
  options: {
    lockedLevel?: number;
    availableLevels: readonly number[];
    commit?: (paidPayer: DnDSceneEntity) => void;
  },
  proceed: (
    paidSpell: Source,
    lockedLevel: number | undefined,
    paidCaster: DnDSceneEntity,
  ) => void,
): void {
  const pay = collectSourcePay(spell.activeEffects);
  const { lockedLevel, availableLevels, commit } = options;

  /**
   * Оплата известным кругом.
   *
   * @param castLevel - круг каста; нет — цена от круга не зависит
   */
  const payAtLevel = (castLevel: number | undefined): void => {
    runWithSourcePay(
      spell,
      caster,
      {
        ...(castLevel === undefined ? {} : { castLevel }),
        ...(commit ? { commit } : {}),
      },
      (paidSpell, _paid, paidCaster) => {
        proceed(paidSpell, castLevel, paidCaster);
      },
    );
  };

  // Круг нужен до оплаты, только если от него считается количество цены
  if (!pay || lockedLevel !== undefined || !payUsesCastLevel(pay)) {
    payAtLevel(lockedLevel);

    return;
  }

  // Один доступный круг — выбирать не из чего, но закрепить его надо: цена
  // посчитана под него
  if (availableLevels.length <= 1) {
    payAtLevel(availableLevels[0]);

    return;
  }

  useModalManager().openModal('EffectQuestionPromptModal', {
    allowMultiple: true,
    question: EFFECT_PAY_PROMPT_LABELS.castLevelQuestion,
    options: availableLevels.map((castLevel) => ({
      id: String(castLevel),
      label: `${EFFECT_PAY_PROMPT_LABELS.castLevelOptionPrefix}${castLevel}`,
    })),
    sourceName: spell.name,
    onAnswer: (optionId: string) => {
      payAtLevel(Number(optionId));
    },
    onCancel: () => {},
  });
}

/**
 * Отправляет сущность после действия, выполненного на клиенте (кнопка «При
 * действии», включение переключателя): ресурсы листа — обычным сохранением,
 * хиты и эффекты — боевым каналом. Боевой канал счётчиков, костей хитов и
 * ячеек не несёт, и списанная срабатыванием цена без этого терялась.
 *
 * @param before - сущность до действия
 * @param acted - копия после действия
 */
export function emitActedEntity(
  before: DnDSceneEntity,
  acted: DnDSceneEntity,
): void {
  const socket = useChatStore().getSocket();

  if (!socket) {
    return;
  }

  // Сначала ресурсы, потом эффекты: полное сохранение, пришедшее вторым,
  // вернуло бы эффекты прежними
  if (sheetResourcesDiffer(before, acted)) {
    emitEntityUpdate(socket, withSheetResources(before, acted));
  }

  emitEntityCombatState(socket, acted);
}
