import type { MeasurementTemplate } from '@vtt/shared';
import type { DnDSceneEntity, Spell } from '@vtt/shared/system/dnd.js';

import type { SpellEffectTargetProblem } from '../ui/actor/constants';

import { useModalManager } from '@/shared_ui/composables/useModalManager';
import { useChatStore } from '@/stores/chatStore';
import { useProjectileStore } from '@/stores/projectileStore';
import { useTargetStore } from '@/stores/targetStore';
import { useWorldStore } from '@/stores/worldStore';
import { generateId, isEntityOwner, isRecord } from '@vtt/shared';
import {
  applyEffectsToEntity,
  getSpellAttackType,
  getSpellEffectTargetCount,
  hasAvailableSpellSlot,
  isDndSceneEntity,
  isSpellReady,
  pickEffectVariants,
  readEffectVariantChoices,
  resolveActorStats,
  spellHasDamage,
  targetEffectsNeedResolution,
} from '@vtt/shared/system/dnd.js';

import {
  PROJECTILE_PROMPT_MODAL,
  SPELL_EFFECT_TARGET_LABELS,
  SPELL_EFFECT_TARGET_MODE,
  SPELL_TARGETS_MODAL_KEY_PREFIX,
} from '../ui/actor/constants';
import { changeEntityCombatState } from './entityCombatWrite';
import { resolveSpellCastId, resolveSpellCastLevel } from './spellCasts';
import {
  getTargetSpellEffects,
  postSpellEffectsMessage,
  stampEffectOnApply,
} from './spellResolutionShared';
import { bindTargetEffectsToCaster } from './targetEffectSourceBinding';
import { isSpellTargetBlockedByRange } from './useSceneRangeCheck';
import { useSpellDamageWithParts } from './useSpellDamageWithParts';
import { useSpellResolution } from './useSpellResolution';
import { useWorldEntities } from './useWorldEntities';

/**
 * Снимок механики выбора и применения без изменяемых остатков зарядов: по нему
 * видно, что запись заклинания заменили или изменили после выбора целей.
 *
 * @param spell - заклинание
 * @returns строка для сравнения записей
 */
function serializeEffectCastDefinition(spell: Spell): string {
  return JSON.stringify({
    level: spell.level,
    range: spell.range,
    rangeUnit: spell.rangeUnit,
    rangeSpecial: spell.rangeSpecial,
    targetType: spell.targetType,
    targetCount: spell.targetCount,
    areaOfEffect: spell.areaOfEffect,
    projectiles: spell.projectiles,
    deliveryType: spell.deliveryType,
    damageParts: spell.damageParts,
    autoHit: spell.autoHit,
    saveType: spell.saveType,
    saveEffect: spell.saveEffect,
    scaling: spell.scaling,
    cantripScalingTiers: spell.cantripScalingTiers,
    activeEffects: spell.activeEffects,
    uses: spell.uses
      ? { max: spell.uses.max, recovery: spell.uses.recovery }
      : undefined,
  });
}

/** Выбранные цели каста; проверяются повторно перед расходом ресурсов. */
export interface SpellEffectTargets {
  validate: (
    castLevel?: number,
    consumeSlot?: boolean,
    isPactSlot?: boolean,
  ) => boolean;
  /** Накладывает эффекты выбранным целям напрямую */
  apply: () => void;
  /**
   * Забирает выбранные цели для разбора оркестратором: проверяет выбор и
   * помечает каст применённым.
   *
   * @returns сущности целей либо `null`, если выбор уже не действует
   */
  claimEntities: () => DnDSceneEntity[] | null;
}

/**
 * Накладывает эффекты «на цель» каждой сущности боевым каналом ядра и пишет
 * в чат, кому что легло.
 *
 * @param spell - заклинание или псевдо-заклинание применения
 * @param casterId - кто накладывает
 * @param entities - получатели
 */
function applyTargetEffectsToEntities(
  spell: Spell,
  casterId: string,
  entities: readonly DnDSceneEntity[],
): void {
  if (!useChatStore().getSocket()) {
    return;
  }

  const effects = bindTargetEffectsToCaster(
    getTargetSpellEffects(spell),
    spell,
    casterId,
  );

  const names: string[] = [];

  for (const entity of entities) {
    const targetEffects = effects.map((effect) =>
      stampEffectOnApply(effect, {
        carrierId: entity.id,
        sourceId: casterId,
        castId: resolveSpellCastId(casterId, spell),
        castLevel: resolveSpellCastLevel(casterId, spell),
      }),
    );

    // Цель перечитывается в момент записи, а снимок несёт разницу: эффекты
    // прежнего каста, снятые сервером после выбора целей, не возвращаются
    changeEntityCombatState(entity.id, (current) => ({
      ...current,
      activeEffects: applyEffectsToEntity(current, targetEffects, 'spell'),
    }));

    names.push(entity.name);
  }

  postSpellEffectsMessage(spell.name, names, effects);
}

