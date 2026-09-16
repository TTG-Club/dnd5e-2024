import type { MeasurementTemplate, SceneEntity } from '@vtt/shared';
import type {
  AttackRollMode,
  CreatureAction,
  CreatureSpellPlacement,
  DnDActor,
  DnDCreature,
  DnDGameItem,
  RollContext,
  Spell,
} from '@vtt/shared/system/dnd.js';

import type { SpellCasterSource } from '../composables/spellCastCompletion';
import type { SpellEffectTargets } from '../composables/spellEffectTargeting';
import type {
  ProjectileAttackContext,
  RolledSpellDamagePart,
  SpellDamagePartInput,
} from '../composables/useSpellResolution';

import { emitEntityUpdate } from '@/core/entityUtils';
import { registerMacro } from '@/core/registries/macroRegistry';
import { useModalManager } from '@/shared_ui/composables/useModalManager';
import { useActionPromptStore } from '@/stores/actionPromptStore';
import { useChatStore } from '@/stores/chatStore';
import { useProjectileStore } from '@/stores/projectileStore';
import { useSpellTemplateStore } from '@/stores/spellTemplateStore';
import { useTargetStore } from '@/stores/targetStore';
import { useWorldStore } from '@/stores/worldStore';
/**
 * Регистрация макро-executor'ов, специфичных для D&D 5e.
 * Вся боевая логика (бросок атаки, двухэтапная атака, криты, урон) вынесена
 * в attackUtils.ts, а здесь остаётся только оркестрация и контекст выполнения макроса.
 */
import { generateId, isRecord } from '@vtt/shared';
import {
  buildFormulaContext,
  calculateCreatureSpellBlockNumbers,
  calculateSpellAttackModifier,
  calculateWeaponAttackModifier,
  checkRange,
  collectActiveEffects,
  consumeCreatureSpellGroupUse,
  damagePartIsHealing,
  describeDamagePart,
  evaluateConditionalBonuses,
  findCreatureSpellPlacement,
  formatConditionalDamageDisplay,
  getAttackBonusKey,
  getAttackFlagCategory,
  getAvailableSpellLevels,
  getCreatureSpellBlockAbility,
  getCreatureSpellMod,
  getCreatureSpellRollButtonText,
  getDamageBonusKey,
  getPactSlotInfo,
  getSpellAttackType,
  getSpellDamageParts,
  getSpellPrimaryDamageType,
  getSpellProjectileCount,
  getTotalLevel,
  getWeaponPrimaryDamageType,
  hasCreatureSpellGroupUsesLeft,
  isCreatureSpellPoolMode,
  isDndSceneEntity,
  isSaveAbility,
  mergeAppliedEffects,
  pickCantripTierParts,
  resolveActorStats,
  resolveCreatureSpellSaveDC,
  resolveDamagePartsForCast,
  resolveEntityCreatureType,
  resolveEntityCurrentHp,
  resolveEntityMaxHp,
  resolveSpellcastingAbility,
  resolveSpellDamageFormula,
  resolveSpellSaveDC,
  resolveWeaponSaveDc,
  SPELL_DAMAGE_TEMPLATE_COLORS,
  SPELL_TEMPLATE_DEFAULT_COLOR,
  spellHasDamage,
  spellIsHealing,
  targetHpGateMatches,
  withFlatDamageBonus,
  withFlatFormulaBonus,
} from '@vtt/shared/system/dnd.js';

import { resolveTargetedAttackRollMode } from '../composables/attackRollMode';
import {
  applyActionSelfEffects,
  prepareAmmunitionShot,
  spendShotAmmunition,
} from '../composables/effectActivationUse';
import { runWithEffectVariants } from '../composables/effectVariantChoice';
import {
  buildRollBonusEvaluator,
  collectProjectileRollBonuses,
} from '../composables/rollBonusEvaluator';
import {
  completeSpellCast,
  prepareCasterSpellEffects,
  SPELL_CAST_KEY_PREFIX,
} from '../composables/spellCastCompletion';
import { beginSpellCast } from '../composables/spellCasts';
import {
  applySpellTargetEffects,
  createProjectileCastValidator,
  needsSpellEffectTargets,
  requestSpellEffectTargets,
} from '../composables/spellEffectTargeting';
import {
  discardSpellTemplate,
  formatSpellEffectsMessage,
  getTargetSpellEffects,
  targetEffectsNeedResolution,
} from '../composables/spellResolutionShared';
import {
  useBonusDamageParts,
  withFlatDamageBonusPart,
} from '../composables/useBonusDamageParts';
import {
  collectEffectsWithAuras,
  listAmbientEffects,
} from '../composables/useResolvedStats';
import {
  getSpellMaxRangeOnScene,
  isSpellCastBlockedByRange,
  isSpellTargetBlockedByRange,
  measureTokenDistanceOnScene,
} from '../composables/useSceneRangeCheck';
import { useSpellResolution } from '../composables/useSpellResolution';
import { useWorldEntities } from '../composables/useWorldEntities';
import {
  ACTOR_SPELLS_TAB_LABELS,
  PROJECTILE_MODAL_KEY_PREFIX,
  SPELL_CAST_MODAL_KEY_PREFIX,
  SPELL_DAMAGE_ROLL_BUTTON,
  SPELL_MENU_LABELS,
} from '../ui/actor/constants';
import { checkCreatureActionRangeOnScene } from '../ui/creature/composables/useCreatureRangeCheck';
import { CREATURE_ACTIONS_BLOCK_LABELS } from '../ui/creature/constants';
import { MACRO_MESSAGE_LABELS } from './constants';

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
 * Вычисляет доступные круги заклинаний для каста.
 *
 * Вынесено из inline-объекта для избежания вложенного тернарника (no-nested-ternary).
 *
 * @param lockedLevel - фиксированный круг (если есть)
 * @param spellLevel - базовый круг заклинания
 * @param actor - актор-заклинатель
 */
function computeAvailableLevels(
  lockedLevel: number | undefined,
  spellLevel: number,
  actor: DnDActor,
): number[] {
  if (lockedLevel) {
    return [lockedLevel];
  }

  if (spellLevel > 0) {
    return getAvailableSpellLevels(actor, spellLevel);
  }

  return [];
}

