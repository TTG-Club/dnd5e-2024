import type { DamagePart, SceneEntity } from '@vtt/shared';
import type {
  ActiveEffect,
  DamageDefenseOutcome,
  DnDSceneEntity,
  EffectLandingContext,
  SavingThrowResult,
  Spell,
} from '@vtt/shared/system/dnd.js';

import { useDiceRollerStore } from '@/stores/diceRollerStore';
import {
  getEntityConditionImmunities,
  hasLastingEffectPayload,
  isDndSceneEntity,
  isImmuneToCondition,
  isMagicalEffect,
  isMagicRoll,
  isSpellRoll,
  passesLandingCondition,
  resolveActorStats,
  resolveEffectApplication,
  resolveEffectSaveDc,
  rollEffectDamageParts,
  stampSourceTurnSaveDc,
} from '@vtt/shared/system/dnd.js';

import { resolveSpellCastId } from './spellCasts';
import {
  getPartKindLabel,
  getTargetSpellEffects,
  stampEffectOnApply,
} from './spellResolutionShared';
import { useSpellSavingThrows } from './useSpellSavingThrows';
import { useWorldEntities } from './useWorldEntities';

/** Строка чата для одной части урона наложенного эффекта */
export interface EffectDamageLine {
  /** Локализованный тип урона (для заголовка) */
  typeLabel: string;
  /** Формула броска */
  formula: string;
  /** Выпавшие значения кубиков */
  values: number[];
  /** Итог урона после множителя спаса и защит */
  applied: number;
  /** Сработавшая защита (уязв./сопр./иммун.) */
  outcome: DamageDefenseOutcome;
}

/** Что даёт цели разбор её target-эффектов: наложить, добавить урон, показать */
export interface TargetEffectsResult {
  /** Эффекты, которые ложатся на цель */
  effects: ActiveEffect[];
  /** Доп. урон от эффектов (уже с множителем спаса и защитами) */
  bonusDamage: number;
  /** Сработавшая защита цели на этом доп. уроне */
  defenseOutcome: DamageDefenseOutcome;
  /** Строки разбивки доп. урона для чата */
  damageLines: EffectDamageLine[];
}

/** Цель и заклинание, чьи target-эффекты разбираются */
export interface TargetEffectsInput {
  /** Заклинание (или псевдо-заклинание оружия/действия) с эффектами */
  spell: Spell;
  /** Цель */
  entity: SceneEntity;
  /** Сл спасброска источника — ею заменяется Сл 0 в эффекте */
  spellSaveDC: number;
  /** Кто накладывает (якорь точной длительности, право запроса броска) */
  casterId?: string;
}

/** Спасброски эффектов цели по идентификатору эффекта */
export type EffectSaveResults = ReadonlyMap<string, SavingThrowResult>;

/**
 * Эффекты заклинания, у которых свой спасбросок при наложении.
 *
 * @param spell - заклинание
 * @returns target-эффекты с `applySave`
 */
export function listEffectsWithOwnSave(spell: Spell): ActiveEffect[] {
  return getTargetSpellEffects(spell).filter(
    (effect) => effect.applySave !== undefined,
  );
}

/**
 * Наложивший эффект сущностью системы: условие наложения читает его тип.
 *
 * @param casterId - наложивший
 * @returns сущность либо `undefined`
 */
function resolveLandingSource(
  casterId: string | undefined,
): DnDSceneEntity | undefined {
  return useWorldEntities().findCurrentDndEntity(casterId);
}

/**
 * Разбор эффектов, которые заклинание, оружие или действие накладывает на
 * цель: спасброски эффектов, урон эффектов и то, что остаётся висеть на цели.
 *
 * Один на оба пути разрешения заклинания — многочастный и одночастный (со
 * снарядами). Пока путей было два, второй молча накладывал эффект со своим
 * спасброском без броска и не наносил урон эффекта.
 */
