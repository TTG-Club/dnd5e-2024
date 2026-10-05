import type { AbilityType, DamagePart, SceneEntity } from '@vtt/shared';
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
  describeSpellSaveSource,
  findUnresolvedApplySaveDc,
  getEntityConditionImmunities,
  hasLastingEffectPayload,
  isDndSceneEntity,
  isImmuneToCondition,
  isMagicalEffect,
  isMagicRoll,
  isSpellRoll,
  passesLandingCondition,
  pickSaveAbility,
  resolveActorStats,
  resolveEffectApplication,
  resolveEffectSaveDc,
  rollEffectDamageParts,
  stampSourceTurnSaveDc,
  UNRESOLVED_SAVE_DC_LABELS,
} from '@vtt/shared/system/dnd.js';

import { resolveCombatRound } from './encounterTurn';
import { resolveSpellCastId, resolveSpellCastLevel } from './spellCasts';
import {
  getPartKindLabel,
  getTargetSpellEffects,
  stampEffectOnApply,
} from './spellResolutionShared';
import { bindTargetEffectsToCaster } from './targetEffectSourceBinding';
import { warnUnresolvedSaveDc } from './unresolvedSaveDc';
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
  /**
   * Кто накладывает: якорь точной длительности, каст с концентрацией и его
   * круг, числа наложившего в формулах эффекта, источник спасброска.
   * Обязателен — без него эффект лёг бы «ничьим»
   */
  casterId: string;
  /**
   * Нанёс ли сам источник урон: гейт `requiresDamage` у частей урона эффекта.
   * Без него добивающая часть («боеприпас убийства») не катается.
   */
  damageDealt?: boolean;
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
 * Кто и чем накладывает эффекты на цель — для условий наложения.
 *
 * @param input - заклинание, цель, кастер
 * @returns контекст наложения
 */
function buildLandingContext(input: TargetEffectsInput): EffectLandingContext {
  return {
    source: resolveLandingSource(input.casterId),
    weaponMastery: input.spell.weaponMastery,
    combatRound: resolveCombatRound(),
  };
}

/**
 * Эффекты со своим спасброском, которые на эту цель вообще могут лечь.
 * Эффект, чьё условие наложения цель не проходит («Изгнание нежити» на
 * гоблина), спасброска не требует: бросок ничего бы не решал, а у чужой цели
 * ещё и дёргал бы владельца запросом.
 *
 * Числа наложившего подставлены: Сл формулой («8 + @prof + @mod.wis» у
 * «Ошеломляющего удара») — его, а не цели.
 *
 * Эффект, чью Сл не из чего посчитать, тоже не спрашивают: бросок против нуля
 * прошёл бы любой. Такой эффект не ложится вовсе (`collectTargetEffects`).
 *
 * @param input - заклинание, цель, кастер
 * @returns эффекты, у которых нужно спросить спасбросок
 */
function listLandingEffectsWithOwnSave(
  input: TargetEffectsInput,
): ActiveEffect[] {
  const { entity } = input;

  const effects = bindTargetEffectsToCaster(
    listEffectsWithOwnSave(input.spell),
    input.spell,
    input.casterId,
  ).filter(
    (effect) => findUnresolvedApplySaveDc(effect, input.spellSaveDC) === null,
  );

  if (!isDndSceneEntity(entity)) {
    return effects;
  }

  const landing = buildLandingContext(input);

  return effects.filter((effect) =>
    passesLandingCondition(effect, entity, landing),
  );
}

/**
 * Эффекты «на цель», которые проходят условие наложения у этой цели, с числами
 * наложившего.
 *
 * @param input - заклинание, цель, кастер
 * @returns эффекты, которым цель подходит
 */
function listLandingTargetEffects(input: TargetEffectsInput): ActiveEffect[] {
  const { entity } = input;

  const effects = bindTargetEffectsToCaster(
    getTargetSpellEffects(input.spell),
    input.spell,
    input.casterId,
  );

  if (!isDndSceneEntity(entity)) {
    return effects;
  }

  const landing = buildLandingContext(input);

  return effects.filter((effect) =>
    passesLandingCondition(effect, entity, landing),
  );
}

/**
 * Состояния, к которым цель невосприимчива. Иммунитет «только от существ этих
 * типов» считается по наложившему.
 *
 * @param input - цель и кастер
 * @returns ключи состояний
 */