/**
 * Цели, уже выбранные человеком (плашкой «На кого применить»): забираются
 * один раз и берутся из мира в момент наложения — хиты могли измениться, пока
 * открыта плашка или ведущий решал, разрешить ли.
 *
 * @param spell - псевдо-заклинание применения
 * @param casterId - кто накладывает
 * @param entityIds - выбранные сущности
 * @returns цели для `applySpellTargetEffects`
 */
export function createChosenEffectTargets(
  spell: Spell,
  casterId: string,
  entityIds: readonly string[],
): SpellEffectTargets {
  let applied = false;

  /** Выбор действует, пока его не забрали */
  function validate(): boolean {
    return !applied && !!useChatStore().getSocket();
  }

  /**
   * Забирает выбранных: повторно те же цели не отдаются.
   *
   * @returns актуальные сущности либо `null`, если выбор уже забран
   */
  function claimEntities(): DnDSceneEntity[] | null {
    if (!validate()) {
      return null;
    }

    applied = true;

    const { findCurrentDndEntity } = useWorldEntities();

    return entityIds
      .map((entityId) => findCurrentDndEntity(entityId))
      .filter((entity): entity is DnDSceneEntity => entity !== undefined);
  }

  /** Накладывает эффекты выбранным напрямую */
  function apply(): void {
    const entities = claimEntities();

    if (entities) {
      applyTargetEffectsToEntities(spell, casterId, entities);
    }
  }

  return { validate, apply, claimEntities };
}

/** Кто накладывает эффекты на цель — для спасбросков и Сл 0 эффектов */
export interface SpellTargetEffectsSource {
  /** Идентификатор заклинателя */
  casterId: string;
  /** Сл спасброска заклинателя — ею заменяется Сл 0 эффекта */
  spellSaveDC: number;
}

/**
 * Определяет безуронный эффект на выбранных существ без атаки и спасброска.
 *
 * @param spell - заклинание
 * @returns true — перед кастом нужно выбрать цели эффекта
 */
export function needsSpellEffectTargets(spell: Spell): boolean {
  return (
    !spell.areaOfEffect
    && !spell.projectiles
    && !spellHasDamage(spell)
    && !getSpellAttackType(spell)
    && spell.saveType === 'none'
    && getTargetSpellEffects(spell).length > 0
  );
}

/**
 * Фиксирует сессию снарядов, чтобы отложенный бросок не использовал цели следующего каста.
 *
 * @param hasProjectiles - каст идёт снарядами
 * @returns проверка «выбор целей этого каста ещё действует»
 */
export function createProjectileCastValidator(
  hasProjectiles: boolean,
): () => boolean {
  const projectileStore = useProjectileStore();
  const targetingSessionId = projectileStore.sessionId;

  return () =>
    !hasProjectiles
    || (projectileStore.isActive
      && projectileStore.sessionId === targetingSessionId);
}

/**
 * Открывает выбор разных целей через нейтральный механизм распределения ядра.
 * Цели фиксируются для этого каста и не зависят от обычной цели атаки.
 *
 * @param spell - заклинание-эффект
 * @param casterId - идентификатор заклинателя
 * @param availableSpellLevels - круги, доступные для каста
 * @param onConfirm - продолжение каста с выбранным кругом и зафиксированными целями
 */
