import type {
  MacroExecutionContext,
  MacroSlotState,
} from '@/core/registries/macroRegistry';
import type { HotbarMacro, SceneEntity } from '@vtt/shared';
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

import type { SpellCasterPort } from '../composables/spellCastFlow';
import type { RolledSpellDamagePart } from '../composables/useSpellResolution';

import { registerMacro } from '@/core/registries/macroRegistry';
import { useModalManager } from '@/shared_ui/composables/useModalManager';
import { useChatStore } from '@/stores/chatStore';
import { useTargetStore } from '@/stores/targetStore';
import { useWorldStore } from '@/stores/worldStore';
/**
 * Регистрация макро-executor'ов, специфичных для D&D 5e.
 * Вся боевая логика (бросок атаки, двухэтапная атака, криты, урон) вынесена
 * в attackUtils.ts, а здесь остаётся только оркестрация и контекст выполнения макроса.
 */
import {
  buildResolvedFormulaContext,
  calculateWeaponAttackModifier,
  canSwitchOnEffect,
  checkRange,
  collectEffectToggleGroup,
  consumeCreatureSpellGroupUse,
  describeItemUseAvailability,
  describeWeaponAttackAvailability,
  evaluateConditionalBonuses,
  findCreatureActionSection,
  findCreatureSpellPlacement,
  getAttackBonusKey,
  getAttackFlagCategory,
  getDamageBonusKey,
  getWeaponPrimaryDamageType,
  isCreatureSpellPoolMode,
  isSaveAbility,
  isTargetAtFullHp,
  isUseActivatedEffect,
  resolveActorStats,
  resolveWeaponSaveDc,
  stripDescriptionRollMarkers,
  withSpentSpellSlot,
  withSpentSpellUse,
} from '@vtt/shared/system/dnd.js';

import {
  recordEntityActionSpend,
  runWithWeaponAttackCost,
} from '../composables/actionSpend';
import { runWeaponAttackChoices } from '../composables/attackKindChoice';
import {
  resolveTargetedAttackRoll,
  resolveTargetedCritThreshold,
} from '../composables/attackRollMode';
import { startCreatureAction } from '../composables/creatureActionRoll';
import { startCreatureSpellCast } from '../composables/creatureSpellCast';
import { requestDamageTypeChoiceFor } from '../composables/damageTypeChoice';
import {
  applyEntityEffectUse,
  applyEntityItemUse,
  prepareAmmunitionShot,
  spendShotAmmunition,
} from '../composables/effectActivationUse';
import {
  readEntityCounters,
  toggleEntityEffect,
} from '../composables/effectToggle';
import { changeEntitySheet } from '../composables/entitySheetWrite';
import { buildRollBonusEvaluator } from '../composables/rollBonusEvaluator';
import { startSpellCast } from '../composables/spellCastFlow';
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
 * Запись существа без броска и без эффектов с горячей панели: что существо
 * сделало, — описанием в чат. Чат кнопок бросков не рисует, поэтому марки
 * `{@roll …}` снимаются.
 *
 * @param action - запись статблока
 */
function announceCreatureAction(action: CreatureAction): void {
  const description = action.description
    ? stripDescriptionRollMarkers(action.description.join(' '))
    : '';

  useChatStore().sendMessage(
    `<b>${action.name}</b><br/>${description}`,
    'text',
  );
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

      // Действие — общим путём действия существа, тем же, что у листа
      // существа: отказ — в чат, запись без броска и эффектов — описанием
      startCreatureAction(foundAction, {
        creatureId: foundCreature.id,
        section: findCreatureActionSection(foundCreature, foundAction),
        refuse: (_title, reason) => {
          refuseBlockedMacro(reason);
        },
        announce: announceCreatureAction,
      });
    } catch (err) {
      console.error('[Hotbar] Ошибка выполнения creature-action:', err);
    }
  });
}

/**
 * Списывает одно применение заклинания существа и персистит изменение
 * (локально + сокет).
 *
 * У группы «на весь список» счётчик один на всю группу и лежит у неё; у
 * остальных заряды считает само заклинание. Так же, как на листе существа —
 * иначе каст с хотбара расходился бы с кастом со вкладки.
 *
 * @param creatureId - существо-источник
 * @param spell - заклинание
 * @param placement - группа, из которой идёт каст
 */
function consumeCreatureSpellUse(
  creatureId: string,
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
  changeEntitySheet(creatureId, (current) => {
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
      spells: withSpentSpellUse(current.spells ?? [], spell.id),
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

      // Группа, из которой идёт каст: её числа, круг наложения и общий
      // счётчик применений главнее чисел самого существа
      const placement = findCreatureSpellPlacement(
        foundCreature.system.spellcastingBlocks,
        foundSpell.id,
      );

      // Каст — общим разбором существа, тем же, что у листа существа
      startCreatureSpellCast(foundSpell, placement, {
        creatureId: foundCreature.id,
        spendUse: (spell, spellPlacement) =>
          consumeCreatureSpellUse(foundCreature.id, spell, spellPlacement),
        refuse: (spell, refusal) => {
          useChatStore().sendMessage(
            `${MACRO_MESSAGE_LABELS.blockedPrefix}${spell.name}: ${refusal.description}`,
            'text',
          );
        },
      });
    } catch (err) {
      console.error('[Hotbar] Ошибка выполнения creature-spell:', err);
    }
  });
}
