import type {
  MacroExecutionContext,
  MacroSlotState,
} from '@/core/registries/macroRegistry';
import type {
  HotbarMacro,
  MeasurementTemplate,
  SceneEntity,
} from '@vtt/shared';
import type {
  ActiveEffect,
  CreatureAction,
  CreatureSpellPlacement,
  DnDActor,
  DnDCreature,
  DnDGameItem,
  DnDSceneEntity,
  Spell,
} from '@vtt/shared/system/dnd.js';

import type { CreatureDamageVariant } from '../composables/creatureDamageChoice';
import type { SpellCasterSource } from '../composables/spellCastCompletion';
import type { SpellCasterPort } from '../composables/spellCastFlow';
import type { CreatureRollSetup } from '../composables/useBonusDamageParts';
import type { RolledSpellDamagePart } from '../composables/useSpellResolution';

import { registerMacro } from '@/core/registries/macroRegistry';
import { useModalManager } from '@/shared_ui/composables/useModalManager';
import { useChatStore } from '@/stores/chatStore';
import { useSpellTemplateStore } from '@/stores/spellTemplateStore';
import { useTargetStore } from '@/stores/targetStore';
import { useWorldStore } from '@/stores/worldStore';
/**
 * Регистрация макро-executor'ов, специфичных для D&D 5e.
 * Вся боевая логика (бросок атаки, двухэтапная атака, криты, урон) вынесена
 * в attackUtils.ts, а здесь остаётся только оркестрация и контекст выполнения макроса.
 */
import { generateId } from '@vtt/shared';
import {
  buildResolvedFormulaContext,
  calculateCreatureSpellBlockNumbers,
  calculateWeaponAttackModifier,
  canSwitchOnEffect,
  checkRange,
  collectActiveEffects,
  collectEffectToggleGroup,
  consumeCreatureSpellGroupUse,
  creatureActionHasSave,
  describeItemUseAvailability,
  describeWeaponAttackAvailability,
  evaluateConditionalBonuses,
  findCreatureActionBlock,
  findCreatureActionSection,
  findCreatureSpellPlacement,
  getAttackBonusKey,
  getAttackFlagCategory,
  getCreatureSpellBlockAbility,
  getCreatureSpellMod,
  getCreatureSpellRollButtonText,
  getDamageBonusKey,
  getDamagePartsPrimaryType,
  getDamageTemplateColor,
  getSpellAttackType,
  getWeaponPrimaryDamageType,
  hasCreatureSpellUsesLeft,
  isCreatureAttackAction,
  isCreatureSpellPoolMode,
  isSaveAbility,
  isTargetAtFullHp,
  isUseActivatedEffect,
  resolveActorStats,
  resolveCreatureSectionCost,
  resolveCreatureSpellSaveDC,
  resolveEntityActionBlocks,
  resolveSpellAreaAtLevel,
  resolveSpellCastBlock,
  resolveSpellCastCost,
  resolveWeaponSaveDc,
  retypeCasterSpellDamage,
  spellIsHealing,
  stripDescriptionRollMarkers,
  withSpentSpellSlot,
  withSpentSpellUse,
} from '@vtt/shared/system/dnd.js';

import {
  recordEntityActionSpend,
  runWithWeaponAttackCost,
  warnOpportunityAttack,
} from '../composables/actionSpend';
import {
  runCreatureActionChoices,
  runWeaponAttackChoices,
} from '../composables/attackKindChoice';
import {
  resolveTargetedAttackRoll,
  resolveTargetedCritThreshold,
} from '../composables/attackRollMode';
import { runWithCastFailure } from '../composables/castFailure';
import {
  buildCreatureRollVariants,
  launchCreatureAction,
  runDamagelessCreatureAction,
  runWithCreatureDamageChoice,
} from '../composables/creatureDamageChoice';
import {
  requestDamageTypeChoiceFor,
  runWithDamageTypeChoices,
} from '../composables/damageTypeChoice';
import {
  applyActionSelfEffects,
  applyActionUseEffects,
  applyEntityEffectUse,
  applyEntityItemUse,
  prepareAmmunitionShot,
  spendShotAmmunition,
} from '../composables/effectActivationUse';
import {
  readEntityCounters,
  toggleEntityEffect,
} from '../composables/effectToggle';
import { runWithEffectVariants } from '../composables/effectVariantChoice';
import { isEntityOwnTurn } from '../composables/encounterTurn';
import { changeEntitySheet } from '../composables/entitySheetWrite';
import { buildRollBonusEvaluator } from '../composables/rollBonusEvaluator';
import {
  afterSpellCast,
  completeSpellCast,
  SPELL_CAST_KEY_PREFIX,
} from '../composables/spellCastCompletion';
import { startSpellCast } from '../composables/spellCastFlow';
import { beginSpellCast } from '../composables/spellCasts';
import {
  castReachesTargets,
  discardSpellTemplate,
} from '../composables/spellResolutionShared';
import { useBonusDamageParts } from '../composables/useBonusDamageParts';
import {
  collectEffectsWithAuras,
  listAmbientEffects,
} from '../composables/useResolvedStats';
import { measureTokenDistanceOnScene } from '../composables/useSceneRangeCheck';
import { useSpellResolution } from '../composables/useSpellResolution';
import { useWorldEntities } from '../composables/useWorldEntities';
import {
  ACTOR_SPELLS_TAB_LABELS,
  SPELL_DAMAGE_ROLL_BUTTON,
} from '../ui/actor/constants';
import { checkCreatureActionRangeOnScene } from '../ui/creature/composables/useCreatureRangeCheck';
import { CREATURE_ACTIONS_BLOCK_LABELS } from '../ui/creature/constants';
import {
  DND_MACRO_TYPES,
  EFFECT_USE_SLOT_LABELS,
  FEATURE_TOGGLE_SLOT_LABELS,
  MACRO_MESSAGE_LABELS,
} from './constants';
import { toHotbarSlotState } from './hotbarSlotState';

/**
 * Граница системы: ядро отдаёт макросам НЕЙТРАЛЬНЫЕ сущности
 * (`BaseActor`/`BaseCreature`), но в D&D-мире их содержимое — D&D-форма.
 * Доверенные сужения по дискриминатору `entityType` (без `as`): дают доступ к
 * D&D-полям внутри системы.
 */
