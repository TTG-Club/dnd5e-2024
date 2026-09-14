import type { Scene, SceneEntity } from '@vtt/shared';
import type {
  ActiveEffect,
  DamageDefenseOutcome,
  DnDSceneEntity,
  SavingThrowResult,
  Spell,
} from '@vtt/shared/system/dnd.js';

import type {
  RolledSpellDamagePart,
  SpellResolutionContext,
  SpellTargetResult,
} from './spellResolutionShared';
import type {
  EffectDamageLine,
  TargetEffectsResult,
} from './useTargetEffectResolution';

import { emitEntityCombatState } from '@/core/entityUtils';
import { useModalManager } from '@/shared_ui/composables/useModalManager';
import { useChatStore } from '@/stores/chatStore';
import { useTargetStore } from '@/stores/targetStore';
import { generateId, resolveGridCellSize } from '@vtt/shared';
import {
  applyHpChange,
  applyMultiTypeDamageDefenses,
  findTokensInTemplate,
  formatDamageDefenseSuffix,
  getSpellSaveCondition,
  isDndSceneEntity,
  mergeAppliedEffects,
  resolveActorStats,
  resolveEntityCurrentHp,
  resolveEntityMaxHp,
  resolveEntityTempHp,
  withInitializedDuration,
  writeEntityHitPoints,
} from '@vtt/shared/system/dnd.js';

import { SPELL_NO_TARGETS_LABELS } from '../ui/actor/constants';
import {
  formatSaveCancelledMessage,
  formatTargetGateSuffix,
  getPartKindLabel,
  isSaveAbility,
  partPassesTargetGate,
} from './spellResolutionShared';
import { useSpellSavingThrows } from './useSpellSavingThrows';
import { useTargetEffectResolution } from './useTargetEffectResolution';

/**
 * Композабл для многочастного разрешения урона/лечения заклинания.
 */