export function useTargetEffectResolution() {
  const diceRollerStore = useDiceRollerStore();

  const { resolveSavingThrowForTarget, rollSavingThrow } =
    useSpellSavingThrows();

  /**
   * Бросает урон эффекта общим броском движка (`rollEffectDamageParts`): доля
   * спасброска от суммы частей, затем защиты цели по типу. Кости — кубиками
   * клиента, строки — для чата.
   *
   * @param entity - цель
   * @param parts - части урона эффекта
   * @param multiplier - доля урона (1 / 0.5 по результату спасброска)
   * @returns суммарный урон, сработавшая защита цели и строки для чата
   */
  function rollEffectDamage(
    entity: SceneEntity,
    parts: DamagePart[],
    multiplier: number,
  ): {
    damage: number;
    outcome: DamageDefenseOutcome;
    lines: EffectDamageLine[];
  } {
    // Ядро видит entity как Base*; D&D-форму подтверждает гвард
    if (!isDndSceneEntity(entity)) {
      return { damage: 0, outcome: 'normal', lines: [] };
    }

    const rolled = rollEffectDamageParts(
      parts,
      resolveActorStats(entity),
      entity,
      {
        scale: multiplier,
        rollFormula: (formula) => {
          const roll = diceRollerStore.parseAndRoll(formula);

          return {
            total: roll.total,
            values: roll.dice.flatMap((group) => group.values),
          };
        },
      },
    );

    return {
      damage: rolled.total,
      outcome: rolled.outcome,
      lines: rolled.lines.map((line) => ({
        typeLabel: getPartKindLabel({
          isHealing: false,
          type: line.type,
          types: line.types,
        }),
        formula: line.formula,
        values: line.values,
        applied: line.applied,
        outcome: line.outcome,
      })),
    };
  }

  /**
   * Спасброски эффектов со своим `applySave`: окном у своей цели без
   * авто-спасбросков, запросом владельцу чужой, автоматически у остальных.
   *
   * Эффекты разбираются по очереди: у одной цели окна не должны открываться
   * пачкой одно поверх другого.
   *
   * @param input - заклинание, цель, Сл источника, кастер
   * @returns спасброски по эффектам либо `null`, если бросок отменили
   */
  async function resolveEffectSaves(
    input: TargetEffectsInput,
  ): Promise<EffectSaveResults | null> {
    const results = new Map<string, SavingThrowResult>();

    for (const effect of listEffectsWithOwnSave(input.spell)) {
      if (!effect.applySave) {
        continue;
      }

      const saveResult = await resolveSavingThrowForTarget({
        entity: input.entity,
        ability: effect.applySave.ability,
        dc: resolveEffectSaveDc(effect.applySave.dc, input.spellSaveDC),
        againstCondition: effect.conditionKey,
        againstSpell: isSpellRoll(input.spell),
        sourceEntityId: input.casterId,
        sourceName: effect.name,
      });

      // Окно спасброска эффекта закрыли — вызывающий сворачивает всё действие
      if (saveResult === null) {
        return null;
      }

      results.set(effect.id, saveResult);
    }

    return results;
  }

  /**
   * Спасброски эффектов со своим `applySave`, брошенные сразу, без окна. Для
   * синхронного пути (снаряды): там, где спасбросок самого заклинания тоже
   * бросается автоматически.
   *
   * @param input - заклинание, цель, Сл источника, кастер
   * @returns спасброски по эффектам
   */
  function rollEffectSaves(input: TargetEffectsInput): EffectSaveResults {
    const results = new Map<string, SavingThrowResult>();

    for (const effect of listEffectsWithOwnSave(input.spell)) {
      if (!effect.applySave) {
        continue;
      }

      results.set(
        effect.id,
        rollSavingThrow({
          entity: input.entity,
          ability: effect.applySave.ability,
          dc: resolveEffectSaveDc(effect.applySave.dc, input.spellSaveDC),
          againstCondition: effect.conditionKey,
          againstSpell: isSpellRoll(input.spell),
          sourceEntityId: input.casterId,
          sourceName: effect.name,
        }),
      );
    }

    return results;
  }

  /**
   * Собирает то, что target-эффекты дают цели, по УЖЕ известным спасброскам.
   *
   * Эффект применяется по своему спасброску (если он есть), иначе по факту
   * приземления действия; урон эффекта катается с множителем спасброска. На
   * цели остаются только эффекты с длящейся нагрузкой — чисто-уронный эффект
   * лишь бьёт.
   *
   * @param input - заклинание, цель, Сл источника, кастер
   * @param landingSave - спасбросок цели от самого заклинания (если был)
   * @param effectSaves - спасброски эффектов со своим `applySave`
   * @returns эффекты для наложения, доп. урон и строки для чата
   */
  function collectTargetEffects(
    input: TargetEffectsInput,
    landingSave: SavingThrowResult | undefined,
    effectSaves: EffectSaveResults,
  ): TargetEffectsResult {
    const { spell, entity, spellSaveDC, casterId } = input;

    // Приземление: атака/авто (saveType 'none') доходят сюда только попавшими;
    // для спасброска заклинания «приземлилось» = цель его провалила.
    const landed = spell.saveType === 'none' || !landingSave?.passed;

    const immunities = isDndSceneEntity(entity)
      ? getEntityConditionImmunities(entity)
      : [];

    // Флаги цели — для «Увёртливости» на спасброске эффекта
    const targetFlags = isDndSceneEntity(entity)
      ? resolveActorStats(entity).activeFlags
      : undefined;

    const effects: ActiveEffect[] = [];
    const damageLines: EffectDamageLine[] = [];

    let bonusDamage = 0;
    let defenseOutcome: DamageDefenseOutcome = 'normal';

    const landing: EffectLandingContext = {
      source: resolveLandingSource(casterId),
      weaponMastery: spell.weaponMastery,
    };

    const landingEffects = getTargetSpellEffects(spell).filter(
      (effect) =>
        !isDndSceneEntity(entity)
        || passesLandingCondition(effect, entity, landing),
    );

    for (const effect of landingEffects) {
      const application = resolveEffectApplication(effect, {
        landed,
        applySaveSucceeded: effectSaves.get(effect.id)?.passed,
        targetFlags,
        againstMagic: isMagicRoll(spell) || isMagicalEffect(effect),
      });

      if (
        effect.damageParts
        && effect.damageParts.length > 0
        && application.damageMultiplier > 0
      ) {
        const rolled = rollEffectDamage(
          entity,
          effect.damageParts,
          application.damageMultiplier,
        );

        bonusDamage += rolled.damage;
        damageLines.push(...rolled.lines);

        if (rolled.outcome !== 'normal') {
          defenseOutcome = rolled.outcome;
        }
      }

      if (!application.applyEffect) {
        continue;
      }

      // Чисто-урон эффекты (без состояния и без модификаторов) не «висят» на
      // цели — они только наносят урон (напр. яд за спасбросок). Но эффект с
      // периодикой (DoT/повторный спас) обязан остаться на цели, чтобы тикать.
      if (!hasLastingEffectPayload(effect)) {
        continue;
      }

      const immune =
        effect.conditionKey !== undefined
        && isImmuneToCondition(immunities, effect.conditionKey);

      if (!immune) {
        // Наложивший и точная turn-длительность — в момент наложения: нужен
        // текущий ход энкаунтера
        effects.push(
          stampEffectOnApply(stampSourceTurnSaveDc(effect, spellSaveDC), {
            carrierId: entity.id,
            sourceId: casterId,
            castId: resolveSpellCastId(casterId, spell),
          }),
        );
      }
    }

    return { effects, bonusDamage, defenseOutcome, damageLines };
  }

  /**
   * Разбирает target-эффекты цели целиком: спасброски эффектов (окнами и
   * запросами), затем урон и наложение.
   *
   * @param input - заклинание, цель, Сл источника, кастер
   * @param landingSave - спасбросок цели от самого заклинания (если был)
   * @returns итог по цели либо `null`, если спасбросок эффекта отменили
   */
  async function resolveTargetEffects(
    input: TargetEffectsInput,
    landingSave: SavingThrowResult | undefined,
  ): Promise<TargetEffectsResult | null> {
    const effectSaves = await resolveEffectSaves(input);

    if (effectSaves === null) {
      return null;
    }

    return collectTargetEffects(input, landingSave, effectSaves);
  }

  return {
    collectTargetEffects,
    resolveTargetEffects,
    resolveEffectSaves,
    rollEffectSaves,
  };
}