function isDnDActorEntity(entity: SceneEntity | null): entity is DnDActor {
  return entity !== null && entity.entityType === 'actor';
}

function isDnDCreatureEntity(
  entity: SceneEntity | null,
): entity is DnDCreature {
  return entity !== null && entity.entityType === 'creature';
}

/**
 * Сообщение чата о цели вне досягаемости.
 *
 * @param name - оружие или действие
 * @param check - расстояние до цели
 * @param check.distance - расстояние
 * @param check.unitLabel - единица расстояния
 * @returns строка чата
 */
function formatOutOfRangeMessage(
  name: string,
  check: { distance: number; unitLabel: string },
): string {
  const labels = CREATURE_ACTIONS_BLOCK_LABELS;

  return `${labels.outOfRangePrefix}${name}${labels.outOfRangeMiddle}${check.distance} ${check.unitLabel}${labels.outOfRangeSuffix}`;
}

/**
 * Ищет оружие по ID макроса: сначала в актора-владельца,
 * потом fallback по всем акторам (обратная совместимость).
 *
 * @param ref - ID оружия (macro.ref)
 * @param actor - актор-владелец (из контекста)
 * @param actors - все акторы мира (для fallback)
 * @returns найденное оружие и актор, или null
 */
function findWeapon(
  ref: string,
  actor: DnDActor | null,
  actors: DnDActor[],
): { weapon: DnDGameItem; actor: DnDActor } | null {
  // Прямой поиск в актора-владельца
  if (actor) {
    const weapon = actor.equipment?.find(
      (item: DnDGameItem) => item.id === ref,
    );

    if (weapon) {
      return { weapon, actor };
    }
  }

  // Fallback: перебор всех акторов (обратная совместимость для старых макросов без actorId)
  for (const candidate of actors) {
    const weapon = candidate.equipment?.find(
      (item: DnDGameItem) => item.id === ref,
    );

    if (weapon) {
      return { weapon, actor: candidate };
    }
  }

  return null;
}

/**
 * Ищет заклинание по ID макроса.
 */
function findSpell(
  ref: string,
  actor: DnDActor | null,
  actors: DnDActor[],
): {
  spell: import('@vtt/shared/system/dnd.js').Spell;
  actor: DnDActor;
} | null {
  if (actor) {
    const spell = actor.spells?.find(
      (existingSpell) => existingSpell.id === ref,
    );

    if (spell) {
      return { spell, actor };
    }
  }

  for (const candidate of actors) {
    const spell = candidate.spells?.find(
      (existingSpell) => existingSpell.id === ref,
    );

    if (spell) {
      return { spell, actor: candidate };
    }
  }

  return null;
}

/**
 * Проверяет дистанцию между атакующим и целью на текущей сцене.
 *
 * @param weapon - оружие для атаки
 * @param attackerActorId - ID актора-атакующего
 * @param targetTokenId - ID токена-цели
 * @returns результат проверки дистанции или null
 */
function checkWeaponRangeOnScene(
  weapon: DnDGameItem,
  attackerActorId: string,
  targetTokenId: string,
): {
  allowed: boolean;
  disadvantage: boolean;
  distance: number;
  unitLabel: string;
} | null {
  const measurement = measureTokenDistanceOnScene(
    attackerActorId,
    targetTokenId,
  );

  if (!measurement) {
    return null;
  }

  const rangeResult = checkRange(weapon, measurement.distance);

  return {
    ...rangeResult,
    distance: measurement.distance,
    unitLabel: measurement.unitLabel,
  };
}

/**
 * Кнопка атаки на панели: оружие на месте, не закончилось, у стрелкового —
 * остались выстрелы (их число в углу).
 *
 * @param macro - макрос слота
 * @param context - владелец и сущности мира
 * @returns состояние слота
 */
function resolveWeaponAttackSlot(
  macro: HotbarMacro,
  context: MacroExecutionContext,
): MacroSlotState {
  const result = findWeapon(
    macro.ref,
    isDnDActorEntity(context.actor) ? context.actor : null,
    context.actors.filter(isDnDActorEntity),
  );

  return toHotbarSlotState(
    describeWeaponAttackAvailability(
      result?.actor.equipment ?? [],
      result?.weapon,
    ),
  );
}

/**
 * Кнопка применения предмета: предмет на месте, не закончился, хватает
 * зарядов; остаток — в углу.
 *
 * @param macro - макрос слота
 * @returns состояние слота
 */
function resolveItemUseSlot(macro: HotbarMacro): MacroSlotState {
  const owner = useWorldEntities().findCurrentDndEntity(macro.actorId);

  return toHotbarSlotState(
    describeItemUseAvailability(
      owner?.equipment?.find((item) => item.id === macro.ref),
    ),
  );
}

/**
 * Применяет предмет с панели: владелец — сущность слота.
 *
 * @param macro - макрос слота
 */
function executeItemUse(macro: HotbarMacro): void {
  if (macro.actorId) {
    applyEntityItemUse(macro.actorId, macro.ref);
  }
}

/**
 * Кнопка особенности с переключателем («Ярость»): эффект на месте; включён —
 * метка «вкл», выключен — остаток ресурса в углу, без ресурса кнопка гаснет.
 * Включённый эффект выключается всегда: выключение ничего не тратит.
 *
 * @param macro - макрос слота
 * @returns состояние слота
 */
function resolveFeatureToggleSlot(macro: HotbarMacro): MacroSlotState {
  const owner = useWorldEntities().findCurrentDndEntity(macro.actorId);
  const effects = owner?.activeEffects ?? [];
  const effect = effects.find((entry) => entry.id === macro.ref);

  if (!owner || !effect) {
    return { disabled: true, hint: FEATURE_TOGGLE_SLOT_LABELS.missingHint };
  }

  // Слот варианта горит, когда включён любой вариант его переключателя
  const isOn = collectEffectToggleGroup(effects, effect).some(
    (entry) => !entry.disabled,
  );

  if (isOn) {
    return {
      badge: FEATURE_TOGGLE_SLOT_LABELS.activeBadge,
      hint: FEATURE_TOGGLE_SLOT_LABELS.activeHint,
    };
  }

  return describeActivationSlot(owner, effect);
}

