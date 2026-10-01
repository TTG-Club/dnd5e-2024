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

import { useChatStore } from '@/stores/chatStore';
import {
  CANTRIP_SPELL_LEVEL,
  formatCastFailureMessage,
  listCastFailureChecks,
  rollCastFailChance,
} from '@vtt/shared/system/dnd.js';

import { runWithEffectPay } from './effectPayChoice';
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
}

/**
 * Круг ячейки, которую тратит проваленный каст: выбранный раньше либо
 * наименьший доступный. Заговор и заклинание с зарядами ячейку не тратят.
 *
 * @param spell - заклинание
 * @param options - с чем идёт каст
 * @returns круг либо `undefined`, если ячейки у каста нет
 */
function resolveLostSlotLevel(
  spell: CastFailureSource,
  options: CastFailureOptions,
): number | undefined {
  if (
    spell.uses
    || (spell.level ?? CANTRIP_SPELL_LEVEL) <= CANTRIP_SPELL_LEVEL
  ) {
    return undefined;
  }

  const levels = (options.availableLevels ?? []).filter(
    (level) => level > CANTRIP_SPELL_LEVEL,
  );

  return (
    options.lockedLevel ?? (levels.length > 0 ? Math.min(...levels) : undefined)
  );
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
    losesSlot && !loseUse ? resolveLostSlotLevel(spell, options) : undefined;

  useChatStore().sendMessage(
    formatCastFailureMessage(
      caster.name,
      spell.name,
      outcome,
      loseUse !== undefined || slotLevel !== undefined,
    ),
    'text',
  );

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
  if (!check.save || check.save.dc <= 0) {
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