export function useSpellDamageWithParts() {
  const chatStore = useChatStore();
  const targetStore = useTargetStore();
  const { openModal } = useModalManager();

  const { resolveSavingThrowsForTargets } = useSpellSavingThrows();
  const { resolveTargetEffects } = useTargetEffectResolution();

  /**
   * Записывает чистое изменение HP сущности ОДНИМ апдейтом.
   *
   * Используется многочастным путём: части уже сведены (урон с учётом защит,
   * лечение) в суммарные `totalDamage`/`totalHeal`/`totalTempHeal`, поэтому HP
   * пишется один раз — это исключает двойной emit и потерю урона при нескольких
   * частях на одну цель.
   *
   * Урон сначала снимает имеющиеся временные ХП, остаток — текущие (правило
   * 5e). Временные ХП (`totalTempHeal`) не прибавляются к текущим хитам и не
   * суммируются с оставшимися временными — берётся большее (правило 5e).
   *
   * @param entity - сущность
   * @param totalDamage - суммарный урон (после защит/спасброска)
   * @param totalHeal - суммарное лечение
   * @param totalTempHeal - суммарные временные ХП (`@heal.temp`)
   * @param effectsToApply - эффекты для наложения (или undefined)
   * @param socket - сокет
   * @returns HP до/после, полученные временные ХП и имена наложенных эффектов
   */
  function writeEntityHpDelta(
    entity: SceneEntity,
    totalDamage: number,
    totalHeal: number,
    totalTempHeal: number,
    effectsToApply: ActiveEffect[] | undefined,
    socket: SpellResolutionContext['socket'],
  ): {
    hpBefore: number;
    hpAfter: number;
    tempHpGained: number;
    appliedEffects: string[];
  } {
    // Ядро видит entity как Base*; D&D-форму подтверждает гвард. Без данных
    // системы писать в хиты нечего — запись пропускается, а не считается от
    // мусора.
    if (!isDndSceneEntity(entity)) {
      return { hpBefore: 0, hpAfter: 0, tempHpGained: 0, appliedEffects: [] };
    }

    const hpBefore = resolveEntityCurrentHp(entity);
    const maxHp = resolveEntityMaxHp(entity);
    const tempBefore = resolveEntityTempHp(entity);

    // Урон сначала снимает временные ХП (правило 5e), остаток — текущие
    const hpChange = applyHpChange({
      hpBefore,
      maxHp,
      tempBefore,
      damage: totalDamage,
      heal: totalHeal,
    });

    const hpAfter = hpChange.hpAfter;

    // Новые временные ХП не суммируются с оставшимися — берётся большее
    const tempAfter = Math.max(hpChange.tempAfter, totalTempHeal);

    const updatedEntity: DnDSceneEntity = JSON.parse(JSON.stringify(entity));

    writeEntityHitPoints(updatedEntity, {
      current: hpAfter,
      temp: tempAfter,
    });

    const appliedEffects: string[] = [];

    if (effectsToApply && effectsToApply.length > 0) {
      if (!updatedEntity.activeEffects) {
        updatedEntity.activeEffects = [];
      }

      // Один и тот же статус не стакается: повтор ЗАМЕНЯЕТ прежний (5e 2024,
      // «самый недавний/сильный»); разные эффекты складываются.
      const instantiated = effectsToApply.map((effect): ActiveEffect =>
        withInitializedDuration({
          ...effect,
          id: generateId('effect'),
          origin: 'spell',
        }),
      );

      updatedEntity.activeEffects = mergeAppliedEffects(
        updatedEntity.activeEffects,
        instantiated,
      );

      for (const effect of instantiated) {
        appliedEffects.push(effect.name);
      }
    }

    // Боевым каналом: цель чужая, полную замену сущности сервер не примет.
    emitEntityCombatState(socket, updatedEntity);

    return {
      hpBefore,
      hpAfter,
      tempHpGained: tempAfter - hpChange.tempAfter,
      appliedEffects,
    };
  }

  /**
   * Спрашивает игрока, к какой сущности применить choose-части.
   *
   * Открывает модалку со списком целей на сцене (токены с корректными данными
   * системы) и резолвится выбранной сущностью либо `null` при отмене.
   *
   * @param spell - заклинание (для заголовка)
   * @param chooseParts - брошенные choose-части (для описания «что применяется»)
   * @param scene - текущая сцена (источник списка токенов)
   * @param actors - все сущности мира (акторы + существа)
   * @returns промис с выбранной сущностью или null
   */
  function pickChooseTarget(
    spell: Spell,
    chooseParts: RolledSpellDamagePart[],
    scene: Scene | null,
    actors: SceneEntity[],
  ): Promise<SceneEntity | null> {
    return new Promise((resolve) => {
      // Уникальные сущности, у которых есть токен на сцене
      const seen = new Set<string>();
      const targetOptions: { id: string; name: string }[] = [];

      for (const token of scene?.tokens ?? []) {
        const entity = actors.find((item) => item.id === token.actorId);

        if (entity?.system?.abilities && !seen.has(entity.id)) {
          seen.add(entity.id);
          targetOptions.push({ id: entity.id, name: entity.name });
        }
      }

      const description = chooseParts
        .map(
          (part) =>
            `${getPartKindLabel(part)} ${part.formula}${formatTargetGateSuffix(part.targetGate, part.targetTypeGate)}`,
        )
        .join(', ');

      openModal('SpellChooseTargetModal', {
        allowMultiple: true,
        title: `${spell.name} — выбор цели`,
        description: `Выберите цель для: ${description}`,
        options: targetOptions,
        onConfirm: (entityId: string | null) => {
          resolve(
            entityId
              ? (actors.find((item) => item.id === entityId) ?? null)
              : null,
          );
        },
      });
    });
  }

  /**
   * Многочастное разрешение урона/лечения заклинания.
   *
   * Бросок уже выполнен в модалке (значения в `parts`). Логика:
   * «вычислить все части → применить по сущности ОДНИМ апдейтом».
   * - целевые части (`selected`/`choose`) → целям (AoE-токены или выбранная цель);
   * - `self`-части → заклинателю;
   * - гейт-ветки `@target.full`/`@target.notFull` (`targetGate`) — фильтруются
   *   по фактическому HP каждой цели в момент применения (per-target);
   * - спасбросок — один на цель, берётся ПАЧКОЙ до всякого применения:
   *   цель под чужим владением бросает у себя (запрос владельцу), своя —
   *   окном или автоматически по `autoSaves`; результат влияет на урон-части
   *   цели, а отказ сворачивает всё действие;
   * - защиты по типу — на каждую урон-часть;
   * - `requiresDamage` — лечащая/гейтнутая часть применяется только если по
   *   заклинанию суммарно нанесён урон (>0).
   *
   * Ограничения (отложено): снаряды — для них используется одночастный путь.
   *
   * @param context - контекст (заклинание, DC, сущности, сокет, casterId)
   * @param parts - брошенные части
   * @param options - сцена и кэш шаблона AoE
   * @param options.scene - текущая сцена
   * @param options.cachedTemplate - кэшированный шаблон AoE (если заклинание с областью)
   * @param options.targetEntities - цели, выбранные для этого каста заранее
   *   (выбор целей заклинания-эффекта); важнее шаблона и текущей цели
   */
  async function resolveSpellDamageWithParts(
    context: SpellResolutionContext,
    parts: RolledSpellDamagePart[],
    options: {
      scene: Scene | null;
      cachedTemplate?: import('@vtt/shared').MeasurementTemplate | null;
      targetEntities?: readonly SceneEntity[];
    },
  ): Promise<void> {
    const { spell, spellSaveDC, actors, socket } = context;
    const { scene, cachedTemplate } = options;

    /**
     * Сворачивает действие: спасбросок цели закрыли, не бросив. Ничего не
     * применяется (все спасброски берутся ДО первой записи HP), но в чат уходит
     * явная строка — молчаливое исчезновение действия и было тем багом.
     */
    function sendCancelledMessage(): void {
      chatStore.sendMessage(formatSaveCancelledMessage(spell.name), 'text');
    }

    // 1. Целевые сущности: заранее выбранные цели, AoE-шаблон или одиночная
    // цель из targetStore
    const targetEntities: SceneEntity[] = [];

    if (options.targetEntities) {
      targetEntities.push(
        ...options.targetEntities.filter((entity) => entity.system?.abilities),
      );
    } else if (cachedTemplate && scene) {
      const affectedTokens = findTokensInTemplate(
        cachedTemplate,
        scene.tokens ?? [],
        resolveGridCellSize(scene.gridSettings),
      );

      for (const token of affectedTokens) {
        const entity = actors.find((item) => item.id === token.actorId);

        if (entity?.system?.abilities) {
          targetEntities.push(entity);
        }
      }
    } else {
      const targetEntity = targetStore.getTargetActor();

      if (targetEntity?.system?.abilities) {
        targetEntities.push(targetEntity);
      }
    }

    // 2. Заклинатель (для self-частей)
    const caster = context.casterId
      ? (actors.find((item) => item.id === context.casterId) ?? null)
      : null;

    // Разделяем части по адресату:
    // - self    → заклинателю;
    // - choose  → отдельно выбираемой цели (спрашиваем после броска);
    // - selected→ текущей цели (targetStore) или токенам в AoE-шаблоне.
    const selfParts = parts.filter((part) => part.target === 'self');
    const chooseParts = parts.filter((part) => part.target === 'choose');

    const selectedParts = parts.filter(
      (part) => part.target !== 'self' && part.target !== 'choose',
    );

    // 2a. Цель для choose-частей: спрашиваем игрока (после броска урона).
    // Это покрывает сценарий «нанести урон выбранной цели, затем указать
    // кого лечить». При отмене choose-части просто не применяются.
    let chooseEntity: SceneEntity | null = null;

    if (chooseParts.length > 0) {
      chooseEntity = await pickChooseTarget(spell, chooseParts, scene, actors);
    }

    // Эффекты на цель ложатся и без урона, поэтому спасбросок они требуют
    // наравне с частями — знать об этом надо уже при сборе целей.
    const hasTargetEffects = (spell.activeEffects ?? []).some(
      (effect) => !effect.disabled && effect.effectTarget === 'target',
    );

    /**
     * Цели, которым нужен спасбросок «на приземление»: те, кому реально что-то
     * прилетает — часть урона/лечения или эффект. Считается ЧИСТЫМИ проверками,
     * без бросков: пачку надо знать целиком до первого из них.
     *
     * @returns целевые сущности без повторов
     */
    function collectLandingSaveTargets(): SceneEntity[] {
      const collected = new Map<string, SceneEntity>();

      if (selectedParts.length > 0) {
        for (const entity of targetEntities) {
          if (
            selectedParts.some((part) => partPassesTargetGate(part, entity))
          ) {
            collected.set(entity.id, entity);
          }
        }
      }

      if (hasTargetEffects) {
        for (const entity of targetEntities) {
          collected.set(entity.id, entity);
        }
      }

      const chosen = chooseEntity;

      if (chosen && chooseParts.length > 0) {
        const applicable = chooseParts.filter((part) =>
          partPassesTargetGate(part, chosen),
        );

        // Лечению спасбросок не нужен — спрашиваем только под урон
        if (applicable.some((part) => !part.isHealing)) {
          collected.set(chosen.id, chosen);
        }
      }

      return [...collected.values()];
    }

    // 2b. Спасброски целей берём ОДНОЙ пачкой и ДО всякого применения:
    // запросы чужим владельцам уходят параллельно (пятеро задетых площадью
    // бросают разом, а не в очередь), а отмена любого сворачивает действие,
    // пока ничего ещё не применено.
    const landingSaves = new Map<string, SavingThrowResult>();

    if (isSaveAbility(spell.saveType)) {
      const saveAbility = spell.saveType;
      const againstCondition = getSpellSaveCondition(spell);

      const resolved = await resolveSavingThrowsForTargets(
        collectLandingSaveTargets().map((entity) => ({
          entity,
          ability: saveAbility,
          dc: spellSaveDC,
          againstCondition,
          sourceEntityId: context.casterId,
          sourceName: spell.name,
        })),
      );

      for (const [entityId, save] of resolved) {
        if (save === null) {
          sendCancelledMessage();

          return;
        }

        landingSaves.set(entityId, save);
      }
    }

    interface EntityAccumulator {
      entity: SceneEntity;
      save?: SavingThrowResult;
      damageBase: number;
      damageGated: number;
      healBase: number;
      healGated: number;
      tempHealBase: number;
      tempHealGated: number;
      defenseOutcome: DamageDefenseOutcome;
      isTarget: boolean;
    }

    const accumulators = new Map<string, EntityAccumulator>();

    /** Вклад одной части в одну цель — для группировки чата по типу урона. */
    interface PartContribution {
      entityId: string;
      entityName: string;
      /** Итог части для цели: урон (после спас./защит) или лечение/врем. ХП */
      applied: number;
      /** Сработавшая защита (для суффикса уязв./сопр./иммун.) */
      outcome: DamageDefenseOutcome;
      /** Лечащая/врем. часть с `requiresDamage` — скрыта, пока урон не нанесён */
      requiresGate: boolean;
    }

    // Вклады по частям (ключ — брошенная часть), для разбивки чата по типам
    const partContributions = new Map<
      RolledSpellDamagePart,
      PartContribution[]
    >();

    /** Регистрирует вклад части в цель (для группировки чата по типу урона). */
    function recordContribution(
      part: RolledSpellDamagePart,
      entity: SceneEntity,
      applied: number,
      outcome: DamageDefenseOutcome,
      requiresGate: boolean,
    ): void {
      let list = partContributions.get(part);

      if (!list) {
        list = [];
        partContributions.set(part, list);
      }

      list.push({
        entityId: entity.id,
        entityName: entity.name,
        applied,
        outcome,
        requiresGate,
      });
    }

    function getAccumulator(
      entity: SceneEntity,
      isTarget: boolean,
    ): EntityAccumulator {
      let accumulator = accumulators.get(entity.id);

      if (!accumulator) {
        accumulator = {
          entity,
          damageBase: 0,
          damageGated: 0,
          healBase: 0,
          healGated: 0,
          tempHealBase: 0,
          tempHealGated: 0,
          defenseOutcome: 'normal',
          isTarget,
        };

        accumulators.set(entity.id, accumulator);
      }

      accumulator.isTarget = accumulator.isTarget || isTarget;

      return accumulator;
    }

    /** Считает итоговый урон части с учётом спасброска и защит (без записи). */
    function computeDamageFinal(
      entity: SceneEntity,
      amount: number,
      types: string[] | undefined,
      save: SavingThrowResult | undefined,
    ): { final: number; outcome: DamageDefenseOutcome } {
      let dmg = amount;

      if (save?.passed) {
        if (spell.saveEffect === 'half') {
          dmg = Math.floor(amount / 2);
        } else if (spell.saveEffect === 'none') {
          dmg = 0;
        }
      }

      let outcome: DamageDefenseOutcome = 'normal';

      // Без данных системы защиты цели неизвестны — урон идёт как есть
      if (types && types.length > 0 && isDndSceneEntity(entity)) {
        const stats = resolveActorStats(entity);

        // Несколько типов на одной кости — защиты по наиболее выгодному цели
        const defenseResult = applyMultiTypeDamageDefenses(
          dmg,
          types,
          stats.damageDefenses,
        );

        dmg = defenseResult.finalDamage;
        outcome = defenseResult.outcome;
      }

      return { final: dmg, outcome };
    }

    /** Накапливает часть в аккумулятор сущности. */
    function accumulatePart(
      accumulator: EntityAccumulator,
      part: RolledSpellDamagePart,
      save: SavingThrowResult | undefined,
    ): void {
      const primaryDamageType = part.type ?? context.overrideDamageType;

      // Типы для расчёта защит: несколько (рубящий+огонь) или один
      let damageTypes: string[] | undefined;

      if (part.types && part.types.length > 0) {
        damageTypes = part.types;
      } else if (primaryDamageType) {
        damageTypes = [primaryDamageType];
      }

      if (part.isHealing) {
        // Лечение: `requiresDamage` гейтит его до момента, пока по заклинанию
        // не нанесён урон. Урон-части — НЕ гейтятся (иначе урон-часть с
        // requiresDamage сама себя обнулила бы). Временные ХП (`@heal.temp`)
        // копятся отдельно — они не прибавляются к текущим хитам.
        if (part.healTemp) {
          if (part.requiresDamage) {
            accumulator.tempHealGated += part.amount;
          } else {
            accumulator.tempHealBase += part.amount;
          }
        } else if (part.requiresDamage) {
          accumulator.healGated += part.amount;
        } else {
          accumulator.healBase += part.amount;
        }

        recordContribution(
          part,
          accumulator.entity,
          part.amount,
          'normal',
          part.requiresDamage,
        );

        return;
      }

      const { final, outcome } = computeDamageFinal(
        accumulator.entity,
        part.amount,
        damageTypes,
        save,
      );

      if (outcome !== 'normal') {
        accumulator.defenseOutcome = outcome;
      }

      // Урон применяется всегда (requiresDamage на уроне игнорируется)
      accumulator.damageBase += final;

      recordContribution(part, accumulator.entity, final, outcome, false);
    }

    // 3. selected-части → каждой цели (спасбросок один на цель, уже взят
    // пачкой на шаге 2b). Гейт-ветки @target.full/@target.notFull фильтруются
    // по фактическому HP КАЖДОЙ цели (per-target): цель получает только ветку
    // своего состояния.
    if (selectedParts.length > 0) {
      for (const entity of targetEntities) {
        const applicableParts = selectedParts.filter((part) =>
          partPassesTargetGate(part, entity),
        );

        if (applicableParts.length === 0) {
          continue;
        }

        const accumulator = getAccumulator(entity, true);

        accumulator.save ??= landingSaves.get(entity.id);

        for (const part of applicableParts) {
          accumulatePart(accumulator, part, accumulator.save);
        }
      }
    }

    // 3a. choose-части → отдельно выбранной цели.
    // Спасбросок кидаем только если на эту цель идёт урон (лечение спас не требует).
    if (chooseEntity && chooseParts.length > 0) {
      const applicableChooseParts = chooseParts.filter((part) =>
        partPassesTargetGate(part, chooseEntity),
      );

      if (applicableChooseParts.length > 0) {
        const hasDamagePart = applicableChooseParts.some(
          (part) => !part.isHealing,
        );

        const accumulator = getAccumulator(chooseEntity, hasDamagePart);

        if (hasDamagePart) {
          accumulator.save ??= landingSaves.get(chooseEntity.id);
        }

        for (const part of applicableChooseParts) {
          accumulatePart(accumulator, part, accumulator.save);
        }
      }
    }

    // 4. self-части → заклинателю (без спасброска)
    if (caster && selfParts.length > 0) {
      const applicableSelfParts = selfParts.filter((part) =>
        partPassesTargetGate(part, caster),
      );

      if (applicableSelfParts.length > 0) {
        const accumulator = getAccumulator(caster, false);

        for (const part of applicableSelfParts) {
          accumulatePart(accumulator, part, undefined);
        }
      }
    }

    // 4a. Гарантируем аккумулятор цели даже без частей урона (чистый статус):
    // эффекты с effectTarget 'target' должны примениться и без урона. Для
    // save-landing катаем landing-спас, чтобы эффекты без applySave гейтились им.
    if (hasTargetEffects) {
      for (const entity of targetEntities) {
        const accumulator = getAccumulator(entity, true);

        accumulator.save ??= landingSaves.get(entity.id);
      }
    }

    // 5. Гейт requiresDamage: открыт, если суммарно нанесён негейтнутый урон
    let totalDamageNonGated = 0;

    for (const accumulator of accumulators.values()) {
      totalDamageNonGated += accumulator.damageBase;
    }

    const gateOpen = totalDamageNonGated > 0;

    // 5a. Эффекты целей разбираем ДО первой записи HP: у эффекта бывает свой
    // спасбросок с окном, и его отмена обязана свернуть действие целиком —
    // а уже применённый другим целям урон обратно не отыграть.
    const targetEffectResults = new Map<string, TargetEffectsResult>();

    for (const accumulator of accumulators.values()) {
      if (!accumulator.isTarget) {
        continue;
      }

      const targetResult = await resolveTargetEffects(
        {
          spell,
          entity: accumulator.entity,
          spellSaveDC,
          casterId: context.casterId,
        },
        accumulator.save,
      );

      if (targetResult === null) {
        sendCancelledMessage();

        return;
      }

      targetEffectResults.set(accumulator.entity.id, targetResult);
    }

    // 6. Применяем по сущности ОДНИМ апдейтом
    const results: SpellTargetResult[] = [];

    // Доп.урон наложенных эффектов по цели — для отдельной группы в чате
    const effectDamageByEntity = new Map<string, EffectDamageLine[]>();

    for (const accumulator of accumulators.values()) {
      let totalDamage =
        accumulator.damageBase + (gateOpen ? accumulator.damageGated : 0);

      const totalHeal =
        accumulator.healBase + (gateOpen ? accumulator.healGated : 0);

      const totalTempHeal =
        accumulator.tempHealBase + (gateOpen ? accumulator.tempHealGated : 0);

      let effectsToApply: ActiveEffect[] | undefined;

      const targetResult = targetEffectResults.get(accumulator.entity.id);

      if (targetResult) {
        effectsToApply =
          targetResult.effects.length > 0 ? targetResult.effects : undefined;

        totalDamage += targetResult.bonusDamage;

        if (targetResult.damageLines.length > 0) {
          effectDamageByEntity.set(
            accumulator.entity.id,
            targetResult.damageLines,
          );
        }

        if (targetResult.defenseOutcome !== 'normal') {
          accumulator.defenseOutcome = targetResult.defenseOutcome;
        }
      }

      const { hpBefore, hpAfter, tempHpGained, appliedEffects } =
        writeEntityHpDelta(
          accumulator.entity,
          totalDamage,
          totalHeal,
          totalTempHeal,
          effectsToApply,
          socket,
        );

      results.push({
        actorName: accumulator.entity.name,
        actorId: accumulator.entity.id,
        saveRoll: accumulator.save?.roll,
        saveModifier: accumulator.save?.modifier,
        savePassed: accumulator.save?.passed,
        damageApplied: totalDamage,
        healApplied: totalHeal,
        hpBefore,
        hpAfter,
        tempHpGained,
        defenseOutcome: accumulator.defenseOutcome,
        appliedEffects,
      });
    }

    // 7. Сводка в чат, СГРУППИРОВАННАЯ ПО ТИПУ УРОНА:
    //    строка 1 — чем нанёс (название); далее на каждую часть — заголовок
    //    «тип урона/лечение», под ним строки целей «формула [кубики] = итог».
    //    Тип урона не дублируется у каждой цели; если частей несколько —
    //    сначала первый тип со всеми целями, затем второй и т.д.

    // Наложенные эффекты по цели — показываем один раз (у первой строки цели)
    const effectsByEntity = new Map<string, string[]>();

    for (const result of results) {
      if (result.appliedEffects && result.appliedEffects.length > 0) {
        effectsByEntity.set(result.actorId, result.appliedEffects);
      }
    }

    const messageLines = [spell.name];
    const usedEffectEntities = new Set<string>();

    // Перебираем части В ПОРЯДКЕ заклинания/оружия (пропускаем нулевые —
    // например, не сработавшие условные ветки @target.full/@target.notFull).
    for (const part of parts) {
      if (part.amount <= 0) {
        continue;
      }

      const contributions = partContributions.get(part);
      const header = `${getPartKindLabel(part)}${formatTargetGateSuffix(part.targetGate, part.targetTypeGate)}`;

      const diceBreakdown =
        part.values.length > 0 ? `[${part.values.join(', ')}] = ` : '';

      // Целей нет — но кубики брошены: показываем часть «в пустоту»
      if (!contributions || contributions.length === 0) {
        if (results.length === 0) {
          messageLines.push(header);
          messageLines.push(`→ ${part.formula} ${diceBreakdown}${part.amount}`);
        }

        continue;
      }

      // Гейт requiresDamage: лечащие/врем. части скрыты, пока урон не нанесён
      const visibleContributions = contributions.filter(
        (contribution) => !(contribution.requiresGate && !gateOpen),
      );

      if (visibleContributions.length === 0) {
        continue;
      }

      messageLines.push(header);

      const sign = part.isHealing ? '+' : '-';
      const hpSuffix = part.healTemp ? ' врем. HP' : ' HP';

      for (const contribution of visibleContributions) {
        const defenseSuffix = formatDamageDefenseSuffix(contribution.outcome);

        let line = `→ ${contribution.entityName}: ${part.formula} ${diceBreakdown}${sign}${contribution.applied}${hpSuffix}${defenseSuffix}`;

        const effects = effectsByEntity.get(contribution.entityId);

        if (effects && !usedEffectEntities.has(contribution.entityId)) {
          usedEffectEntities.add(contribution.entityId);
          line += ` [${effects.join(', ')}]`;
        }

        messageLines.push(line);
      }
    }

    // Эффекты целей, которых не назвала ни одна часть (у заклинания-эффекта
    // частей нет вовсе): без этой строки наложенное в чате не видно.
    for (const result of results) {
      const effects = effectsByEntity.get(result.actorId);

      if (effects && !usedEffectEntities.has(result.actorId)) {
        usedEffectEntities.add(result.actorId);
        messageLines.push(`→ ${result.actorName}: [${effects.join(', ')}]`);
      }
    }

    // Доп.урон от наложенных эффектов — отдельной группой (в HP уже учтён выше).
    for (const result of results) {
      const damageLines = effectDamageByEntity.get(result.actorId);

      if (!damageLines || damageLines.length === 0) {
        continue;
      }

      for (const damageLine of damageLines) {
        const breakdown =
          damageLine.values.length > 0
            ? `[${damageLine.values.join(', ')}] = `
            : '';

        messageLines.push(`${damageLine.typeLabel} (эффект)`);

        messageLines.push(
          `→ ${result.actorName}: ${damageLine.formula} ${breakdown}-${damageLine.applied} HP${formatDamageDefenseSuffix(damageLine.outcome)}`,
        );
      }
    }

    // Заклинание никого не задело. Причину называем явно: без неё строка
    // читается как поломка, хотя чаще это промах шаблоном мимо всех.
    if (results.length === 0) {
      messageLines.push(
        `→ ${
          cachedTemplate
            ? SPELL_NO_TARGETS_LABELS.emptyArea
            : SPELL_NO_TARGETS_LABELS.noTarget
        }`,
      );
    }

    chatStore.sendMessage(messageLines.join('\n'), 'text');
  }

  return {
    resolveSpellDamageWithParts,
    writeEntityHpDelta,
    pickChooseTarget,
  };
}