/**
 * Слот эффекта, который тратит ресурс листа: остаток ресурса в углу, без
 * ресурса кнопка гаснет — кроме смены внутри горящего включения: она
 * бесплатна.
 *
 * @param owner - владелец эффекта
 * @param effect - эффект с применением или переключателем
 * @returns состояние слота
 */
function describeActivationSlot(
  owner: DnDSceneEntity,
  effect: ActiveEffect,
): MacroSlotState {
  const counters = readEntityCounters(owner);
  const counterKey = effect.activation?.counter;

  const counter = counterKey
    ? counters.find((entry) => entry.counterKey === counterKey)
    : undefined;

  return {
    ...(counter ? { badge: String(counter.current) } : {}),
    ...(canSwitchOnEffect(counters, owner.activeEffects ?? [], effect)
      ? {}
      : { disabled: true, hint: FEATURE_TOGGLE_SLOT_LABELS.noCounterHint }),
  };
}

/**
 * Кнопка эффекта «при применении» («Изгнание нежити»): эффект на месте,
 * остаток ресурса в углу, без ресурса кнопка гаснет.
 *
 * @param macro - макрос слота
 * @returns состояние слота
 */
function resolveEffectUseSlot(macro: HotbarMacro): MacroSlotState {
  const owner = useWorldEntities().findCurrentDndEntity(macro.actorId);
  const effect = owner?.activeEffects?.find((entry) => entry.id === macro.ref);

  if (!owner || !effect || !isUseActivatedEffect(effect)) {
    return { disabled: true, hint: EFFECT_USE_SLOT_LABELS.missingHint };
  }

  return describeActivationSlot(owner, effect);
}

/**
 * Применяет эффект листа с панели: владелец — сущность слота.
 *
 * @param macro - макрос слота
 */
function executeEffectUse(macro: HotbarMacro): void {
  if (macro.actorId) {
    applyEntityEffectUse(macro.actorId, macro.ref);
  }
}

/**
 * Включает или выключает эффект особенности с панели: владелец — сущность
 * слота.
 *
 * @param macro - макрос слота
 */
function executeFeatureToggle(macro: HotbarMacro): void {
  if (macro.actorId) {
    toggleEntityEffect(macro.actorId, macro.ref);
  }
}

/**
 * Отказ с панели: слот нажали, а трата хода под запретом («Реакция
 * недоступна: Электрошок»). Причина уходит строкой в чат — окна у панели нет.
 *
 * @param reason - причина запрета либо `null`
 * @returns `true`, если действие отменено
 */
function refuseBlockedMacro(reason: string | null): boolean {
  if (reason) {
    useChatStore().sendMessage(
      `${MACRO_MESSAGE_LABELS.blockedPrefix}${reason}`,
      'text',
    );
  }

  return reason !== null;
}

/**
 * Регистрирует все D&D 5e macro executor'ы в macroRegistry.
 * Вызывается один раз при монтировании сцены.
 */