/**
 * Определяет, находится ли цель на полном запасе HP (для токенов
 * `@target.full`/`@target.notFull`).
 *
 * Само правило «полные хиты» не своё: гейт считает `targetHpGateMatches` —
 * тот же, которым ветки урона решают, доходят ли они до цели. Второе сравнение
 * того же самого разошлось бы с первым при первой же правке правила.
 *
 * Потолок берётся С прибавкой эффектов (`hitPoints.max`) — тем же
 * `resolveEntityMaxHp`, что у плитки хитов листа, лечения и полосы над токеном.
 * По записи листа цель с «Крепким» или «Ложной жизнью» сходила бы за полную,
 * не долечившись до показанного максимума: запас листа у неё ниже потолка.
 *
 * @param entity - сущность-цель (или null, если цель не выбрана)
 * @returns true/false по состоянию HP, либо undefined если цели/HP нет
 */
function isTargetFullHp(entity: SceneEntity | null): boolean | undefined {
  if (!entity) {
    return undefined;
  }

  if (isDndSceneEntity(entity)) {
    return targetHpGateMatches(
      'full',
      resolveEntityCurrentHp(entity),
      resolveEntityMaxHp(entity),
    );
  }

  // Не D&D-форма: `system` ядра — непрозрачная запись, хиты читаются полем за
  // полем, и прибавку эффектов по ней не посчитать
  const hitPoints = isRecord(entity.system.hitPoints)
    ? entity.system.hitPoints
    : undefined;

  if (typeof hitPoints?.max !== 'number') {
    return undefined;
  }

  const current = typeof hitPoints.current === 'number' ? hitPoints.current : 0;

  return current >= hitPoints.max;
}

/**
 * Регистрирует все D&D 5e macro executor'ы в macroRegistry.
 * Вызывается один раз при монтировании сцены.
 */
export function registerDnd5eMacros(): void {
  registerMacro('weapon-attack', (macro, context) => {
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

      // Стрелковое оружие стреляет боеприпасом, если лист их ведёт
      const shot = prepareAmmunitionShot(result.actor, result.weapon);

      if (!shot) {
        return;
      }

      const ammunitionId = shot.ammunition?.id;

      runWithEffectVariants(shot.weapon, (foundWeapon) => {
        const foundActor = result.actor;

        // resolvedStats для @mod.* в формулах частей и статического урона
        const ambientEffects = listAmbientEffects(foundActor.id);

        const resolvedStats = resolveActorStats(foundActor, ambientEffects);

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
        const incomingAttackType = getAttackFlagCategory(foundWeapon.rangeType);

        const targetActor = targetStore.getTargetActor();

        const initialRollMode = resolveTargetedAttackRollMode(
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
        const targetIsFull = isTargetFullHp(targetActor);

        const weaponPartsSetup = buildWeaponRollSetup({
          weapon: foundWeapon,
          actor: foundActor,
          effects: combinedEffects,
          resolvedStats,
          targetIsFull,
          targetType: buildTargetTypeContext(),
        });

        /**
         * Применяет брошенные части урона оружия через многочастный оркестратор
         * (защиты по типу на каждую часть, per-target гейты, спасбросок оружия,
         * единый HP-апдейт).
         *
         * @param parts - брошенные части урона
         */
        function handleWeaponRollParts(parts: RolledSpellDamagePart[]): void {
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
              spell: weaponPartsSetup.pseudoSpell,
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
                () => useWorldEntities().findCurrentDndEntity(foundActor.id),
                attackKey,
              ),
          initialRollMode,
          critThreshold: resolvedStats.critThreshold,
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
            const formulaContext = buildFormulaContext(foundActor);

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
          damageType: getWeaponPrimaryDamageType(foundWeapon),
          damageParts: weaponPartsSetup.baseParts,
          evaluateBonusDamageParts: weaponPartsSetup.evaluateBonusDamageParts,
          // Эффекты «на цель» гейтит оркестратор (handleWeaponRollParts →
          // resolveSpellDamageWithParts по applySave/приземлению). Прямого onHit
          // нет — он вешал эффект на каждое попадание мимо спасброска.
          onRollParts: handleWeaponRollParts,
          // Расход одноразовых эффектов «следующей атаки» (Злая насмешка и т.п.)
          attackerId: foundActor.id,
          // Боеприпас тратится, когда бросок пошёл, а не при открытии окна
          beforeRoll: ammunitionId
            ? () => {
                spendShotAmmunition(foundActor.id, ammunitionId);

                return true;
              }
            : undefined,
        });
      });
    } catch (err) {
      console.error('[Hotbar] Ошибка выполнения weapon-attack:', err);
    }
  });

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

      runWithEffectVariants(result.spell, (spell) => {
        const { actor } = result;

        const availableLevels =
          spell.level > 0 ? getAvailableSpellLevels(actor, spell.level) : [0];

        if (spell.level > 0 && availableLevels.length === 0) {
          const chatStore = useChatStore();

          chatStore.sendMessage(
            `${CREATURE_ACTIONS_BLOCK_LABELS.outOfRangePrefix}${spell.name}${MACRO_MESSAGE_LABELS.noSlotsMiddle}${spell.level}${ACTOR_SPELLS_TAB_LABELS.noSlotsTextSuffix}`,
            'text',
          );

          return;
        }

        if (needsSpellEffectTargets(spell)) {
          requestSpellEffectTargets(
            spell,
            actor.id,
            availableLevels,
            (level, targets) => {
              castBuffSpellMacro(spell, actor, level, targets);
            },
          );

          return;
        }

        // Снарядный режим: число снарядов зависит от контекста каста
        // (заговоры — от уровня персонажа, уровневые — от круга ячейки)
        const casterLevel = getTotalLevel(actor.system?.classes);

        const baseProjectileCount = getSpellProjectileCount(spell, {
          slotLevel: availableLevels[0] ?? spell.level,
          casterLevel,
        });

        const hasProjectiles = baseProjectileCount > 1 && !spell.areaOfEffect;

        // Проверка дистанции каста до выбранной цели (только одиночная цель:
        // у AoE и снарядов собственные механики таргетинга)
        if (
          !spell.areaOfEffect
          && !hasProjectiles
          && isSpellCastBlockedByRange(spell, actor.id)
        ) {
          return;
        }

        // Если есть область действия — пропускаем зелёный prompt, сразу начинаем применять
        if (spell.areaOfEffect) {
          executeSpellCast(spell, actor);

          return;
        }

        if (hasProjectiles) {
          // Запускаем режим выбора целей (снарядов) с отдельным промптом
          const { openModal } = useModalManager();
          const projectileStore = useProjectileStore();

          projectileStore.startTargeting(
            spell.projectiles?.targetDistribution ?? null,
            baseProjectileCount,
            (tokenId) => !isSpellTargetBlockedByRange(spell, actor.id, tokenId),
          );

          openModal('ProjectilePromptModal', {
            _modalKey: `${PROJECTILE_MODAL_KEY_PREFIX}-${projectileStore.sessionId}`,
            targetingSessionId: projectileStore.sessionId,
            spell,
            casterLevel,
            availableSpellLevels: availableLevels,
            onConfirm: (selectedLevel: number) => {
              // Передаем зафиксированный уровень заклинания в executeSpellCast
              executeSpellCast(spell, actor, selectedLevel);
            },
          });

          return;
        }

        const promptStore = useActionPromptStore();
        const promptId = `spell-cast-${spell.id}-${Date.now()}`;

        promptStore.addPrompt({
          id: promptId,
          icon: 'tabler:wand',
          title: `Применить заклинание: ${spell.name}?`,
          color: 'neutral',
          actions: [
            {
              icon: 'tabler:check',
              color: 'primary',
              onClick: () => {
                promptStore.removePrompt(promptId);
                executeSpellCast(spell, actor);
              },
            },
            {
              icon: 'tabler:x',
              color: 'neutral',
              variant: 'ghost',
              onClick: () => {
                promptStore.removePrompt(promptId);
              },
            },
          ],
        });
      });
    } catch (err) {
      console.error('[Hotbar] Ошибка выполнения spell-cast:', err);
    }
  });

  registerCreatureActionMacro();
  registerCreatureSpellMacro();
}