export function requestSpellEffectTargets(
  spell: Spell,
  casterId: string,
  availableSpellLevels: number[],
  onConfirm: (slotLevel: number, targets: SpellEffectTargets) => void,
): void {
  const worldStore = useWorldStore();
  const { findCurrentWorldEntity } = useWorldEntities();
  const projectileStore = useProjectileStore();
  const chatStore = useChatStore();
  const worldId = worldStore.currentWorld?.id;
  const sceneId = worldStore.currentScene?.id;
  const userId = worldStore.currentUser?.id;
  const spellDefinition = serializeEffectCastDefinition(spell);

  // Каст приходит уже суженным до выбранных вариантов («Наставление:
  // Акробатика»), а на листе лежит полная запись — сверять её надо суженной
  // тем же выбором, иначе каст отклонялся бы всегда
  const variantChoices = readEffectVariantChoices(spell.activeEffects ?? []);

  /** Читает актуальную сущность, включая существа и изменения других игроков. */
  function findEntity(entityId: string): DnDSceneEntity | undefined {
    const entity = findCurrentWorldEntity(entityId);

    return entity && isDndSceneEntity(entity) ? entity : undefined;
  }

  /** Проверяет, что кастер всё ещё доступен в том же мире и на той же сцене. */
  function hasCastContext(): boolean {
    return (
      !!worldId
      && !!sceneId
      && !!userId
      && worldStore.currentWorld?.id === worldId
      && worldStore.currentScene?.id === sceneId
      && worldStore.currentUser?.id === userId
      && worldStore.canPerformActions
      && !!chatStore.getSocket()
      && !!worldStore.currentScene?.tokens?.some(
        (token) => token.actorId === casterId,
      )
      && (worldStore.isGM || isEntityOwner(findEntity(casterId), userId))
    );
  }

  /** Проверяет существование, явную видимость и дистанцию выбранного токена. */
  function canTargetToken(tokenId: string): boolean {
    const token = worldStore.currentScene?.tokens?.find(
      (entry) => entry.id === tokenId,
    );

    return (
      hasCastContext()
      && !!token
      && (worldStore.isGM || !token.hidden)
      && !!findEntity(token.actorId)
      && !isSpellTargetBlockedByRange(spell, casterId, tokenId)
    );
  }

  /** Одна сущность занимает одну цель, даже если представлена несколькими токенами. */
  function canAssignToken(tokenId: string): boolean {
    if (!canTargetToken(tokenId)) {
      return false;
    }

    const tokens = worldStore.currentScene?.tokens ?? [];
    const candidate = tokens.find((token) => token.id === tokenId);

    return !tokens.some(
      (token) =>
        token.id !== tokenId
        && token.actorId === candidate?.actorId
        && projectileStore.assignedTargets.has(token.id),
    );
  }

  if (!hasCastContext()) {
    chatStore.sendMessage(SPELL_EFFECT_TARGET_LABELS.unavailable, 'text');

    return;
  }

  projectileStore.startTargeting(
    'distinct',
    getSpellEffectTargetCount(spell, availableSpellLevels[0] ?? spell.level),
    canAssignToken,
  );

  const targetingSessionId = projectileStore.sessionId;

  /** Фиксирует цели, освобождает режим карты и передаёт каст следующему шагу. */
  function confirmTargets(slotLevel: number): boolean {
    if (
      !projectileStore.isActive
      || projectileStore.sessionId !== targetingSessionId
    ) {
      return false;
    }

    const chosenTargets = [...projectileStore.assignedTargets.keys()].map(
      (tokenId) => ({
        tokenId,
        entityId: worldStore.currentScene?.tokens?.find(
          (token) => token.id === tokenId,
        )?.actorId,
      }),
    );

    let applied = false;

    /**
     * Проверяет актуальное заклинание и остаток выбранного вида ячеек.
     *
     * @returns чего не хватает; `null` — каст оплатить есть чем
     */
    function findResourceProblem(
      castLevel: number,
      consumeSlot: boolean,
      isPactSlot: boolean,
    ): SpellEffectTargetProblem | null {
      const caster = findEntity(casterId);

      if (!caster || caster.entityType !== 'actor') {
        return 'changed';
      }

      const currentSpell = caster.spells?.find(
        (entry) => entry.id === spell.id,
      );

      if (!currentSpell) {
        return 'spellChanged';
      }

      // Лист старого мира, чьи заговоры ещё не разобраны, держит их доступными
      const cantripsTracked =
        isRecord(caster.system) && caster.system.cantripsTracked === true;

      if (!isSpellReady(currentSpell, cantripsTracked)) {
        return 'notPrepared';
      }

      if (currentSpell.uses) {
        return currentSpell.uses.recovery === 'atWill'
          || currentSpell.uses.current > 0
          ? null
          : 'noUses';
      }

      if (!consumeSlot || castLevel === 0) {
        return null;
      }

      // Свои бонусы к ячейкам считаются от итоговых статов — как на вкладке
      // заклинаний, иначе вкладка и проверка каста разошлись бы в числе ячеек
      return hasAvailableSpellSlot(
        caster,
        castLevel,
        isPactSlot,
        resolveActorStats(caster).abilityBonusContext,
      )
        ? null
        : 'noSlot';
    }

    /** Отменяет старый каст, если запись заклинания заменили или изменили. */
    function hasCurrentSpellDefinition(): boolean {
      const caster = findEntity(casterId);

      if (!caster || caster.entityType !== 'actor') {
        return false;
      }

      const currentSpell = caster.spells?.find(
        (entry) => entry.id === spell.id,
      );

      return (
        !!currentSpell
        && serializeEffectCastDefinition({
          ...currentSpell,
          activeEffects: pickEffectVariants(
            currentSpell.activeEffects ?? [],
            variantChoices,
          ),
        }) === spellDefinition
      );
    }

    /** Выбранные цели на месте, свои и по-прежнему доступны заклинанию. */
    function hasCurrentTargets(): boolean {
      return (
        chosenTargets.length > 0
        && chosenTargets.length <= getSpellEffectTargetCount(spell, slotLevel)
        && chosenTargets.every(
          (chosen) =>
            canTargetToken(chosen.tokenId)
            && worldStore.currentScene?.tokens?.some(
              (token) =>
                token.id === chosen.tokenId
                && token.actorId === chosen.entityId,
            ),
        )
      );
    }

    /**
     * Почему каст с выбранными целями больше не действителен. Причина названа
     * своя: неподготовленное заклинание раньше отказывало фразой про цели, и
     * игрок выбирал их заново без толку.
     *
     * @returns причина отказа; `null` — каст в силе
     */
    function findProblem(
      castLevel: number | undefined,
      consumeSlot: boolean,
      isPactSlot: boolean,
    ): SpellEffectTargetProblem | null {
      if (applied || !hasCastContext()) {
        return 'changed';
      }

      if (!hasCurrentSpellDefinition()) {
        return 'spellChanged';
      }

      if (castLevel !== undefined && castLevel !== slotLevel) {
        return 'changed';
      }

      const resourceProblem =
        castLevel === undefined
          ? null
          : findResourceProblem(castLevel, consumeSlot, isPactSlot);

      if (resourceProblem) {
        return resourceProblem;
      }

      return hasCurrentTargets() ? null : 'changed';
    }

    /** Не позволяет потратить ячейку на удалённую, подменённую или недоступную цель. */
    function validate(
      castLevel?: number,
      consumeSlot = false,
      isPactSlot = false,
    ): boolean {
      const problem = findProblem(castLevel, consumeSlot, isPactSlot);

      if (problem) {
        chatStore.sendMessage(SPELL_EFFECT_TARGET_LABELS[problem], 'text');
      }

      return problem === null;
    }

    /**
     * Забирает выбранные цели: выбор ещё действует — каст помечается
     * применённым, и повторно те же цели не отдаются.
     *
     * @returns сущности целей либо `null`
     */
    function claimEntities(): DnDSceneEntity[] | null {
      if (!chatStore.getSocket() || !validate()) {
        return null;
      }

      applied = true;

      return chosenTargets
        .map((chosen) =>
          chosen.entityId ? findEntity(chosen.entityId) : undefined,
        )
        .filter((entity): entity is DnDSceneEntity => entity !== undefined);
    }

    /** Накладывает эффект каждой выбранной сущности боевым каналом ядра. */
    function apply(): void {
      const entities = claimEntities();

      if (entities) {
        applyTargetEffectsToEntities(spell, casterId, entities);
      }
    }

    if (!validate(slotLevel)) {
      return false;
    }

    projectileStore.stopTargeting();
    onConfirm(slotLevel, { validate, apply, claimEntities });

    return true;
  }

  useModalManager().openModal(PROJECTILE_PROMPT_MODAL, {
    _modalKey: generateId(SPELL_TARGETS_MODAL_KEY_PREFIX),
    targetingSessionId,
    spell,
    casterLevel: 0,
    availableSpellLevels,
    targetMode: SPELL_EFFECT_TARGET_MODE,
    onConfirm: confirmTargets,
  });
}