export function registerDnd5eMacros(): void {
  registerMacro(DND_MACRO_TYPES.itemUse, executeItemUse, {
    resolveState: resolveItemUseSlot,
  });

  registerMacro(DND_MACRO_TYPES.featureToggle, executeFeatureToggle, {
    resolveState: resolveFeatureToggleSlot,
  });

  registerMacro(DND_MACRO_TYPES.effectUse, executeEffectUse, {
    resolveState: resolveEffectUseSlot,
  });

  registerMacro(
    DND_MACRO_TYPES.weaponAttack,
    (macro, context) => {
      try {
        const chatStore = useChatStore();
        const targetStore = useTargetStore();

        const actorEntity = isDnDActorEntity(context.actor)
          ? context.actor
          : null;

        const result = findWeapon(
          macro.ref,
          actorEntity,
          context.actors.filter(isDnDActorEntity),
        );

        if (!result || !result.weapon.damageParts?.length) {
          console.warn(
            '[Hotbar] Оружие не найдено или без частей урона:',
            macro.ref,
          );

          return;
        }

        // Запрет трат хода и чем удар совершается — до выстрела и окна
        runWithWeaponAttackCost(
          result.actor,
          result.weapon.name,
          refuseBlockedMacro,
          (attackCost) => {
            // Стрелковое оружие стреляет боеприпасом, если лист их ведёт
            const shot = prepareAmmunitionShot(result.actor, result.weapon);

            if (!shot) {
              return;
            }

            const ammunitionId = shot.ammunition?.id;

            runWeaponAttackChoices(
              shot.weapon,
              result.actor.id,
              (foundWeapon) => {
                const foundActor = result.actor;

                // resolvedStats для @mod.* в формулах частей и статического урона
                const ambientEffects = listAmbientEffects(foundActor.id);

                const resolvedStats = resolveActorStats(
                  foundActor,
                  ambientEffects,
                );

                // --- Проверка дистанции ---
                let isDisadvantage = false;

                if (targetStore.targetTokenId && foundActor.id) {
                  const rangeCheck = checkWeaponRangeOnScene(
                    foundWeapon,
                    foundActor.id,
                    targetStore.targetTokenId,
                  );

                  if (rangeCheck && !rangeCheck.allowed) {
                    chatStore.sendMessage(
                      formatOutOfRangeMessage(foundWeapon.name, rangeCheck),
                      'text',
                    );

                    return;
                  }

                  if (rangeCheck?.disadvantage) {
                    isDisadvantage = true;
                  }
                }

                const combinedEffects = collectEffectsWithAuras(foundActor);

                const attackKey = getAttackBonusKey(foundWeapon.rangeType);
                const damageKey = getDamageBonusKey(foundWeapon.rangeType);

                const baseMod = calculateWeaponAttackModifier(
                  foundActor,
                  foundWeapon,
                  resolvedStats,
                );

                // Оружие со спасброском: цель кидает спас, броска попадания нет
                const hasSave = isSaveAbility(foundWeapon.saveType);
                const weaponSaveDC = resolveWeaponSaveDc(baseMod);

                const incomingAttackType = getAttackFlagCategory(
                  foundWeapon.rangeType,
                );

                const targetActor = targetStore.getTargetActor();

                const weaponAttackRoll = resolveTargetedAttackRoll(
                  foundActor,
                  incomingAttackType,
                  { forceDisadvantage: isDisadvantage },
                );

                const { openModal } = useModalManager();

                const {
                  buildWeaponRollSetup,
                  buildTargetHpContext,
                  buildTargetTypeContext,
                } = useBonusDamageParts();

                // Единая со заклинаниями система урона: бросок ВСЕГДА идёт многочастным
                // путём (части урона оружия + бонус-части эффектов). Состояние HP цели
                // нужно для условных веток @target.full/@target.notFull.
                const targetIsFull = isTargetAtFullHp(targetActor);

                const weaponPartsSetup = buildWeaponRollSetup({
                  weapon: foundWeapon,
                  actor: foundActor,
                  effects: combinedEffects,
                  resolvedStats,
                  targetIsFull,
                  targetType: buildTargetTypeContext(),
                });

                // Тип урона на выбор спрашивает окно броска: части урона решает оно
                // само, а эффекты оружия на цель получают тот же тип здесь
                let weaponSpell = weaponPartsSetup.pseudoSpell;

                const damageTypeChoice = requestDamageTypeChoiceFor(
                  foundWeapon,
                  weaponPartsSetup.pseudoSpell,
                  (chosen) => {
                    weaponSpell = chosen;
                  },
                );

                /**
                 * Применяет брошенные части урона оружия через многочастный оркестратор
                 * (защиты по типу на каждую часть, per-target гейты, спасбросок оружия,
                 * единый HP-апдейт).
                 *
                 * @param parts - брошенные части урона
                 */
                function handleWeaponRollParts(
                  parts: RolledSpellDamagePart[],
                ): void {
                  const worldStore = useWorldStore();
                  const socket = chatStore.getSocket();
                  const worldId = worldStore.connectionState.currentWorldId;

                  if (!worldId || !socket) {
                    return;
                  }

                  const world = worldStore.worlds.find(
                    (worldEntry) => worldEntry.id === worldId,
                  );

                  const actors = [
                    ...(world?.actors ?? []),
                    ...(world?.creatures ?? []),
                  ];

                  if (actors.length === 0) {
                    return;
                  }

                  const { resolveSpellDamageWithParts } = useSpellResolution();

                  void resolveSpellDamageWithParts(
                    {
                      spell: weaponSpell,
                      damageTotal: 0,
                      spellSaveDC: weaponSaveDC,
                      actors,
                      socket,
                      casterId: foundActor.id,
                    },
                    parts,
                    { scene: worldStore.currentScene },
                  );
                }

                openModal('DiceRollModal', {
                  title: `${CREATURE_ACTIONS_BLOCK_LABELS.attackRollPrefix}${foundWeapon.name}`,
                  rollLabel: foundWeapon.name,
                  rollButtonText: hasSave
                    ? SPELL_DAMAGE_ROLL_BUTTON
                    : ACTOR_SPELLS_TAB_LABELS.attackRoll,
                  // Формула для отображения (бросок идёт многочастным путём по damageParts)
                  formula: weaponPartsSetup.baseParts[0]?.formula ?? '',
                  attackModifier: hasSave ? undefined : baseMod,
                  evaluateBonusRollFormulas: hasSave
                    ? undefined
                    : buildRollBonusEvaluator(
                        () =>
                          useWorldEntities().findCurrentDndEntity(
                            foundActor.id,
                          ),
                        attackKey,
                      ),
                  initialRollMode: weaponAttackRoll.mode,
                  rollModeReasons: weaponAttackRoll.reasons,
                  critThreshold: resolveTargetedCritThreshold(
                    foundActor,
                    resolvedStats.critThreshold,
                  ),
                  incomingAttackType,
                  evaluateConditionalBonuses: (modalContext: {
                    hasAdvantage: boolean;
                    hasDisadvantage: boolean;
                  }) => {
                    // HP цели читается в момент броска — для условий target.hp.*
                    const rollContext = {
                      ...modalContext,
                      target: buildTargetHpContext(undefined, foundActor.id),
                    };

                    // Условный бонус может быть формулой (`@prof`, `@mod.dex`) — без
                    // контекста @-переменных она дала бы ноль
                    const formulaContext =
                      buildResolvedFormulaContext(foundActor);

                    return {
                      attackBonus: evaluateConditionalBonuses(
                        combinedEffects,
                        attackKey,
                        rollContext,
                        formulaContext,
                      ),
                      damageBonus: evaluateConditionalBonuses(
                        combinedEffects,
                        damageKey,
                        rollContext,
                        formulaContext,
                      ),
                    };
                  },
                  damageType: getWeaponPrimaryDamageType(
                    foundWeapon,
                    resolvedStats,
                  ),
                  damageParts: weaponPartsSetup.baseParts,
                  evaluateBonusDamageParts:
                    weaponPartsSetup.evaluateBonusDamageParts,
                  // Эффекты «на цель» гейтит оркестратор (handleWeaponRollParts →
                  // resolveSpellDamageWithParts по applySave/приземлению). Прямого onHit
                  // нет — он вешал эффект на каждое попадание мимо спасброска.
                  onRollParts: handleWeaponRollParts,
                  damageTypeChoice,
                  // Расход одноразовых эффектов «следующей атаки» (Злая насмешка и т.п.)
                  attackerId: foundActor.id,
                  // Боеприпас и действие хода тратятся, когда бросок пошёл, а не
                  // при открытии окна
                  beforeRoll: () => {
                    if (ammunitionId) {
                      spendShotAmmunition(foundActor.id, ammunitionId);
                    }

                    recordEntityActionSpend(foundActor.id, attackCost, true);

                    return true;
                  },
                });
              },
            );
          },
        );
      } catch (err) {
        console.error('[Hotbar] Ошибка выполнения weapon-attack:', err);
      }
    },
    { resolveState: resolveWeaponAttackSlot },
  );

  registerMacro('spell-cast', (macro, context) => {
    try {
      const actorEntity = isDnDActorEntity(context.actor)
        ? context.actor
        : null;

      const result = findSpell(
        macro.ref,
        actorEntity,
        context.actors.filter(isDnDActorEntity),
      );

      if (!result) {
        console.warn('[Hotbar] Заклинание не найдено:', macro.ref);

        return;
      }

      // Каст — общим разбором, тем же, что у листа персонажа
      startSpellCast(result.spell, createHotbarCasterPort(result.actor.id));
    } catch (err) {
      console.error('[Hotbar] Ошибка выполнения spell-cast:', err);
    }
  });

  registerCreatureActionMacro();
  registerCreatureSpellMacro();
}