function resolveTargetConditionImmunities(
  input: Pick<TargetEffectsInput, 'entity' | 'casterId'>,
): readonly string[] {
  const { entity } = input;

  return isDndSceneEntity(entity)
    ? getEntityConditionImmunities(
        entity,
        [],
        useWorldEntities().findEntityCreatureType(input.casterId),
      )
    : [];
}

/**
 * Достанется ли цели хоть что-то от эффектов «на цель»: урон эффекта либо сам
 * эффект. Эффект не ляжет, если цель не проходит его условие наложения
 * («невосприимчив к этому источнику» у «Ужасающего облика») или невосприимчива
 * к его состоянию.
 *
 * Нет — спасбросок самого действия у такой цели ничего не решает, и
 * спрашивать его незачем: лишнее окно, а у чужой цели ещё и запрос владельцу.
 *
 * @param input - заклинание, цель, кастер
 * @returns `true`, если хоть один эффект может лечь или ударить
 */
export function targetEffectsCanLand(input: TargetEffectsInput): boolean {
  const immunities = resolveTargetConditionImmunities(input);

  return listLandingTargetEffects(input).some(
    (effect) =>
      (effect.damageParts?.length ?? 0) > 0
      || (hasLastingEffectPayload(effect)
        && !(
          effect.conditionKey !== undefined
          && isImmuneToCondition(immunities, effect.conditionKey)
        )),
  );
}

/**
 * Характеристика спасброска эффекта у этой цели: «Сила или Ловкость» — лучшая
 * из названных. Сущность без данных системы бросает первой по записи.
 *
 * @param entity - цель
 * @param applySave - спасбросок эффекта
 * @returns характеристика
 */
function pickTargetSaveAbility(
  entity: SceneEntity,
  applySave: NonNullable<ActiveEffect['applySave']>,
): AbilityType {
  return pickSaveAbility(
    isDndSceneEntity(entity) ? entity : undefined,
    applySave,
  );
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
   * @param damageDealt - нанёс ли урон сам источник (гейт `requiresDamage`)
   * @returns суммарный урон, сработавшая защита цели и строки для чата
   */
  function rollEffectDamage(
    entity: SceneEntity,
    parts: DamagePart[],
    multiplier: number,
    damageDealt: boolean,
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
        damageDealt,
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

    for (const effect of listLandingEffectsWithOwnSave(input)) {
      if (!effect.applySave) {
        continue;
      }

      const saveResult = await resolveSavingThrowForTarget({
        entity: input.entity,
        ability: pickTargetSaveAbility(input.entity, effect.applySave),
        dc: resolveEffectSaveDc(effect.applySave.dc, input.spellSaveDC),
        againstCondition: effect.conditionKey,
        againstSpell: isSpellRoll(input.spell),
        allowWilling: effect.applySave.allowWilling,
        sourceEntityId: input.casterId,
        sourceName: effect.name,
        ...describeSpellSaveSource(input.spell),
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

    for (const effect of listLandingEffectsWithOwnSave(input)) {
      if (!effect.applySave) {
        continue;
      }

      results.set(
        effect.id,
        rollSavingThrow({
          entity: input.entity,
          ability: pickTargetSaveAbility(input.entity, effect.applySave),
          dc: resolveEffectSaveDc(effect.applySave.dc, input.spellSaveDC),
          againstCondition: effect.conditionKey,
          againstSpell: isSpellRoll(input.spell),
          sourceEntityId: input.casterId,
          sourceName: effect.name,
          ...describeSpellSaveSource(input.spell),
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

    // Иммунитет «только от существ этих типов» считается по заклинателю
    const immunities = resolveTargetConditionImmunities(input);

    // Флаги цели — для «Увёртливости» на спасброске эффекта
    const targetFlags = isDndSceneEntity(entity)
      ? resolveActorStats(entity).activeFlags
      : undefined;

    const effects: ActiveEffect[] = [];
    const damageLines: EffectDamageLine[] = [];

    let bonusDamage = 0;
    let defenseOutcome: DamageDefenseOutcome = 'normal';

    for (const effect of listLandingTargetEffects(input)) {
      // Сл спасброска эффекта не посчиталась: его не бросали, и «провалом»
      // это не считается — эффект не ложится и не бьёт, а человек видит почему
      const unresolvedDc = findUnresolvedApplySaveDc(effect, spellSaveDC);

      if (unresolvedDc) {
        warnUnresolvedSaveDc(
          spell.name,
          unresolvedDc,
          UNRESOLVED_SAVE_DC_LABELS.effectSkippedSuffix,
        );

        continue;
      }

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
          input.damageDealt === true,
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
            castLevel: resolveSpellCastLevel(casterId, spell),
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