/**
 * Выполняет каст заклинания после подтверждения в Action Prompt.
 *
 * @param spell - заклинание
 * @param actor - актор-владелец
 */
function executeSpellCast(
  spell: import('@vtt/shared/system/dnd.js').Spell,
  actor: DnDActor,
  lockedSpellLevel?: number,
): void {
  // Если есть область действия — сначала размещаем шаблон на сцене
  if (spell.areaOfEffect) {
    const templateStore = useSpellTemplateStore();

    const templateColor =
      SPELL_DAMAGE_TEMPLATE_COLORS[getSpellPrimaryDamageType(spell) ?? '']
      ?? SPELL_TEMPLATE_DEFAULT_COLOR;

    templateStore.requestPlacement(
      {
        ...spell.areaOfEffect,
        resizable: spell.areaOfEffect.resizable ?? false,
      },
      templateColor,
      actor.id,
      (templateId) => {
        const promptStore = useActionPromptStore();
        const promptId = `spell-confirm-${spell.id}-${Date.now()}`;

        promptStore.addPrompt({
          id: promptId,
          icon: 'tabler:wand',
          title: `Применить заклинание: ${spell.name}?`,
          color: 'neutral',
          actions: [
            {
              icon: 'tabler:check',
              color: 'primary',
              onClick: () => {
                promptStore.removePrompt(promptId);

                // Кэшируем данные шаблона ДО удаления — они нужны для определения целей
                const cachedTemplate =
                  templateStore.getPlacedTemplate(templateId);

                // Очищаем кэш шаблона (данные уже сохранены в cachedTemplate)
                templateStore.removePlacedTemplate(templateId);
                // Удаляем визуальный шаблон с карты
                templateStore.deleteTemplate(templateId);
                // Открываем окно кубиков для броска урона/атаки
                openDiceRollForSpell(spell, actor, cachedTemplate);
              },
            },
            {
              icon: 'tabler:x',
              color: 'neutral',
              variant: 'ghost',
              onClick: () => {
                promptStore.removePrompt(promptId);
                // Удаляем шаблон так как пользователь отменил заклинание
                templateStore.deleteTemplate(templateId);
              },
            },
          ],
        });
      },
      getSpellMaxRangeOnScene(spell),
    );

    return;
  }

  // Без AoE — сразу открываем DiceRollModal
  openDiceRollForSpell(spell, actor, undefined, lockedSpellLevel);
}

/**
 * Открывает DiceRollModal для заклинания.
 *
 * @param spell - заклинание
 * @param actor - актор-владелец
 * @param cachedTemplate - кэшированные данные шаблона для определения целей
 */