/**
 * Разбирает эффекты на цель тем же оркестратором, что и уронные заклинания:
 * свой спасбросок эффекта (окном или запросом владельцу), урон эффекта, Сл 0
 * повторного спасброска. Частей урона нет — оркестратор разбирает только
 * эффекты.
 *
 * @param spell - заклинание
 * @param source - заклинатель и его Сл спасброска
 * @param effectTargets - цели, зафиксированные при выборе; без них — выбранная цель
 */
function resolveSpellTargetEffects(
  spell: Spell,
  source: SpellTargetEffectsSource,
  effectTargets?: SpellEffectTargets,
): void {
  const targetEntities = effectTargets
    ? effectTargets.claimEntities()
    : undefined;

  const socket = useChatStore().getSocket();

  if (targetEntities === null || !socket) {
    return;
  }

  const { resolveSpellDamageWithParts } = useSpellDamageWithParts();

  void resolveSpellDamageWithParts(
    {
      spell,
      damageTotal: 0,
      spellSaveDC: source.spellSaveDC,
      actors: useWorldEntities().getCurrentWorldEntities(),
      socket,
      casterId: source.casterId,
    },
    [],
    {
      scene: useWorldStore().currentScene,
      cachedTemplate: null,
      targetEntities,
    },
  );
}