/**
 * Заклинатель горячей панели для общего разбора каста: лист читается из мира в
 * момент обращения, ячейка и заряд пишутся помощником записи листа (из свежей
 * сущности), отказ — строкой в чат.
 *
 * @param actorId - заклинатель
 * @returns порт заклинателя
 */
function createHotbarCasterPort(actorId: string): SpellCasterPort {
  return {
    casterId: actorId,
    readCaster: () => {
      const caster = useWorldEntities().findCurrentDndEntity(actorId);

      return caster && isDnDActorEntity(caster) ? caster : undefined;
    },
    spendSlot: (castLevel, isPactSlot) => {
      changeEntitySheet(actorId, (caster) =>
        isDnDActorEntity(caster)
          ? {
              ...caster,
              system: withSpentSpellSlot(caster.system, castLevel, isPactSlot),
            }
          : null,
      );
    },
    spendUse: (spell) => {
      changeEntitySheet(actorId, (caster) => ({
        ...caster,
        spells: withSpentSpellUse(caster.spells ?? [], spell.id),
      }));
    },
    refuse: (spell, refusal) => {
      useChatStore().sendMessage(
        `${MACRO_MESSAGE_LABELS.blockedPrefix}${spell.name}: ${refusal.description}`,
        'text',
      );
    },
  };
}

/**
 * Собирает все действия существа в плоский массив.
 * Включает черты, действия, бонусные действия, реакции и легендарные действия.
 *
 * @param creature - существо
 * @returns плоский массив всех действий
 */
function collectCreatureActions(
  creature: DnDCreature,
): import('@vtt/shared/system/dnd.js').CreatureAction[] {
  return [
    ...(creature.system.traits ?? []),
    ...(creature.system.actions ?? []),
    ...(creature.system.bonusActions ?? []),
    ...(creature.system.reactions ?? []),
    ...(creature.system.legendary?.actions ?? []),
  ];
}

/**
 * Регистрирует executor для макроса типа `creature-action`.
 * Вызывается из `registerDnd5eMacros` при инициализации сцены.
 */
function registerCreatureActionMacro(): void {
  registerMacro('creature-action', (macro, context) => {
    try {
      const rawCreature =
        context.creatures.find(
          (existingCreature) => existingCreature.id === macro.actorId,
        ) ?? context.actor;

      const foundCreature = isDnDCreatureEntity(rawCreature)
        ? rawCreature
        : null;

      if (!foundCreature || !macro.ref) {
        console.warn('[Hotbar] Существо или действие не найдено:', macro.ref);

        return;
      }

      const allActions = collectCreatureActions(foundCreature);

      const foundAction = allActions.find(
        (creatureAction) => creatureAction.name === macro.ref,
      );

      if (!foundAction) {
        console.warn('[Hotbar] Действие не найдено в существе:', macro.ref);

        return;
      }

      const section = findCreatureActionSection(foundCreature, foundAction);

      if (
        section
        && refuseBlockedMacro(
          findCreatureActionBlock(
            resolveEntityActionBlocks(
              foundCreature,
              listAmbientEffects(foundCreature.id),
            ),
            section,
            foundAction,
            isEntityOwnTurn(foundCreature.id),
          ),
        )
      ) {
        return;
      }

      /** Атака действием «Атака»: её считает «одна атака за ход» */
      const isAttack = isCreatureAttackAction(section, foundAction);

      /**
       * Трата хода раздела — когда действие точно идёт.
       *
       * @param withRoll - действие идёт с броском: атака считается атакой
       */
      const spendTurn = (withRoll = false): void => {
        if (section) {
          recordEntityActionSpend(
            foundCreature.id,
            resolveCreatureSectionCost(section),
            withRoll && isAttack,
          );
        }

        if (withRoll && isAttack) {
          warnOpportunityAttack(foundCreature.id);
        }
      };

      runCreatureActionChoices(foundAction, foundCreature.id, (action) => {
        const hasAttackParams = !!(
          action.attackBonus !== undefined
          || action.damageParts?.length
          || isSaveAbility(action.saveType)
        );

        if (!hasAttackParams) {
          const chatStore = useChatStore();

          // Чат кнопок бросков не рисует — марка `{@roll …}` ушла бы со скобками.
          const description = action.description
            ? stripDescriptionRollMarkers(action.description.join(' '))
            : '';

          chatStore.sendMessage(
            `<b>${action.name}</b><br/>${description}`,
            'text',
          );

          spendTurn();

          // Окна броска нет — тип урона на выбор эффектов спрашивает плашка;
          // для эффектов «на цель» получателя выбирают на карте
          applyActionUseEffects(action, foundCreature.id);

          return;
        }

        const targetStore = useTargetStore();
        const chatStore = useChatStore();

        // --- Проверка дистанции (только для прямых атак; область — шаблоном) ---
        let isDisadvantage = false;

        if (
          !action.areaOfEffect
          && targetStore.targetTokenId
          && foundCreature.id
        ) {
          const rangeCheck = checkCreatureActionRangeOnScene(
            action,
            foundCreature.id,
            targetStore.targetTokenId,
          );

          if (rangeCheck && !rangeCheck.allowed) {
            chatStore.sendMessage(
              formatOutOfRangeMessage(action.name, rangeCheck),
              'text',
            );

            return;
          }

          if (rangeCheck?.disadvantage) {
            isDisadvantage = true;
          }
        }

        // Отказ по дистанции трату хода не тратит
        spendTurn(true);

        // Урон «или» — после проверки дистанции, до шаблона и окна броска
        runWithCreatureDamageChoice(action, foundCreature, (chosen, variants) =>
          launchCreatureAction(chosen, foundCreature.id, (templateId) =>
            openCreatureActionRoll(
              foundCreature,
              chosen,
              isDisadvantage,
              templateId,
              variants,
            ),
          ),
        );
      });
    } catch (err) {
      console.error('[Hotbar] Ошибка выполнения creature-action:', err);
    }
  });
}