function openDiceRollForSpell(
  spell: import('@vtt/shared/system/dnd.js').Spell,
  actor: DnDActor,
  cachedTemplate?: MeasurementTemplate,
  lockedSpellLevel?: number,
): void {
  // Проверяем наличие снарядов (до открытия модалки): число снарядов зависит
  // от контекста каста — круга ячейки (уровневые) или уровня персонажа (заговоры)
  const casterLevel = getTotalLevel(actor.system?.classes);

  const projectileCount = getSpellProjectileCount(spell, {
    slotLevel: lockedSpellLevel ?? spell.level,
    casterLevel,
  });

  const hasProjectiles =
    projectileCount > 1 && !spell.areaOfEffect && !cachedTemplate;

  // Окно броска открываем, если есть урон/лечение, РЕАЛЬНЫЙ бросок атаки
  // (getSpellAttackType === undefined при автопопадании — тогда броска нет даже
  // у melee/ranged доставки) или спасбросок. Иначе — путь самобаффа/наложения
  // эффекта без броска (castBuffSpellMacro).
  if (
    spellHasDamage(spell)
    || getSpellAttackType(spell)
    || spell.saveType !== 'none'
  ) {
    const { openModal } = useModalManager();
    const worldStore = useWorldStore();

    const {
      needsAutoResolution,
      resolveSpellDamage,
      resolveSpellDamageWithParts,
    } = useSpellResolution();

    // Итоговые статы с учётом Active Effects — нужны и для @mod.spell в формуле
    // урона (внешние бонусы к стату), и для бонуса атаки заклинанием.
    const resolvedStats = resolveActorStats(actor, []);

    // Сл этого заклинания, а не листа: у заклинания бывает своя характеристика
    const spellSaveDc = resolveSpellSaveDC(actor, spell, resolvedStats);

    const casterSource: SpellCasterSource = {
      saveDc: spellSaveDc,
      spellMod:
        resolvedStats.abilityMods[resolveSpellcastingAbility(actor, spell)],
    };

    const castKey = generateId(SPELL_CAST_KEY_PREFIX);

    beginSpellCast(actor.id, spell, castKey);

    /**
     * Доводит каст: конец прежней концентрации, эффекты на заклинателе, зона на
     * месте шаблона. Ключ отсекает повторное применение того же каста.
     */
    const finishCast = (): void => {
      completeSpellCast({
        spell,
        caster: useWorldEntities().findCurrentDndEntity(actor.id) ?? actor,
        source: casterSource,
        template: cachedTemplate,
        applyCasterEffects: true,
        castKey,
      });
    };

    // Выбранная цель (если есть) — для @target-токенов. Кидать ли бросок
    // атаки, решает DiceRollModal по наличию цели в момент броска: без цели
    // заклинание-атака просто катит урон «в пустоту».
    const selectedTargetActor = useTargetStore().getTargetActor();

    // Состояние HP выбранной цели для токенов @target.full/@target.notFull.
    // Для AoE / без цели — undefined: части раскладываются на гейт-ветки
    // (targetGate), и оркестратор выбирает ветку по HP каждой цели (per-target).
    const targetIsFull = spell.areaOfEffect
      ? undefined
      : isTargetFullHp(selectedTargetActor);

    // Тип цели — для токенов @target.type.<тип>. Как и состояние хитов, читается
    // только у одиночной цели: у области тип проверяется по каждой цели отдельно
    const targetType =
      spell.areaOfEffect
      || !selectedTargetActor
      || !isDndSceneEntity(selectedTargetActor)
        ? undefined
        : resolveEntityCreatureType(selectedTargetActor);

    // Масштабирование заговора: на пороге уровня тир целиком заменяет базовые
    // части урона (см. cantripScalingTiers). Авто-умножение кубиков отключено.
    const spellDamageParts =
      spell.level === 0
        ? (pickCantripTierParts(spell, casterLevel)
          ?? getSpellDamageParts(spell))
        : getSpellDamageParts(spell);

    // Legacy одиночная формула (снаряды/одночастный путь): первая часть, с
    // разрешёнными @-переменными (@dmg-токены снимаются внутри resolve).
    const firstPartFormula = spellDamageParts[0]?.formula ?? '';

    /** Плоский бонус эффектов к урону заклинаниями (`damage.spell`) */
    const flatSpellDamageBonus = resolvedStats.damageBonuses.spell;

    // Снарядам бонус в формулу не вливается — она катается на каждый снаряд;
    // им он едет отдельной бонус-частью ниже (см. withFlatDamageBonusPart)
    const formulaFlatBonus =
      hasProjectiles || spellIsHealing(spell) ? 0 : flatSpellDamageBonus;

    const resolvedDamageFormula = withFlatFormulaBonus(
      resolveSpellDamageFormula(
        spell,
        actor,
        firstPartFormula,
        resolvedStats,
        targetIsFull,
        targetType,
      ),
      formulaFlatBonus,
    );

    // Превью формулы для модалки. Когда состояние цели неизвестно (нет цели / AoE)
    // и в части есть взаимоисключающие ветки @target.full/@target.notFull —
    // показываем их через «или» (а не суммируем через «+», как делает strip).
    // Если цель выбрана, targetIsFull известен → resolvedDamageFormula уже содержит
    // нужную ветку, отдельное превью не нужно.
    const damageFormulaForDisplay =
      targetIsFull === undefined && /@target\./i.test(firstPartFormula)
        ? formatConditionalDamageDisplay(firstPartFormula, (subFormula) =>
            resolveSpellDamageFormula(spell, actor, subFormula, resolvedStats),
          )
        : undefined;

    // --- Многочастный путь (несколько частей / нестандартный таргетинг) ---
    // Включая заклинания-атаки: модалка делает бросок попадания, затем части.
    // Исключены только снаряды (своя логика распределения).

    // Кость-формулы бонус-урона заклинаний (damage.spell) в Active Effects
    // катаются отдельными частями — каст идёт многочастным путём даже для
    // одночастного заклинания. Учитываются и ambient-эффекты аур на карте
    // (напр. аура союзника, дающая бонус-урон заклинаниям).
    const { hasSpellBonusDamage, buildSpellBonusEvaluator } =
      useBonusDamageParts();

    const spellEffects = collectEffectsWithAuras(actor);

    const hasBonusDamage = hasSpellBonusDamage(spellEffects);

    // Эффекты заклинания, предназначенные цели (effectTarget 'target')
    const hasSpellTargetEffects = getTargetSpellEffects(spell).length > 0;

    // Атака с уроном, чьим эффектам на цель нужен разбор (свой спасбросок, урон
    // эффекта), тоже идёт многочастным путём: урон заклинания и эффекты ложатся
    // ОДНОЙ записью. По попаданию (onHit) разбор ждал бы окна спасброска эффекта,
    // а урон модалки успевал бы записаться раньше и затирался бы
    const useMultiPart =
      !hasProjectiles
      && (hasBonusDamage
        || spellDamageParts.length > 1
        || (spellDamageParts.length > 0
          && getSpellAttackType(spell) !== undefined
          && targetEffectsNeedResolution(spell))
        || spellDamageParts.some(
          (part) =>
            (part.target ?? 'selected') !== 'selected'
            || part.requiresDamage
            || /@dmg\./i.test(part.formula)
            || /@heal/i.test(part.formula)
            || /@target\./i.test(part.formula),
        ));

    // Плоский бонус эффектов к урону заклинаниями (`damage.spell`) вливается в
    // первую урон-часть — так же, как статический бонус оружия
    const resolvedParts: SpellDamagePartInput[] = useMultiPart
      ? withFlatDamageBonus(
          resolveDamagePartsForCast(
            spell,
            actor,
            spellDamageParts,
            resolvedStats,
            targetIsFull,
            targetType,
          ),
          flatSpellDamageBonus,
        )
      : [];

    // Roll-time сборщик бонус-частей: условия (преимущество/помеха, HP цели)
    // оцениваются в момент броска по фактическому режиму из модалки.
    // Снаряды остаются на одноформульном пути, но бонус-части получают:
    // они катаются один раз на каст и применяются каждой задетой цели
    // (per-target гейты, см. resolveSpellDamage).
    const evaluateSpellBonusParts =
      useMultiPart || (hasProjectiles && hasBonusDamage)
        ? buildSpellBonusEvaluator({
            spell,
            actor,
            effects: spellEffects,
            resolvedStats,
            multiTarget:
              spell.areaOfEffect !== undefined
              || cachedTemplate !== undefined
              || hasProjectiles,
          })
        : undefined;

    /** Обработчик многочастного броска: применяет части через оркестратор. */
    function handleSpellRollParts(parts: RolledSpellDamagePart[]): void {
      finishCast();

      const scene = worldStore.currentScene;
      const chatStore = useChatStore();
      const socket = chatStore.getSocket();
      const worldId = worldStore.connectionState.currentWorldId;

      if (!worldId || !socket) {
        return;
      }

      const world = worldStore.worlds.find(
        (worldEntry) => worldEntry.id === worldId,
      );

      const actors = [...(world?.actors ?? []), ...(world?.creatures ?? [])];

      if (actors.length === 0) {
        return;
      }

      void resolveSpellDamageWithParts(
        {
          spell,
          damageTotal: 0,
          spellSaveDC: spellSaveDc,
          actors,
          socket,
          casterId: actor.id,
        },
        parts,
        { scene, cachedTemplate },
      );
    }

    const incomingAttackType = getSpellAttackType(spell);

    // Полный бонус атаки заклинанием: мод характеристики (итоговый) +
    // мастерство + attack.spell + доп. бонус заклинания.
    const baseMod = incomingAttackType
      ? calculateSpellAttackModifier(actor, spell, resolvedStats)
      : 0;

    let rollButtonText = 'Бросить урон';

    if (incomingAttackType) {
      rollButtonText = 'Бросить атаку';
    } else if (spellDamageParts.some((part) => damagePartIsHealing(part))) {
      rollButtonText = 'Лечение';
    }

    /** Нужно ли пропустить автоприменение урона в модалке (обработка делегирована resolveSpellTargets) */
    const shouldSkipModalDamage = needsAutoResolution(spell, hasProjectiles);

    // Определяем наличие и уровень Pact-слота
    const pactInfo = getPactSlotInfo(actor.system?.classes ?? []);
    const pactSlotLevel = pactInfo.level;

    const projectileStore = useProjectileStore();

    if (hasProjectiles && !projectileStore.isActive) {
      projectileStore.startTargeting(
        spell.projectiles?.targetDistribution ?? null,
        projectileCount,
        (tokenId) => !isSpellTargetBlockedByRange(spell, actor.id, tokenId),
      );
    }

    const isCurrentProjectileCast =
      createProjectileCastValidator(hasProjectiles);

    /**
     * Обработчик подтверждения броска — применяет урон к целям.
     */
    function handleSpellRoll(
      damageTotal: number,
      chosenDamageType?: string,
    ): void {
      finishCast();

      // Эффекты на цель без урона тоже требуют резолва (спасбросок у
      // save-заклинаний), поэтому пускаем резолв и при наличии target-эффектов.
      if (
        !needsAutoResolution(spell, hasProjectiles)
        || (damageTotal <= 0 && !hasSpellTargetEffects)
      ) {
        return;
      }

      const scene = worldStore.currentScene;
      const chatStore = useChatStore();
      const socket = chatStore.getSocket();

      const worldId = worldStore.connectionState.currentWorldId;

      if (!worldId) {
        return;
      }

      const world = worldStore.worlds.find(
        (worldEntry) => worldEntry.id === worldId,
      );

      const actors = [...(world?.actors ?? []), ...(world?.creatures ?? [])];

      if (actors.length === 0 || !socket) {
        return;
      }

      const context = {
        spell,
        damageTotal,
        spellSaveDC: spellSaveDc,
        actors,
        socket,
        casterId: actor.id,
        overrideDamageType: chosenDamageType,
      };

      // Бонус-части для снарядов собираются здесь (в момент подтверждения
      // броска): снаряды autoHit — броска атаки нет, поэтому преимущество/
      // помеха не определены (false); HP-условия отложены в per-target гейты.
      // Плоский бонус заклинаниям едет здесь же отдельной частью: она катается
      // один раз на каст, а не на каждый снаряд
      const projectileBonusParts = hasProjectiles
        ? withFlatDamageBonusPart(
            evaluateSpellBonusParts?.({
              hasAdvantage: false,
              hasDisadvantage: false,
            }) ?? [],
            spellIsHealing(spell) ? 0 : flatSpellDamageBonus,
          )
        : undefined;

      resolveSpellDamage(context, {
        hasProjectiles,
        resolvedDamageFormula,
        scene,
        cachedTemplate,
        bonusDamageParts: projectileBonusParts,
      });
    }

    /**
     * Обработчик серии атак снарядов (Мистический заряд, Палящий луч):
     * модалка отдаёт контекст броска, по броску попадания на каждый снаряд
     * выполняет resolveSpellDamage. Бонус-части эффектов собираются с
     * фактическим режимом преимущества/помехи и катаются на каждое попадание.
     */
    function handleProjectileAttackRoll(
      rollContext: Omit<ProjectileAttackContext, 'attackType'>,
    ): void {
      if (!incomingAttackType) {
        return;
      }

      const scene = worldStore.currentScene;
      const chatStore = useChatStore();
      const socket = chatStore.getSocket();
      const worldId = worldStore.connectionState.currentWorldId;

      if (!worldId || !socket) {
        return;
      }

      const world = worldStore.worlds.find(
        (worldEntry) => worldEntry.id === worldId,
      );

      const actors = [...(world?.actors ?? []), ...(world?.creatures ?? [])];

      if (actors.length === 0) {
        return;
      }

      // Серия атак (Мистический заряд, Палящий луч): каждый луч — СВОЙ бросок
      // атаки и свой бросок урона, поэтому плоский бонус получает каждый из
      // них. Правило «один раз к броску» тут и соблюдается: бросков несколько.
      // Отличие от автопопаданий (Волшебная стрела) — там бросок урона один на
      // каст, и бонус там начисляется однократно.
      const projectileBonusParts = withFlatDamageBonusPart(
        evaluateSpellBonusParts?.({
          hasAdvantage: rollContext.rollMode === 'advantage',
          hasDisadvantage: rollContext.rollMode === 'disadvantage',
        }) ?? [],
        spellIsHealing(spell) ? 0 : flatSpellDamageBonus,
      );

      resolveSpellDamage(
        {
          spell,
          damageTotal: 0,
          spellSaveDC: spellSaveDc,
          actors,
          socket,
          casterId: actor.id,
        },
        {
          hasProjectiles: true,
          resolvedDamageFormula,
          scene,
          projectileAttack: {
            attackModifier: rollContext.attackModifier,
            rollMode: rollContext.rollMode,
            bonusDiceFormulasByTarget: rollContext.bonusDiceFormulasByTarget,
            attackType: incomingAttackType,
          },
          bonusDamageParts: projectileBonusParts,
        },
      );
    }

    const spellInitialRollMode: AttackRollMode = incomingAttackType
      ? resolveTargetedAttackRollMode(actor, 'spell')
      : 'normal';

    const evaluateAttackBonusRollFormulas = incomingAttackType
      ? buildRollBonusEvaluator(
          () => useWorldEntities().findCurrentDndEntity(actor.id),
          'attack.spell',
        )
      : undefined;

    openModal('DiceRollModal', {
      _modalKey: generateId(SPELL_CAST_MODAL_KEY_PREFIX),
      title: `Заклинание — ${spell.name}`,
      rollLabel: spell.name,
      rollButtonText,
      formula: resolvedDamageFormula,
      formulaDisplay: damageFormulaForDisplay,
      attackModifier: incomingAttackType ? baseMod : undefined,
      evaluateBonusRollFormulas: hasProjectiles
        ? undefined
        : evaluateAttackBonusRollFormulas,
      evaluateProjectileBonusRollFormulas:
        hasProjectiles && evaluateAttackBonusRollFormulas
          ? (context: RollContext) =>
              collectProjectileRollBonuses(
                context,
                evaluateAttackBonusRollFormulas,
              )
          : undefined,
      incomingAttackType,
      initialRollMode: spellInitialRollMode,
      isHealing: spellIsHealing(spell),
      damageType: getSpellPrimaryDamageType(spell),
      skipDamageApplication: shouldSkipModalDamage,
      skipChatMessage: hasProjectiles,
      onRoll: handleSpellRoll,
      beforeRoll: isCurrentProjectileCast,

      // Атакующее заклинание-эффект (без многочастного пути): эффекты на цель
      // вешаем по ПОПАДАНИЮ. Многочастные уронные накладывают их сами.
      onHit:
        incomingAttackType && hasSpellTargetEffects && !useMultiPart
          ? () =>
              applySpellTargetEffects(spell, {
                casterId: actor.id,
                spellSaveDC: spellSaveDc,
              })
          : undefined,

      // Расход одноразовых эффектов «следующей атаки» на броске атаки заклинанием
      attackerId: actor.id,

      // Атакующие снаряды: модалка отдаёт контекст, серию бросков выполняет
      // resolveSpellDamage (бросок попадания на каждый снаряд)
      onProjectileAttack:
        hasProjectiles && incomingAttackType
          ? handleProjectileAttackRoll
          : undefined,

      // Многочастный путь (если активен) — модалка катает части и зовёт onRollParts
      damageParts: useMultiPart ? resolvedParts : undefined,
      onRollParts: useMultiPart ? handleSpellRollParts : undefined,
      // Снарядам бонус-части катает resolveSpellDamage, а не модалка
      evaluateBonusDamageParts: useMultiPart
        ? evaluateSpellBonusParts
        : undefined,

      // Секция круга заклинания
      spellLevel:
        lockedSpellLevel ?? (spell.level > 0 ? spell.level : undefined),
      availableSpellLevels: computeAvailableLevels(
        lockedSpellLevel,
        spell.level,
        actor,
      ),
      spellScalingDice: spell.scaling?.additionalDice,
      pactSlotLevel,
      onSpellSlotConsume: (
        castLevel: number,
        consumeSlot: boolean,
        isPactSlot: boolean,
      ) => {
        if (!consumeSlot || castLevel <= 0) {
          return;
        }

        const worldId = worldStore.connectionState.currentWorldId;

        if (!worldId) {
          return;
        }

        const chatStore = useChatStore();
        const socket = chatStore.getSocket();

        // Deep clone для отправки через сокет без реактивных прокси
        const updatedActor: DnDActor = JSON.parse(JSON.stringify(actor));

        if (isPactSlot) {
          const newPactUsed = (actor.system?.pactSlotsUsed ?? 0) + 1;

          const pactUpdate: Partial<DnDActor> = {
            system: {
              ...actor.system,
              pactSlotsUsed: newPactUsed,
            },
          };

          worldStore.updateActor(worldId, actor.id, pactUpdate);

          if (updatedActor.system) {
            updatedActor.system.pactSlotsUsed = newPactUsed;
          }
        } else {
          const index = castLevel - 1;

          const newUsed = [
            ...(actor.system?.spellSlotsUsed ?? [0, 0, 0, 0, 0, 0, 0, 0, 0]),
          ];

          newUsed[index] = (newUsed[index] ?? 0) + 1;

          const slotUpdate: Partial<DnDActor> = {
            system: {
              ...actor.system,
              spellSlotsUsed: newUsed,
            },
          };

          worldStore.updateActor(worldId, actor.id, slotUpdate);

          if (updatedActor.system) {
            updatedActor.system.spellSlotsUsed = newUsed;
          }
        }

        if (socket) {
          emitEntityUpdate(socket, updatedActor);
        }
      },
    });
  } else {
    // Заклинание без урона/атаки (самобафф вроде Щита): списываем ячейку
    // (для уровневых) и накладываем эффекты на самого заклинателя.
    castBuffSpellMacro(
      spell,
      actor,
      lockedSpellLevel,
      undefined,
      cachedTemplate,
    );
  }
}