/**
 * Накладывает эффекты заклинания, предназначенные цели. Цели, выбранные для
 * этого каста, получают их сами; без них эффекты ложатся на выбранную цель
 * через общий `targetStore.applyEffectsToTarget`. Для безуронных заклинаний
 * строка в чате — единственный отклик, поэтому она пишется всегда.
 *
 * Эффекты со своим спасброском, уроном или Сл 0 повторного спасброска напрямую
 * не накладываются — их разбирает оркестратор (`resolveSpellTargetEffects`).
 *
 * @param spell - заклинание
 * @param source - заклинатель и его Сл спасброска
 * @param effectTargets - цели, зафиксированные при выборе; без них — выбранная цель
 */
export function applySpellTargetEffects(
  spell: Spell,
  source: SpellTargetEffectsSource,
  effectTargets?: SpellEffectTargets,
): void {
  if (targetEffectsNeedResolution(spell)) {
    resolveSpellTargetEffects(spell, source, effectTargets);

    return;
  }

  if (effectTargets) {
    effectTargets.apply();

    return;
  }

  const targetEffects = bindTargetEffectsToCaster(
    getTargetSpellEffects(spell),
    spell,
    source.casterId,
  );

  const targetStore = useTargetStore();
  const target = targetStore.getTargetActor();

  if (targetEffects.length === 0 || !target) {
    return;
  }

  const targetName = targetStore.applyEffectsToTarget(
    targetEffects.map((effect) =>
      stampEffectOnApply(effect, {
        carrierId: target.id,
        sourceId: source.casterId,
        castId: resolveSpellCastId(source.casterId, spell),
        castLevel: resolveSpellCastLevel(source.casterId, spell),
      }),
    ),
    'spell',
  );

  if (targetName) {
    postSpellEffectsMessage(spell.name, [targetName], targetEffects);
  }
}

/**
 * Разбирает цели каста без окна броска (`flow: 'effectsOnly'` плана каста):
 * спасбросок заклинания без урона («Удержание личности») бросает цель — через
 * тот же оркестратор, что и у уронных заклинаний, с нулём урона; без
 * спасброска эффекты на цель ложатся `applySpellTargetEffects`. Один путь на
 * лист и горячую панель: раньше панель катила такому касту d20 и отдавала
 * итог в разбор как урон, а лист у врождённого заклинания спасбросок не
 * спрашивал вовсе.
 *
 * @param spell - заклинание каста
 * @param source - заклинатель и его Сл спасброска
 * @param options - цели и шаблон каста
 * @param options.effectTargets - цели, зафиксированные при выборе
 * @param options.template - шаблон области: цели спасброска — в нём
 */
export function settleNoRollSpellTargets(
  spell: Spell,
  source: SpellTargetEffectsSource,
  options: {
    effectTargets?: SpellEffectTargets;
    template?: MeasurementTemplate | null;
  } = {},
): void {
  if (spell.saveType === 'none') {
    applySpellTargetEffects(spell, source, options.effectTargets);

    return;
  }

  const socket = useChatStore().getSocket();
  const actors = useWorldEntities().getCurrentWorldEntities();

  if (getTargetSpellEffects(spell).length === 0 || !socket || !actors.length) {
    return;
  }

  useSpellResolution().resolveSpellDamage(
    {
      spell,
      damageTotal: 0,
      spellSaveDC: source.spellSaveDC,
      actors,
      socket,
      casterId: source.casterId,
    },
    {
      hasProjectiles: false,
      resolvedDamageFormula: '',
      scene: useWorldStore().currentScene,
      cachedTemplate: options.template ?? null,
    },
  );
}