/**
 * Открывает DiceRollModal для действия существа (многочастный путь, единая со
 * заклинаниями/оружием система урона). Атаки — с броском попадания и эффектами
 * на цель при попадании; спасброски/область — без броска попадания, спасброски
 * и эффекты применяются оркестратором по каждой задетой цели.
 *
 * @param creature - существо-источник
 * @param action - действие существа
 * @param isDisadvantage - стартовать с помехой (проверка дистанции)
 * @param templateId - id размещённого AoE-шаблона (если действие с областью)
 * @param variants - наборы урона «или» на выбор в окне; пусто — набор один
 */
function openCreatureActionRoll(
  creature: DnDCreature,
  action: CreatureAction,
  isDisadvantage: boolean,
  templateId: string | undefined,
  variants: readonly CreatureDamageVariant[] = [],
): void {
  const { openModal } = useModalManager();

  const { buildCreatureRollSetup, buildTargetHpContext } =
    useBonusDamageParts();

  const usesSaveOrArea = creatureActionHasSave(action) || !!action.areaOfEffect;

  const effects = collectActiveEffects(creature);

  const targetHp = action.areaOfEffect ? undefined : buildTargetHpContext();

  const targetIsFull = targetHp
    ? targetHp.currentHp >= targetHp.maxHp
    : undefined;

  /**
   * Части и псевдо-заклинание броска по действию.
   *
   * @param variantAction - действие набора урона
   * @returns данные броска
   */
  const buildSetup = (variantAction: CreatureAction): CreatureRollSetup =>
    buildCreatureRollSetup({
      action: variantAction,
      creature,
      effects,
      targetIsFull,
      targetType: targetHp?.creatureType,
    });

  /**
   * Применение брошенных частей набора.
   *
   * @param chosenAction - действие с решённым типом урона
   * @param actionSpell - его псевдо-заклинание
   * @param parts - брошенные части; у действия без урона — пусто
   */
  const applyParts = (
    chosenAction: CreatureAction,
    actionSpell: Spell,
    parts: RolledSpellDamagePart[],
  ): void =>
    applyCreatureActionParts(
      creature,
      chosenAction,
      actionSpell,
      parts,
      templateId,
    );

  // У каждого набора урона «или» свои части, тип урона на выбор и применение
  const rollVariants = buildCreatureRollVariants(
    action,
    variants,
    buildSetup,
    applyParts,
  );

  const [primary] = rollVariants;

  if (!primary) {
    return;
  }

  // Спасбросок или область без урона: окна броска нет — как на листе существа
  if (
    runDamagelessCreatureAction(
      action,
      rollVariants,
      (chosenAction) => buildSetup(chosenAction).pseudoSpell,
      applyParts,
    )
  ) {
    return;
  }

  const actionAttackRoll = usesSaveOrArea
    ? undefined
    : resolveTargetedAttackRoll(
        creature,
        getAttackFlagCategory(action.rangeType),
        { forceDisadvantage: isDisadvantage },
      );

  openModal('DiceRollModal', {
    title: usesSaveOrArea ? action.name : `Атака — ${action.name}`,
    rollLabel: action.name,
    rollButtonText: usesSaveOrArea ? SPELL_DAMAGE_ROLL_BUTTON : 'Атаковать',
    formula: primary.formula,
    attackModifier: usesSaveOrArea ? undefined : action.attackBonus,
    evaluateBonusRollFormulas: usesSaveOrArea
      ? undefined
      : buildRollBonusEvaluator(
          () => useWorldEntities().findCurrentDndEntity(creature.id),
          getAttackBonusKey(action.rangeType),
        ),
    initialRollMode: actionAttackRoll?.mode ?? 'normal',
    rollModeReasons: actionAttackRoll?.reasons,
    incomingAttackType: getAttackFlagCategory(action.rangeType),
    damageType: primary.damageType,
    damageParts: primary.damageParts,
    evaluateBonusDamageParts: primary.evaluateBonusDamageParts,
    onRollParts: primary.onRollParts,
    damageTypeChoice: primary.damageTypeChoice,
    damageVariants: variants.length > 0 ? rollVariants : undefined,
    onCancel: templateId ? () => discardSpellTemplate(templateId) : undefined,
    // Расход одноразовых эффектов «следующей атаки» на броске атаки существа
    attackerId: creature.id,
  });
}

/**
 * Применяет брошенные части урона действия существа через многочастный
 * оркестратор (спасброски целей, защиты по типу, AoE-шаблон, единый HP-апдейт).
 *
 * @param creature - существо-источник (casterId)
 * @param action - действие (источник DC спасброска)
 * @param pseudoSpell - псевдо-заклинание действия
 * @param parts - брошенные части урона
 * @param templateId - id размещённого AoE-шаблона (если был)
 */
function applyCreatureActionParts(
  creature: DnDCreature,
  action: CreatureAction,
  pseudoSpell: import('@vtt/shared/system/dnd.js').Spell,
  parts: RolledSpellDamagePart[],
  templateId: string | undefined,
): void {
  const worldStore = useWorldStore();
  const chatStore = useChatStore();
  const socket = chatStore.getSocket();
  const worldId = worldStore.connectionState.currentWorldId;

  if (!worldId || !socket) {
    return;
  }

  const world = worldStore.worlds.find((entry) => entry.id === worldId);
  const actors = [...(world?.actors ?? []), ...(world?.creatures ?? [])];

  const templateStore = useSpellTemplateStore();

  let cachedTemplate: MeasurementTemplate | null = null;

  if (templateId) {
    cachedTemplate = templateStore.getPlacedTemplate(templateId) ?? null;
    templateStore.removePlacedTemplate(templateId);
  }

  if (actors.length > 0) {
    const { resolveSpellDamageWithParts } = useSpellResolution();

    void resolveSpellDamageWithParts(
      {
        spell: pseudoSpell,
        damageTotal: 0,
        spellSaveDC: action.saveDC ?? 10,
        actors,
        socket,
        casterId: creature.id,
      },
      parts,
      { scene: worldStore.currentScene, cachedTemplate },
    );
  }

  if (templateId) {
    templateStore.deleteTemplate(templateId);
  }

  applyActionSelfEffects(action, creature.id);
}