/**
 * Каст заклинания без урона и без реального броска атаки (самобафф вроде Щита,
 * либо наложение эффекта на цель при автопопадании) через макрос хотбара. Для
 * уровневых не-врождённых открывает окно выбора ячейки и кладёт self-эффекты
 * заклинателю тем же обновлением сущности, что и списание ячейки (без гонки
 * эмитов). Эффекты с effectTarget 'target' ложатся на цели, выбранные для
 * этого каста, а без них — на выбранную цель.
 *
 * @param spell - заклинание
 * @param actor - актор-заклинатель
 * @param lockedSpellLevel - зафиксированный круг (если задан)
 * @param effectTargets - цели эффекта, выбранные перед кастом; их актуальность
 * проверяется ещё раз до списания ячейки
 * @param cachedTemplate - шаблон заклинания с областью: на его месте остаётся
 * зона («Туманное облако», «Тьма»)
 */
function castBuffSpellMacro(
  spell: Spell,
  actor: DnDActor,
  lockedSpellLevel?: number,
  effectTargets?: SpellEffectTargets,
  cachedTemplate?: MeasurementTemplate,
): void {
  const isInnate = !!spell.uses;
  const casterStats = resolveActorStats(actor);

  beginSpellCast(actor.id, spell, generateId(SPELL_CAST_KEY_PREFIX));

  // Кто накладывает эффекты: Сл 0 эффекта и его спасбросок считаются от
  // заклинателя — и на цели, и на нём самом, и в зоне
  const casterSource: SpellCasterSource = {
    saveDc: resolveSpellSaveDC(actor, spell, casterStats),
    spellMod: casterStats.abilityMods[resolveSpellcastingAbility(actor, spell)],
  };

  const targetEffectsSource = {
    casterId: actor.id,
    spellSaveDC: casterSource.saveDc,
  };

  const casterEffects = prepareCasterSpellEffects(spell, actor, casterSource);

  const worldStore = useWorldStore();
  const chatStore = useChatStore();

  /**
   * Добавляет эффекты заклинания к клону актёра и шлёт анонс в чат.
   *
   * @param target - клон актёра-заклинателя для отправки
   */
  const appendEffects = (target: DnDActor): void => {
    if (casterEffects.length === 0) {
      return;
    }

    if (!target.activeEffects) {
      target.activeEffects = [];
    }

    // Само-баффы не стакаются: повтор ЗАМЕНЯЕТ/обновляет прежний (5e 2024).
    // Копии уже с Сл и точной длительностью хода заклинателя
    target.activeEffects = mergeAppliedEffects(
      target.activeEffects,
      casterEffects,
    );

    chatStore.sendMessage(
      formatSpellEffectsMessage(spell.name, [actor.name], casterEffects),
      'text',
    );
  };

  // Уровневые (не врождённые): окно выбора круга. Списание ячейки и эффекты —
  // одним обновлением сущности.
  if (spell.level > 0 && !isInnate) {
    const { openModal } = useModalManager();
    const pactInfo = getPactSlotInfo(actor.system?.classes ?? []);

    openModal('DiceRollModal', {
      _modalKey: generateId(SPELL_CAST_MODAL_KEY_PREFIX),
      title: `Заклинание — ${spell.name}`,
      rollLabel: spell.name,
      rollButtonText: SPELL_MENU_LABELS.cast,
      skipRoll: true,
      beforeRoll: effectTargets?.validate,
      spellLevel: lockedSpellLevel ?? spell.level,
      availableSpellLevels: computeAvailableLevels(
        lockedSpellLevel,
        spell.level,
        actor,
      ),
      pactSlotLevel: pactInfo.level,
      onSpellSlotConsume: (
        castLevel: number,
        consumeSlot: boolean,
        isPactSlot: boolean,
      ) => {
        const worldId = worldStore.connectionState.currentWorldId;

        if (!worldId) {
          return;
        }

        const socket = chatStore.getSocket();

        // Между выбором целей и ячейки лист мог измениться на другом клиенте.
        const latestEntity = useWorldEntities().findCurrentDndEntity(actor.id);

        const castingActor =
          effectTargets && latestEntity?.entityType === 'actor'
            ? latestEntity
            : actor;

        const updatedActor: DnDActor = JSON.parse(JSON.stringify(castingActor));

        if (consumeSlot && castLevel > 0 && updatedActor.system) {
          if (isPactSlot) {
            updatedActor.system.pactSlotsUsed =
              (castingActor.system?.pactSlotsUsed ?? 0) + 1;
          } else {
            const index = castLevel - 1;

            const newUsed = [
              ...(castingActor.system?.spellSlotsUsed ?? [
                0, 0, 0, 0, 0, 0, 0, 0, 0,
              ]),
            ];

            newUsed[index] = (newUsed[index] ?? 0) + 1;
            updatedActor.system.spellSlotsUsed = newUsed;
          }
        }

        appendEffects(updatedActor);

        // Локальный стор + сервер одним полным обновлением сущности
        worldStore.updateActor(worldId, actor.id, {
          system: updatedActor.system,
          activeEffects: updatedActor.activeEffects,
        });

        if (socket) {
          emitEntityUpdate(socket, updatedActor);
        }

        // Эффекты на выбранную цель (effectTarget 'target') — отдельной
        // сущности, отдельным обновлением (без гонки с апдейтом кастера).
        applySpellTargetEffects(spell, targetEffectsSource, effectTargets);

        completeSpellCast({
          spell,
          caster: castingActor,
          source: casterSource,
          template: cachedTemplate,
          applyCasterEffects: false,
        });
      },
    });

    return;
  }

  // Заговоры/врождённые — без ячеек: применяем эффекты (на себя и/или на цель)
  const worldId = worldStore.connectionState.currentWorldId;

  if (worldId && casterEffects.length > 0) {
    const socket = chatStore.getSocket();
    const updatedActor: DnDActor = JSON.parse(JSON.stringify(actor));

    appendEffects(updatedActor);

    worldStore.updateActor(worldId, actor.id, {
      activeEffects: updatedActor.activeEffects,
    });

    if (socket) {
      emitEntityUpdate(socket, updatedActor);
    }
  }

  applySpellTargetEffects(spell, targetEffectsSource, effectTargets);

  completeSpellCast({
    spell,
    caster: actor,
    source: casterSource,
    template: cachedTemplate,
    applyCasterEffects: false,
  });
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

      runWithEffectVariants(foundAction, (action) => {
        const hasAttackParams = !!(
          action.attackBonus !== undefined
          || action.damageParts?.length
          || isSaveAbility(action.saveType)
        );

        if (!hasAttackParams) {
          const chatStore = useChatStore();

          const description = action.description
            ? action.description.join(' ')
            : '';

          chatStore.sendMessage(
            `<b>${action.name}</b><br/>${description}`,
            'text',
          );

          applyActionSelfEffects(action, foundCreature.id);

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

        // Область: размещаем шаблон у токена существа, затем кидаем урон
        if (action.areaOfEffect) {
          const templateStore = useSpellTemplateStore();
          const first = action.damageParts?.[0];

          const primaryType = first
            ? describeDamagePart(first).types[0]
            : undefined;

          const color =
            SPELL_DAMAGE_TEMPLATE_COLORS[primaryType ?? '']
            ?? SPELL_TEMPLATE_DEFAULT_COLOR;

          templateStore.requestPlacement(
            action.areaOfEffect,
            color,
            foundCreature.id,
            (templateId) =>
              openCreatureActionRoll(
                foundCreature,
                action,
                isDisadvantage,
                templateId,
              ),
            null,
          );

          return;
        }

        openCreatureActionRoll(
          foundCreature,
          action,
          isDisadvantage,
          undefined,
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
 */
function openCreatureActionRoll(
  creature: DnDCreature,
  action: CreatureAction,
  isDisadvantage: boolean,
  templateId: string | undefined,
): void {
  const { openModal } = useModalManager();

  const { buildCreatureRollSetup, buildTargetHpContext } =
    useBonusDamageParts();

  const usesSaveOrArea =
    (!!action.saveType && action.saveType !== 'none') || !!action.areaOfEffect;

  const effects = collectActiveEffects(creature);

  const targetHp = action.areaOfEffect ? undefined : buildTargetHpContext();

  const targetIsFull = targetHp
    ? targetHp.currentHp >= targetHp.maxHp
    : undefined;

  const setup = buildCreatureRollSetup({
    action,
    creature,
    effects,
    targetIsFull,
    targetType: targetHp?.creatureType,
  });

  const enabledEffects = action.activeEffects?.filter(
    (effect) => !effect.disabled,
  );

  // Эффекты применяет оркестратор per-target (гейт по applySave/приземлению) —
  // одинаково для атак и для спас/области. Прямое onHit-применение УБРАНО: оно
  // вешало эффект на КАЖДОЕ попадание, игнорируя «Спасбросок при наложении»
  // (баг проявлялся только при запуске действия с хотбара).
  setup.pseudoSpell.activeEffects = enabledEffects?.length
    ? enabledEffects
    : undefined;

  const first = action.damageParts?.[0];
  const damageType = first ? describeDamagePart(first).types[0] : undefined;

  const actionRollMode: AttackRollMode = usesSaveOrArea
    ? 'normal'
    : resolveTargetedAttackRollMode(
        creature,
        getAttackFlagCategory(action.rangeType),
        { forceDisadvantage: isDisadvantage },
      );

  openModal('DiceRollModal', {
    title: usesSaveOrArea ? action.name : `Атака — ${action.name}`,
    rollLabel: action.name,
    rollButtonText: usesSaveOrArea ? 'Бросить урон' : 'Атаковать',
    formula: setup.baseParts[0]?.formula ?? '',
    attackModifier: usesSaveOrArea ? undefined : action.attackBonus,
    evaluateBonusRollFormulas: usesSaveOrArea
      ? undefined
      : buildRollBonusEvaluator(
          () => useWorldEntities().findCurrentDndEntity(creature.id),
          getAttackBonusKey(action.rangeType),
        ),
    initialRollMode: actionRollMode,
    incomingAttackType: getAttackFlagCategory(action.rangeType),
    damageType,
    damageParts: setup.baseParts,
    evaluateBonusDamageParts: setup.evaluateBonusDamageParts,
    onRollParts: (parts: RolledSpellDamagePart[]) =>
      applyCreatureActionParts(
        creature,
        action,
        setup.pseudoSpell,
        parts,
        templateId,
      ),
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

  const worldStore = useWorldStore();
  const chatStore = useChatStore();
  const worldId = worldStore.connectionState.currentWorldId;

  if (!worldId) {
    return;
  }

  const patch: Partial<DnDCreature> = {};

  if (isPool && placement) {
    patch.system = {
      ...creature.system,
      spellcastingBlocks: consumeCreatureSpellGroupUse(
        creature.system.spellcastingBlocks ?? [],
        placement.group.id,
      ),
    };
  } else {
    patch.spells = (creature.spells ?? []).map((entry) =>
      entry.id === spell.id && entry.uses
        ? {
            ...entry,
            uses: {
              ...entry.uses,
              current: Math.max(0, entry.uses.current - 1),
            },
          }
        : entry,
    );
  }

  worldStore.updateCreature(worldId, creature.id, patch);

  const socket = chatStore.getSocket();

  if (socket) {
    const updatedCreature: DnDCreature = { ...creature, ...patch };

    emitEntityUpdate(socket, updatedCreature);
  }
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

      runWithEffectVariants(foundSpell, (spell) => {
        const chatStore = useChatStore();

        // Группа, из которой идёт каст: её числа, круг наложения и общий счётчик
        // применений главнее чисел самого существа
        const placement = findCreatureSpellPlacement(
          foundCreature.system.spellcastingBlocks,
          spell.id,
        );

        const isGroupEmpty =
          placement !== undefined
          && !hasCreatureSpellGroupUsesLeft(placement.group);

        const isSpellEmpty =
          !!spell.uses
          && spell.uses.recovery !== 'atWill'
          && spell.uses.current <= 0;

        if (isGroupEmpty || isSpellEmpty) {
          chatStore.sendMessage(
            `⛔ ${spell.name}: не осталось зарядов — нужен отдых.`,
            'text',
          );

          return;
        }

        consumeCreatureSpellUse(foundCreature, spell, placement);

        // Область: размещаем шаблон у токена существа, затем кидаем урон
        if (spell.areaOfEffect) {
          const templateStore = useSpellTemplateStore();
          const first = spell.damageParts?.[0];

          const primaryType = first
            ? describeDamagePart(first).types[0]
            : undefined;

          const color =
            SPELL_DAMAGE_TEMPLATE_COLORS[primaryType ?? '']
            ?? SPELL_TEMPLATE_DEFAULT_COLOR;

          templateStore.requestPlacement(
            spell.areaOfEffect,
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
      });
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

  const enabledEffects = spell.activeEffects?.filter(
    (effect) => !effect.disabled,
  );

  // Эффекты заклинания — всегда через оркестратор: он отбирает эффекты на цель,
  // бросает их спасбросок и урон. Прямое наложение при попадании кидало на цель
  // ВСЕ эффекты (и «себе») мимо спасброска
  setup.pseudoSpell.activeEffects = enabledEffects?.length
    ? enabledEffects
    : undefined;

  const isHealing = spellIsHealing(spell);
  const first = spell.damageParts?.[0];
  const damageType = first ? describeDamagePart(first).types[0] : undefined;

  const numbers = calculateCreatureSpellBlockNumbers(
    creature,
    placement?.block,
  );

  // Существо как заклинатель: Сл блока и модификатор его характеристики.
  // Своя Сл заклинания (жезл, свиток) главнее Сл блока
  const casterSource: SpellCasterSource = {
    saveDc: resolveCreatureSpellSaveDC(spell, numbers.saveDC),
    spellMod: getCreatureSpellMod(
      creature,
      getCreatureSpellBlockAbility(creature, placement?.block),
    ),
  };

  const castKey = generateId(SPELL_CAST_KEY_PREFIX);

  beginSpellCast(creature.id, spell, castKey);

  // Атака без частей урона: окно броска не зовёт `onRollParts`, и эффекты на
  // попадании разбирает тот же оркестратор с пустым набором частей
  const onHit =
    usesAttack
    && setup.baseParts.length === 0
    && setup.pseudoSpell.activeEffects
      ? () =>
          applyCreatureSpellParts(
            creature,
            setup.pseudoSpell,
            [],
            templateId,
            casterSource,
            castKey,
          )
      : undefined;

  // Круг наложения из группы фиксирует окно броска: список кругов из одного
  // значения. Без круга секция не показывается — так же, как было до групп
  const castLevel = placement?.ref.castLevel;

  const spellRollMode: AttackRollMode = usesAttack
    ? resolveTargetedAttackRollMode(creature, 'spell')
    : 'normal';

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
    initialRollMode: spellRollMode,
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
        setup.pseudoSpell,
        parts,
        templateId,
        casterSource,
        castKey,
      ),
    onHit,
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
        spellSaveDC: casterSource.saveDc,
        actors,
        socket,
        casterId: creature.id,
      },
      parts,
      { scene: worldStore.currentScene, cachedTemplate },
    );
  }

  // Эффекты на самом существе, зона на месте шаблона, конец концентрации
  completeSpellCast({
    spell: pseudoSpell,
    caster: useWorldEntities().findCurrentDndEntity(creature.id) ?? creature,
    source: casterSource,
    template: cachedTemplate,
    applyCasterEffects: true,
    castKey,
  });

  if (templateId) {
    templateStore.deleteTemplate(templateId);
  }
}
