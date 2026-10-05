/**
 * Провал каста на столе: шанс или спасбросок заклинателя из правила каста
 * эффектов на нём (`castRule`, `engine/effectCastRule.ts`).
 *
 * Зовётся одинаково со всех путей каста — лист, горячая панель, статблок, —
 * когда каст уже точно идёт и действие потрачено: «Замедление» с шансом 25 %
 * у заклинаний с соматическим компонентом, «Слово силы: Боль» со спасброском
 * Телосложения. Провал — строка в чат и конец каста; ячейку списывают, только
 * если так велит правило.
 */

import type {
  CastFailureCheck,
  CastFailureOutcome,
  CastFailureSpell,
  DnDSceneEntity,
  Spell,
} from '@vtt/shared/system/dnd.js';

import type { PayableSource } from './effectPayChoice';

import { useChatStore } from '@/stores/chatStore';
import {
  formatCastFailureMessage,
  listCastFailureChecks,
  resolveLostCastSlotLevel,
  rollCastFailChance,
  SOURCE_SAVE_DC,
} from '@vtt/shared/system/dnd.js';

import { runWithEffectPay, runWithSpellCastPay } from './effectPayChoice';
import { listAmbientEffects } from './useResolvedStats';
import { useSpellSavingThrows } from './useSpellSavingThrows';

/** Что проверка провала читает у заклинания */
export type CastFailureSource = CastFailureSpell
  & Pick<Spell, 'name'>
  & Partial<Pick<Spell, 'level' | 'uses'>>;

/** С чем идёт каст */
export interface CastFailureOptions {
  /** Круг, выбранный раньше (область, снаряды, цели) */
  lockedLevel?: number;
  /** Круги, которыми можно наложить: ячейку провала берут наименьшую */
  availableLevels?: readonly number[];
  /** Запись заклинателя после списания ячейки; нет — сохранением сущности */
  commit?: (caster: DnDSceneEntity) => void;
  /**
   * Чем каст платит вместо ячейки листа: заряд заклинания существа. Задано —
   * проваленный каст с потерей ячейки списывает его
   */
  loseUse?: () => void;
  /**
   * Трата хода. Ход тратится, когда каст состоялся: окно открылось, каст
   * применён сразу — или сорвался: сорвавшийся каст действие тоже тратит
   */
  spendTurn?: () => void;
}

/**
 * Сообщает о провале каста и списывает ячейку, если так велит правило.
 *
 * @param spell - заклинание
 * @param caster - заклинатель
 * @param options - с чем идёт каст
 * @param outcome - чем провалился каст
 */
function settleCastFailure(
  spell: CastFailureSource,
  caster: DnDSceneEntity,
  options: CastFailureOptions,
  outcome: CastFailureOutcome,
): void {
  const { losesSlot } = outcome.check;
  const loseUse = losesSlot ? options.loseUse : undefined;

  const slotLevel =
    losesSlot && !loseUse
      ? resolveLostCastSlotLevel(spell, options)
      : undefined;

  useChatStore().sendMessage(
    formatCastFailureMessage(
      caster.name,
      spell.name,
      outcome,
      loseUse !== undefined || slotLevel !== undefined,
    ),
    'text',
  );

  options.spendTurn?.();
  loseUse?.();

  if (slotLevel === undefined) {
    return;
  }

  // Ячейку списывает та же оплата, что и цену ресурсом: одна запись листа
  runWithEffectPay(
    {
      payer: caster,
      pay: [{ kind: 'spellSlot', minLevel: slotLevel, maxLevel: slotLevel }],
      sourceName: spell.name,
      ...(options.commit ? { commit: options.commit } : {}),
    },
    () => {},
  );
}

/**
 * Проходит одну проверку провала.
 *
 * @param check - проверка
 * @param caster - заклинатель
 * @returns чем провалился каст; `null` — проверка пройдена; `undefined` —
 *   окно спасброска закрыли, каст сворачивается без сообщения
 */
async function runCastFailureCheck(
  check: CastFailureCheck,
  caster: DnDSceneEntity,
): Promise<CastFailureOutcome | null | undefined> {
  if (check.chance !== undefined) {
    const { roll, failed } = rollCastFailChance(check.chance);

    if (failed) {
      return { check, roll };
    }
  }

  // Сл 0 — Сл источника, которую не проставили: спасбросок против нуля прошёл
  // бы у кого угодно, его не бросают
  if (!check.save || check.save.dc <= SOURCE_SAVE_DC) {
    return null;
  }

  const result = await useSpellSavingThrows().resolveSavingThrowForTarget({
    entity: caster,
    ability: check.save.ability,
    dc: check.save.dc,
    sourceEntityId: caster.id,
    sourceName: check.sourceName,
  });

  if (result === null) {
    return undefined;
  }

  return result.passed ? null : { check, saveTotal: result.total };
}

/**
 * Продолжает каст, если заклинание прошло проверки провала. Без правил каста
 * продолжение идёт сразу и синхронно.
 *
 * @param spell - заклинание
 * @param caster - заклинатель
 * @param options - с чем идёт каст
 * @param proceed - продолжение каста
 */
export function runWithCastFailure(
  spell: CastFailureSource,
  caster: DnDSceneEntity,
  options: CastFailureOptions,
  proceed: () => void,
): void {
  const checks = listCastFailureChecks(
    caster,
    spell,
    listAmbientEffects(caster.id),
  );

  if (checks.length === 0) {
    proceed();

    return;
  }

  /**
   * Проверки по очереди: первая проваленная заканчивает каст.
   */
  const runChecks = async (): Promise<void> => {
    for (const check of checks) {
      // Проверки идут строго по очереди: окно спасброска одно

      const outcome = await runCastFailureCheck(check, caster);

      if (outcome === undefined) {
        return;
      }

      if (outcome !== null) {
        settleCastFailure(spell, caster, options, outcome);

        return;
      }
    }

    proceed();
  };

  void runChecks();
}

/**
 * Каст заклинания листа от проверки провала до оплаты: сперва провал
 * («Замедление», «Слово силы: Боль») — неудавшееся заклинание цену сверх
 * ячейки не берёт, — затем цена ресурсом, затем сам каст.
 *
 * @param spell - заклинание
 * @param caster - заклинатель
 * @param options - закреплённый круг, доступные круги и запись оплаты
 * @param proceed - продолжение каста: оплаченное заклинание, закреплённый
 *   круг и заклинатель после оплаты
 */
export function runWithCastFailureAndPay<
  Source extends CastFailureSource & PayableSource,
>(
  spell: Source,
  caster: DnDSceneEntity,
  options: CastFailureOptions & { availableLevels: readonly number[] },
  proceed: (
    paidSpell: Source,
    lockedLevel: number | undefined,
    paidCaster: DnDSceneEntity,
  ) => void,
): void {
  runWithCastFailure(spell, caster, options, () => {
    runWithSpellCastPay(spell, caster, options, proceed);
  });
}