/**
 * Списывает одно применение заклинания существа и персистит изменение
 * (локально + сокет).
 *
 * У группы «на весь список» счётчик один на всю группу и лежит у неё; у
 * остальных заряды считает само заклинание. Так же, как на листе существа —
 * иначе каст с хотбара расходился бы с кастом со вкладки.
 *
 * @param creature - существо-источник
 * @param spell - заклинание
 * @param placement - группа, из которой идёт каст
 */
function consumeCreatureSpellUse(
  creature: DnDCreature,
  spell: Spell,
  placement: CreatureSpellPlacement | undefined,
): void {
  const isPool =
    placement !== undefined && isCreatureSpellPoolMode(placement.group.mode);

  if (!isPool && (!spell.uses || spell.uses.recovery === 'atWill')) {
    return;
  }

  // Существо перечитывается в момент записи: копия, захваченная до окна,
  // вернула бы хиты и эффекты, изменённые сервером за это время
  changeEntitySheet(creature.id, (current) => {
    if (!isDnDCreatureEntity(current)) {
      return null;
    }

    if (isPool && placement) {
      return {
        ...current,
        system: {
          ...current.system,
          spellcastingBlocks: consumeCreatureSpellGroupUse(
            current.system.spellcastingBlocks ?? [],
            placement.group.id,
          ),
        },
      };
    }

    return {
      ...current,
      spells: (current.spells ?? []).map((entry) =>
        entry.id === spell.id && entry.uses
          ? {
              ...entry,
              uses: {
                ...entry.uses,
                current: Math.max(0, entry.uses.current - 1),
              },
            }
          : entry,
      ),
    };
  });
}

/**
 * Регистрирует executor для макроса типа `creature-spell` (заклинания существа
 * с хотбара). Резолвит существо и заклинание по id, списывает заряд и открывает
 * бросок тем же многочастным путём, что и лист существа.
 */
function registerCreatureSpellMacro(): void {
  registerMacro('creature-spell', (macro, context) => {
    try {
      const rawCreature =
        context.creatures.find(
          (existingCreature) => existingCreature.id === macro.actorId,
        ) ?? context.actor;

      const foundCreature = isDnDCreatureEntity(rawCreature)
        ? rawCreature
        : null;

      if (!foundCreature || !macro.ref) {
        console.warn('[Hotbar] Существо или заклинание не найдено:', macro.ref);

        return;
      }

      const foundSpell = foundCreature.spells?.find(
        (entry) => entry.id === macro.ref,
      );

      if (!foundSpell) {
        console.warn('[Hotbar] Заклинание не найдено в существе:', macro.ref);

        return;
      }

      if (
        refuseBlockedMacro(
          resolveSpellCastBlock(
            foundCreature,
            foundSpell,
            listAmbientEffects(foundCreature.id),
          ),
        )
      ) {
        return;
      }

      runWithEffectVariants(
        retypeCasterSpellDamage(foundSpell, foundCreature),
        (spell) => {
          const chatStore = useChatStore();

          // Группа, из которой идёт каст: её числа, круг наложения и общий счётчик
          // применений главнее чисел самого существа
          const placement = findCreatureSpellPlacement(
            foundCreature.system.spellcastingBlocks,
            spell.id,
          );

          if (!hasCreatureSpellUsesLeft(spell, placement)) {
            chatStore.sendMessage(
              `⛔ ${spell.name}: не осталось зарядов — нужен отдых.`,
              'text',
            );

            return;
          }

          recordEntityActionSpend(
            foundCreature.id,
            resolveSpellCastCost(spell),
          );

          /** Списывает применение заклинания */
          const spendUse = (): void => {
            consumeCreatureSpellUse(foundCreature, spell, placement);
          };

          // Провал каста («Замедление», «Слово силы: Боль»): применение
          // тратится, только если так велит правило
          runWithCastFailure(
            spell,
            foundCreature,
            { loseUse: spendUse },
            () => {
              spendUse();

              // Область: размещаем шаблон у токена существа, затем кидаем урон
              if (spell.areaOfEffect) {
                const templateStore = useSpellTemplateStore();

                const color = getDamageTemplateColor(
                  getDamagePartsPrimaryType(spell.damageParts),
                );

                // Круг наложения группы растит область так же, как ячейка персонажа
                templateStore.requestPlacement(
                  resolveSpellAreaAtLevel(spell, placement?.ref.castLevel)
                    ?? spell.areaOfEffect,
                  color,
                  foundCreature.id,
                  (templateId) =>
                    openCreatureSpellRoll(
                      foundCreature,
                      spell,
                      templateId,
                      placement,
                    ),
                  null,
                );

                return;
              }

              openCreatureSpellRoll(foundCreature, spell, undefined, placement);
            },
          );
        },
      );
    } catch (err) {
      console.error('[Hotbar] Ошибка выполнения creature-spell:', err);
    }
  });
}

/**
 * Открывает DiceRollModal для заклинания существа (многочастный путь). Атакующие
 * заклинания — с броском попадания (плоский бонус из блока заклинательства),
 * спасброски/область — без него.
 *
 * @param creature - существо-источник
 * @param spell - заклинание существа
 * @param templateId - id размещённого AoE-шаблона (если область)
 * @param placement - группа, из которой идёт каст
 */
