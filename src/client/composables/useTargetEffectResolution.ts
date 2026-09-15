import type { DamagePart, SceneEntity } from '@vtt/shared';
import type {
  ActiveEffect,
  DamageDefenseOutcome,
  SavingThrowResult,
  Spell,
} from '@vtt/shared/system/dnd.js';

import { useDiceRollerStore } from '@/stores/diceRollerStore';
import {
  applyMultiTypeDamageDefenses,
  damageReachesTarget,
  expandDamageParts,
  getEntityConditionImmunities,
  hasLastingEffectPayload,
  isDndSceneEntity,
  isImmuneToCondition,
  resolveActorStats,
  resolveEffectApplication,
  resolveEffectSaveDc,
  stampSourceTurnSaveDc,
} from '@vtt/shared/system/dnd.js';

import {
  getPartKindLabel,
  getTargetSpellEffects,
  stampEffectTurnDuration,
} from './spellResolutionShared';
import { useSpellSavingThrows } from './useSpellSavingThrows';

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
   * Бросает урон эффекта (с множителем спаса) и применяет защиты цели по типу.
   * Поддерживает плоские формулы; @-формулы пропускаются с warn (у эффектов
   * существ/оружия формулы плоские, контекста заклинания тут нет).
   *
   * @param entity - цель
   * @param parts - части урона эффекта
   * @param multiplier - множитель урона (1 / 0.5 по результату спасброска)
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

    const stats = resolveActorStats(entity);

    let total = 0;
    let outcome: DamageDefenseOutcome = 'normal';

    const lines: EffectDamageLine[] = [];

    // Разворачиваем инлайн-токены `@dmg.<type>`/`@target.*` в типизированные
    // сегменты тем же ядром, что и базовый урон: редактор пишет тип урона
    // токеном (напр. `2к6@dmg.poison`), а не в поле `type`. У урона эффекта нет
    // контекста `@mod`/`@prof`/`@level` — нерезолвенные сегменты пропускаем.
    const segments = expandDamageParts(parts, undefined, (formula) => formula);

    for (const segment of segments) {
      // Урон эффекта не лечит (редактор скрывает @heal) — на всякий случай.
      if (segment.isHealing) {
        continue;
      }

      // Ветка условного слагаемого (`@target.full`, `@target.type.undead`) —
      // только «своей» цели: без сверки катались бы обе ветки сразу
      if (!damageReachesTarget(segment, entity)) {
        continue;
      }

      if (segment.formula.includes('@')) {
        console.warn(
          '[EffectDamage] @-формула не поддержана:',
          segment.formula,
        );

        continue;
      }

      const rolled = diceRollerStore.parseAndRoll(segment.formula);
      const values = rolled.dice.flatMap((group) => group.values);

      const types = segment.types ?? (segment.type ? [segment.type] : []);

      let damage = Math.floor(rolled.total * multiplier);
      let partOutcome: DamageDefenseOutcome = 'normal';

      if (types.length > 0) {
        const defense = applyMultiTypeDamageDefenses(
          damage,
          types,
          stats.damageDefenses,
        );

        damage = defense.finalDamage;
        partOutcome = defense.outcome;

        if (defense.outcome !== 'normal') {
          outcome = defense.outcome;
        }
      }

      total += damage;

      lines.push({
        typeLabel: getPartKindLabel({
          isHealing: false,
          type: segment.type,
          types: segment.types,
        }),
        formula: segment.formula,
        values,
        applied: damage,
        outcome: partOutcome,
      });
    }

    return { damage: total, outcome, lines };
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

    const effects: ActiveEffect[] = [];
    const damageLines: EffectDamageLine[] = [];

    let bonusDamage = 0;
    let defenseOutcome: DamageDefenseOutcome = 'normal';

    for (const effect of getTargetSpellEffects(spell)) {
      const application = resolveEffectApplication(effect, {
        landed,
        applySaveSucceeded: effectSaves.get(effect.id)?.passed,
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
        // Точная turn-длительность инициализируется тут же (носитель = цель,
        // источник = кастер): нужен текущий ход энкаунтера на момент наложения.
        // Наложивший запоминается всегда: по нему условие «цель помечена
        // мной» узнаёт свою метку
        effects.push(
          stampEffectTurnDuration(
            {
              ...stampSourceTurnSaveDc(effect, spellSaveDC),
              sourceActorId: casterId ?? effect.sourceActorId,
            },
            entity.id,
            casterId,
          ),
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