function openCreatureSpellRoll(
  creature: DnDCreature,
  spell: Spell,
  templateId: string | undefined,
  placement: CreatureSpellPlacement | undefined,
): void {
  const { openModal } = useModalManager();

  const { buildCreatureSpellRollSetup } = useBonusDamageParts();

  const attackType = getSpellAttackType(spell);

  const usesSaveOrArea =
    (!!spell.saveType && spell.saveType !== 'none') || !!spell.areaOfEffect;

  const usesAttack = attackType !== undefined && !usesSaveOrArea;

  const effects = collectActiveEffects(creature);

  const setup = buildCreatureSpellRollSetup({
    spell,
    creature,
    effects,
    targetIsFull: undefined,
    targetType: undefined,
    spellcastingAbility: getCreatureSpellBlockAbility(
      creature,
      placement?.block,
    ),
  });

  const isHealing = spellIsHealing(spell);
  const damageType = getDamagePartsPrimaryType(spell.damageParts);

  const numbers = calculateCreatureSpellBlockNumbers(
    creature,
    placement?.block,
  );

  // Существо как заклинатель: Сл блока и модификатор его характеристики.
  // Своя Сл заклинания (жезл, свиток) главнее Сл блока
  const blockAbility = getCreatureSpellBlockAbility(creature, placement?.block);

  const casterSource: SpellCasterSource = {
    saveDc: resolveCreatureSpellSaveDC(spell, numbers.saveDC),
    spellMod: getCreatureSpellMod(creature, blockAbility),
    spellAbility: blockAbility,
  };

  const castKey = generateId(SPELL_CAST_KEY_PREFIX);

  beginSpellCast(creature.id, spell, castKey, placement?.ref.castLevel);

  // Ни урона, ни атаки — окну броска катить нечего, и применение оно не
  // зовёт: эффекты заклинания не ложились вовсе. Применяем сразу, как лист
  // персонажа, — тип урона на выбор спросит плашка
  if (!usesAttack && setup.baseParts.length === 0) {
    runWithDamageTypeChoices(setup.pseudoSpell, (chosen) => {
      applyCreatureSpellParts(
        creature,
        chosen,
        [],
        templateId,
        casterSource,
        castKey,
      );
    });

    return;
  }

  // Тип урона на выбор спрашивает окно броска: части урона решает оно само,
  // а эффекты заклинания и зона получают тот же тип здесь
  let castSpell = setup.pseudoSpell;

  const damageTypeChoice = requestDamageTypeChoiceFor(
    spell,
    setup.pseudoSpell,
    (chosen) => {
      castSpell = chosen;
    },
  );

  // Атака без частей урона: окно броска не зовёт `onRollParts`, и эффекты на
  // попадании разбирает тот же оркестратор с пустым набором частей
  const onHit =
    usesAttack
    && setup.baseParts.length === 0
    && setup.pseudoSpell.activeEffects
      ? () =>
          applyCreatureSpellParts(
            creature,
            castSpell,
            [],
            templateId,
            casterSource,
            castKey,
          )
      : undefined;

  // Круг наложения из группы фиксирует окно броска: список кругов из одного
  // значения. Без круга секция не показывается — так же, как было до групп
  const castLevel = placement?.ref.castLevel;

  const spellAttackRoll = usesAttack
    ? resolveTargetedAttackRoll(creature, 'spell')
    : undefined;

  openModal('DiceRollModal', {
    title: usesAttack ? `Атака — ${spell.name}` : spell.name,
    rollLabel: spell.name,
    rollButtonText: getCreatureSpellRollButtonText(usesAttack, isHealing),
    formula: setup.baseParts[0]?.formula ?? '',
    attackModifier: usesAttack ? numbers.attackBonus : undefined,
    evaluateBonusRollFormulas: usesAttack
      ? buildRollBonusEvaluator(
          () => useWorldEntities().findCurrentDndEntity(creature.id),
          'attack.spell',
        )
      : undefined,
    initialRollMode: spellAttackRoll?.mode ?? 'normal',
    rollModeReasons: spellAttackRoll?.reasons,
    incomingAttackType: usesAttack ? attackType : undefined,
    damageType,
    isHealing,
    damageParts: setup.baseParts,
    spellLevel: castLevel === undefined ? undefined : spell.level,
    availableSpellLevels: castLevel === undefined ? undefined : [castLevel],
    spellScalingDice:
      castLevel === undefined ? undefined : spell.scaling?.additionalDice,
    evaluateBonusDamageParts: setup.evaluateBonusDamageParts,
    onRollParts: (parts: RolledSpellDamagePart[]) =>
      applyCreatureSpellParts(
        creature,
        castSpell,
        parts,
        templateId,
        casterSource,
        castKey,
      ),
    onHit,
    damageTypeChoice,
    onCancel: templateId ? () => discardSpellTemplate(templateId) : undefined,
    // Расход одноразовых эффектов «следующей атаки» на броске атаки существа
    attackerId: creature.id,
  });
}

/**
 * Применяет брошенные части урона/лечения заклинания существа через
 * многочастный оркестратор. DC спасброска — плоский из блока заклинаний, а без
 * блока — из заклинательства существа.
 *
 * @param creature - существо-источник (casterId)
 * @param pseudoSpell - псевдо-заклинание (клон с activeEffects)
 * @param parts - брошенные части урона
 * @param templateId - id размещённого AoE-шаблона (если был)
 * @param casterSource - Сл блока и модификатор характеристики существа
 * @param castKey - ключ каста: окно зовёт применение и по попаданию, и по частям
 */
function applyCreatureSpellParts(
  creature: DnDCreature,
  pseudoSpell: Spell,
  parts: RolledSpellDamagePart[],
  templateId: string | undefined,
  casterSource: SpellCasterSource,
  castKey: string,
): void {
  const worldStore = useWorldStore();

  if (
    !worldStore.connectionState.currentWorldId
    || !useChatStore().getSocket()
  ) {
    return;
  }

  const templateStore = useSpellTemplateStore();

  let cachedTemplate: MeasurementTemplate | null = null;

  if (templateId) {
    cachedTemplate = templateStore.getPlacedTemplate(templateId) ?? null;
    templateStore.removePlacedTemplate(templateId);
  }

  // Конец прежней концентрации, эффекты на самом существе, зона на месте
  // шаблона — затем цели, когда эффекты прежнего каста сняты
  afterSpellCast(
    completeSpellCast({
      spell: pseudoSpell,
      caster: useWorldEntities().findCurrentDndEntity(creature.id) ?? creature,
      source: casterSource,
      template: cachedTemplate,
      castKey,
    }),
    () => {
      const socket = useChatStore().getSocket();
      const actors = useWorldEntities().getCurrentWorldEntities();

      // Цели нечего получить — ни урона, ни эффекта («Щит» только на себя):
      // оркестратор писал бы в чат «цель не выбрана» к касту, который удался
      if (
        !socket
        || actors.length === 0
        || !castReachesTargets(pseudoSpell, parts.length)
      ) {
        return;
      }

      const { resolveSpellDamageWithParts } = useSpellResolution();

      void resolveSpellDamageWithParts(
        {
          spell: pseudoSpell,
          damageTotal: 0,
          spellSaveDC: casterSource.saveDc,
          actors,
          socket,
          casterId: creature.id,
        },
        parts,
        { scene: worldStore.currentScene, cachedTemplate },
      );
    },
  );

  if (templateId) {
    templateStore.deleteTemplate(templateId);
  }
}
