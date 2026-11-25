/**
 * Каст заклинания существа — один на лист существа и горячую панель.
 *
 * Раньше лист существа (`CreatureSpellsBlock.vue`) и горячая панель
 * (`dnd5eMacros.ts`) держали почти дословные копии: запрет, заряды, провал
 * каста, шаблон, окно броска и применение частей. Копии разошлись: панель не
 * знала выбранной цели (`@target`-токены считались без неё), лист открывал
 * своё окно, а не окно менеджера. Здесь один путь; входы различаются только
 * портом ({@link CreatureSpellCasterPort}): как записать заряд и как отказать.
 *
 * Вид каста решает тот же план, что у персонажа (`resolveSpellCastPlan`), с
 * двумя правилами существа: заклинание со спасброском или областью броска
 * попадания не делает, а части урона всегда катит окно — многочастным путём.
 */

import type {
  CreatureSpellPlacement,
  DnDCreature,
  RollContext,
  Spell,
  SpellCastPlan,
} from '@vtt/shared/system/dnd.js';

import type { AttackRollSnapshot } from './attackRollSnapshot';
import type { RollBonusEvaluator } from './rollBonusEvaluator';
import type { SpellCasterSource } from './spellCastCompletion';
import type { SpellCastRefusal } from './spellCastFlow';
import type { SpellEffectTargets } from './spellEffectTargeting';
import type { BonusPartsRollContext } from './useBonusDamageParts';
import type {
  ProjectileAttackContext,
  RolledSpellDamagePart,
  SpellDamagePartInput,
} from './useSpellResolution';

import { useChatStore } from '@/stores/chatStore';
import { useProjectileStore } from '@/stores/projectileStore';
import { useSpellTemplateStore } from '@/stores/spellTemplateStore';
import { useTargetStore } from '@/stores/targetStore';
import { useWorldStore } from '@/stores/worldStore';
import { generateId } from '@vtt/shared';
import {
  areaOriginatesFromCaster,
  calculateCreatureSpellBlockNumbers,
  castReachesTargets,
  collectActiveEffects,
  consumeCreatureSpellGroupUse,
  CREATURE_PROJECTILE_CASTER_LEVEL,
  getCreatureSpellBlockAbility,
  getCreatureSpellMod,
  getCreatureSpellProjectileCount,
  getCreatureSpellRollButtonText,
  getDamagePartsPrimaryType,
  getDamageTemplateColor,
  getSpellAttackType,
  hasLiveCreatureSpellUsesLeft,
  isCreatureSpellPoolMode,
  isDndCreature,
  isDndSceneEntity,
  isSpellAreaPlacedAtRange,
  isTargetAtFullHp,
  isVerbalSpellCast,
  needsSpellEffectTargets,
  resolveCreatureSpellSaveDC,
  resolveEntityCreatureType,
  resolveSpellAreaAtLevel,
  resolveSpellCastBlock,
  resolveSpellCastCost,
  resolveSpellCastPlan,
  retypeCasterSpellDamage,
  SPELL_ATTACK_KEY,
  spellIsHealing,
  withSpentSpellUse,
} from '@vtt/shared/system/dnd.js';

import { ACTOR_SPELLS_TAB_LABELS } from '../ui/actor/constants';
import { CREATURE_ACTIONS_BLOCK_LABELS } from '../ui/creature/constants';
import { recordEntityActionSpend } from './actionSpend';
import { resolveTargetedAttackRoll } from './attackRollMode';
import { listAttackResolutionEntities } from './attackRollSnapshot';
import { runWithCastFailure } from './castFailure';
import {
  findSpellGroupLimitBlock,
  resolveSpellGroupLimitTarget,
  spendLimitedTarget,
} from './creatureActionLimit';
import {
  requestDamageTypeChoiceFor,
  runWithDamageTypeChoices,
} from './damageTypeChoice';
import {
  buildRollSourceKey,
  closeRollWindow,
  openDiceRollWindow,
} from './diceRollWindow';
import { runWithEffectVariants } from './effectVariantChoice';
import { changeEntitySheet } from './entitySheetWrite';
import { refuseWhilePaused } from './pauseLock';
import {
  buildRollBonusEvaluator,
  collectProjectileRollBonuses,
} from './rollBonusEvaluator';
import { refuseWhileSheetEditing } from './sheetEditLock';
import {
  afterSpellCast,
  completeSpellCast,
  SPELL_CAST_KEY_PREFIX,
} from './spellCastCompletion';
import { beginSpellCast } from './spellCasts';
import {
  createProjectileCastValidator,
  requestProjectileTargets,
  requestSpellEffectTargets,
} from './spellEffectTargeting';
import { discardSpellTemplate } from './spellResolutionShared';
import { useBonusDamageParts } from './useBonusDamageParts';
import { dispatchSpellCastTriggers } from './useEffectTriggerEvents';
import { listAmbientEffects } from './useResolvedStats';
import { useSpellResolution } from './useSpellResolution';
import { useWorldEntities } from './useWorldEntities';

/**
 * Существо общего разбора каста. Входы (лист существа, горячая панель)
 * собирают его одной фабрикой {@link createCreatureSpellCasterPort} и
 * различаются только отказом.
 */
export interface CreatureSpellCasterPort {
  /** Существо */
  creatureId: string;
  /** Списывает применение заклинания (заряд или общий счётчик группы) */
  spendUse: (spell: Spell, placement?: CreatureSpellPlacement) => void;
  /** Каст не начался: говорит почему */
  refuse: (spell: Spell, refusal: SpellCastRefusal) => void;
}

/**
 * Списывает одно применение заклинания существа мира. У группы «на весь
 * список» счётчик один на всю группу и лежит у неё; у остальных заряды
 * считает само заклинание.
 *
 * Существо перечитывается в момент записи: копия, захваченная до окна,
 * вернула бы хиты и эффекты, изменённые сервером за это время.
 *
 * @param creatureId - существо-источник
 * @param spell - заклинание
 * @param placement - группа, из которой идёт каст
 */
export function spendCreatureSpellUse(
  creatureId: string,
  spell: Spell,
  placement: CreatureSpellPlacement | undefined,
): void {
  // Перезарядка и «раз в N ходов» группы — журналом боевым каналом, отдельно
  // от зарядов листа
  if (placement) {
    spendLimitedTarget(
      creatureId,
      resolveSpellGroupLimitTarget(placement.group),
    );
  }

  const isPool =
    placement !== undefined && isCreatureSpellPoolMode(placement.group.mode);

  if (!isPool && (!spell.uses || spell.uses.recovery === 'atWill')) {
    return;
  }

  changeEntitySheet(creatureId, (current) => {
    if (!isDndCreature(current)) {
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
 * Существо мира: применение пишется помощником записи листа из свежей
 * сущности — не `emit` листа: применение тратится, когда окно открылось, а
 * окно переживает лист.
 *
 * @param creatureId - существо
 * @param refuse - отказ входа: лист — уведомлением, панель — в чат
 * @returns порт существа
 */
export function createCreatureSpellCasterPort(
  creatureId: string,
  refuse: CreatureSpellCasterPort['refuse'],
): CreatureSpellCasterPort {
  return {
    creatureId,
    spendUse: (spell, placement) =>
      spendCreatureSpellUse(creatureId, spell, placement),
    refuse,
  };
}

/**
 * Существо мира с данными системы — в момент обращения.
 *
 * @param creatureId - существо
 * @returns существо либо `undefined`
 */
function readCreature(creatureId: string): DnDCreature | undefined {
  const entity = useWorldEntities().findCurrentDndEntity(creatureId);

  return entity && isDndCreature(entity) ? entity : undefined;
}

/**
 * Начинает каст заклинания существа: замена типа урона, запрет трат хода,
 * заряды, провал каста, шаблон области — и окно. Ход и применение тратятся,
 * когда каст состоялся: в окне бросили, каст применён сразу или сорвался.
 * Окно, закрытое без броска, ничего не тратит.
 *
 * @param sourceSpell - заклинание существа; варианты эффектов не выбраны
 * @param placement - группа, из которой идёт каст: её числа, круг наложения
 *   и общий счётчик применений главнее чисел самого существа
 * @param port - вход каста
 */
export function startCreatureSpellCast(
  sourceSpell: Spell,
  placement: CreatureSpellPlacement | undefined,
  port: CreatureSpellCasterPort,
): void {
  // Лист существа в режиме правки — каст ждёт «Сохранить» или отмены
  if (refuseWhileSheetEditing(port.creatureId)) {
    return;
  }

  // Игра на паузе — действие не начинается
  if (refuseWhilePaused()) {
    return;
  }

  const creature = readCreature(port.creatureId);

  if (!creature) {
    return;
  }

  // Запрет трат хода («Электрошок» — нет реакций) — до выбора варианта
  const blocked = resolveSpellCastBlock(
    creature,
    sourceSpell,
    listAmbientEffects(creature.id),
  );

  if (blocked) {
    port.refuse(sourceSpell, {
      title: ACTOR_SPELLS_TAB_LABELS.castBlockedTitle,
      description: blocked,
    });

    return;
  }

  runWithEffectVariants(
    retypeCasterSpellDamage(sourceSpell, creature),
    (spell) => {
      // Заряды — по существу мира в этот момент: строка листа и ссылка
      // панели несут заклинание, каким оно было при отрисовке
      const liveCreature = readCreature(port.creatureId) ?? creature;

      if (!hasLiveCreatureSpellUsesLeft(liveCreature, spell, placement)) {
        port.refuse(spell, {
          title: ACTOR_SPELLS_TAB_LABELS.noUsesTitle,
          description: ACTOR_SPELLS_TAB_LABELS.noUsesText,
        });

        return;
      }

      const groupBlock = findSpellGroupLimitBlock(
        liveCreature,
        placement?.group,
      );

      if (groupBlock) {
        port.refuse(spell, {
          title: ACTOR_SPELLS_TAB_LABELS.noUsesTitle,
          description: groupBlock,
        });

        return;
      }

      /** Списывает применение заклинания */
      const spendUse = (): void => port.spendUse(spell, placement);

      /** «Замедление»: после действия бонусное в этот ход недоступно */
      const spendTurn = (): void =>
        recordEntityActionSpend(creature.id, resolveSpellCastCost(spell));

      /**
       * Каст состоялся: ход и применение. Окно могло простоять долго, а
       * тратить к броску уже не из чего — заряд общего счётчика ушёл другим
       * заклинанием группы, ход занят другим действием: тогда отказ с
       * причиной, и ничего не тратится.
       *
       * @returns `false`, если каста не будет
       */
      const commitCastStart = (): boolean => {
        const caster = readCreature(port.creatureId);

        if (!caster) {
          return false;
        }

        const castBlock = resolveSpellCastBlock(
          caster,
          spell,
          listAmbientEffects(caster.id),
        );

        if (castBlock) {
          port.refuse(spell, {
            title: ACTOR_SPELLS_TAB_LABELS.castBlockedTitle,
            description: castBlock,
          });

          return false;
        }

        if (!hasLiveCreatureSpellUsesLeft(caster, spell, placement)) {
          port.refuse(spell, {
            title: ACTOR_SPELLS_TAB_LABELS.noUsesTitle,
            description: ACTOR_SPELLS_TAB_LABELS.noUsesText,
          });

          return false;
        }

        const liveGroupBlock = findSpellGroupLimitBlock(
          caster,
          placement?.group,
        );

        if (liveGroupBlock) {
          port.refuse(spell, {
            title: ACTOR_SPELLS_TAB_LABELS.noUsesTitle,
            description: liveGroupBlock,
          });

          return false;
        }

        spendTurn();
        spendUse();

        // Каст состоялся: засада кончается заклинанием с вербальным
        // компонентом — если группа статблока его не опускает
        dispatchSpellCastTriggers(
          caster.id,
          isVerbalSpellCast(
            spell,
            placement?.block.ignoredComponents?.verbal === true,
          ),
        );

        return true;
      };

      /**
       * Окно с шаблоном или без: не открылось — шаблон убирается. Ход и
       * применение тратит бросок окна, а каст без окна — сразу.
       *
       * @param templateId - размещённый шаблон области
       * @param effectTargets - цели, выбранные окном до каста
       */
      const openRoll = (
        templateId: string | undefined,
        effectTargets?: SpellEffectTargets,
      ): void => {
        // Повторный каст того же заклинания заменяет своё прежнее окно: то
        // закрывается как отменённое и ничего не потратило
        const sourceKey = buildRollSourceKey(creature.id, 'spell', spell.id);

        closeRollWindow(sourceKey);

        if (
          !openCreatureSpellRoll(
            spell,
            creature,
            templateId,
            placement,
            sourceKey,
            commitCastStart,
            effectTargets,
          )
          && templateId
        ) {
          discardSpellTemplate(templateId);
        }
      };

      // Провал каста («Замедление», «Слово силы: Боль»): ход тратится,
      // применение — только если так велит правило
      const castWithFailureCheck = (effectTargets?: SpellEffectTargets): void =>
        runWithCastFailure(
          spell,
          creature,
          { loseUse: spendUse, spendTurn },
          () => {
            if (!spell.areaOfEffect) {
              openRoll(undefined, effectTargets);

              return;
            }

            // Область: шаблон у фишки существа, затем окно. Круг наложения
            // группы растит область так же, как ячейка персонажа
            useSpellTemplateStore().requestPlacement(
              resolveSpellAreaAtLevel(spell, placement?.ref.castLevel)
                ?? spell.areaOfEffect,
              getDamageTemplateColor(
                getDamagePartsPrimaryType(spell.damageParts),
              ),
              creature.id,
              openRoll,
              null,
              isSpellAreaPlacedAtRange(spell),
              areaOriginatesFromCaster(spell),
            );
          },
        );

      // Ячеек у существа нет: круг в окнах выбора закреплён группой статблока
      const castLevel = placement?.ref.castLevel ?? spell.level;

      // Снаряды («Волшебная стрела», «Палящий луч»): цели выбираются до
      // каста, как у персонажа, — закрытый выбор ни хода, ни применения не
      // тратит
      const projectileCount = getCreatureSpellProjectileCount(
        spell,
        placement?.ref.castLevel,
      );

      if (projectileCount > 0) {
        requestProjectileTargets(spell, creature.id, projectileCount, {
          casterLevel: CREATURE_PROJECTILE_CASTER_LEVEL,
          availableSpellLevels: [castLevel],
          onConfirm: () => castWithFailureCheck(),
        });

        return;
      }

      // Несколько целей («Удержание личности» кругом выше) — окном до каста,
      // как у персонажа. Ячеек и записи на листе у существа нет —
      // проверяется только, что оно на месте
      if (needsSpellEffectTargets(spell, castLevel)) {
        requestSpellEffectTargets(
          spell,
          creature.id,
          [castLevel],
          (_level, effectTargets) => castWithFailureCheck(effectTargets),
          () => (readCreature(creature.id) ? null : 'changed'),
        );

        return;
      }

      castWithFailureCheck();
    },
  );
}

/**
 * Окно броска заклинания существа — многочастный путь. Атакующие заклинания
 * идут с броском попадания (плоский бонус блока, а без блока — существа);
 * спасброски и область — без него. Ни урона, ни атаки — окна нет, каст
 * применяется сразу.
 *
 * @param spell - заклинание существа
 * @param creature - существо-источник
 * @param templateId - размещённый шаблон области
 * @param placement - группа, из которой идёт каст
 * @param sourceKey - источник действия: окно встаёт на место прежнего окна
 *   того же заклинания
 * @param commitCastStart - каст состоялся: вызывающий тратит ход и
 *   применение; `false` — тратить не из чего, каста не будет. У каста с окном
 *   зовётся броском окна, у каста без окна — сразу и ДО доведения каста:
 *   запись заряда — полная запись сущности, и после доведения она вернула бы
 *   серверу эффекты из стора — прежнюю метку концентрации вместо новой
 * @param effectTargets - цели, выбранные окном до каста
 * @returns `true` — окно открылось или каст применён сразу
 */
export function openCreatureSpellRoll(
  spell: Spell,
  creature: DnDCreature,
  templateId: string | undefined,
  placement: CreatureSpellPlacement | undefined,
  sourceKey?: string,
  commitCastStart?: () => boolean,
  effectTargets?: SpellEffectTargets,
): boolean {
  // Существо не атакует заклинанием со спасброском или областью
  const usesSaveOrArea =
    (!!spell.saveType && spell.saveType !== 'none') || !!spell.areaOfEffect;

  const attackType = usesSaveOrArea
    ? null
    : (getSpellAttackType(spell) ?? null);

  // Выбранная цель — для @target-токенов одиночной цели, как у персонажа
  const targetEntity = spell.areaOfEffect
    ? null
    : useTargetStore().getTargetActor();

  const spellcastingAbility = getCreatureSpellBlockAbility(
    creature,
    placement?.block,
  );

  const setup = useBonusDamageParts().buildCreatureSpellRollSetup({
    spell,
    creature,
    effects: collectActiveEffects(creature),
    targetIsFull: isTargetAtFullHp(targetEntity),
    targetType:
      targetEntity && isDndSceneEntity(targetEntity)
        ? resolveEntityCreatureType(targetEntity)
        : undefined,
    spellcastingAbility,
  });

  // Снаряды выбраны до окна; у шаблона их не бывает
  const hasProjectiles =
    templateId === undefined
    && getCreatureSpellProjectileCount(spell, placement?.ref.castLevel) > 0;

  const plan = resolveSpellCastPlan({
    spell,
    // Плану нужны только наличие частей: путь существа многочастный, кроме
    // снарядов — их формула катится на каждый снаряд; надпись кнопки своя
    damageParts: setup.baseParts.map(({ formula }) => ({ formula })),
    hasProjectiles,
    hasBonusDamage: false,
    // Ячеек у существа нет: круг закреплён, как у врождённого
    isInnate: true,
    hasTemplate: templateId !== undefined,
    attackType,
    forceMultiPart: !hasProjectiles,
  });

  const numbers = calculateCreatureSpellBlockNumbers(
    creature,
    placement?.block,
  );

  // Существо как заклинатель: Сл блока и модификатор его характеристики.
  // Своя Сл заклинания (жезл, свиток) главнее Сл блока
  const casterSource: SpellCasterSource = {
    saveDc: resolveCreatureSpellSaveDC(spell, numbers.saveDC),
    spellMod: getCreatureSpellMod(creature, spellcastingAbility),
    spellAbility: spellcastingAbility,
  };

  const castKey = generateId(SPELL_CAST_KEY_PREFIX);

  beginSpellCast(creature.id, spell, castKey, placement?.ref.castLevel);

  // Ни урона, ни атаки — окну броска катить нечего: каст применяется сразу,
  // тип урона на выбор спросит плашка
  if (plan.window !== 'roll') {
    runWithDamageTypeChoices(setup.pseudoSpell, (chosen) => {
      // Ресурсы каста — когда выбор сделан (закрытая плашка ничего не
      // тратит) и до доведения каста (правило `completeSpellCast`)
      if (commitCastStart && !commitCastStart()) {
        if (templateId) {
          discardSpellTemplate(templateId);
        }

        return;
      }

      applyCreatureSpellParts(
        creature.id,
        chosen,
        [],
        templateId,
        casterSource,
        castKey,
        undefined,
        effectTargets,
      );
    });

    return true;
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

  const usesAttack = plan.attackType !== undefined;
  const isHealing = spellIsHealing(spell);

  // Круг наложения из группы фиксирует окно броска: список из одного круга.
  // Без круга секция не показывается
  const castLevel = placement?.ref.castLevel;

  const spellAttackRoll = usesAttack
    ? resolveTargetedAttackRoll(creature, 'spell')
    : undefined;

  /**
   * Применяет каст брошенными частями.
   *
   * @param parts - части урона
   * @param attack - снимок броска атаки, если бросок попадания был
   */
  const applyParts = (
    parts: RolledSpellDamagePart[],
    attack?: AttackRollSnapshot,
  ): void =>
    applyCreatureSpellParts(
      creature.id,
      castSpell,
      parts,
      templateId,
      casterSource,
      castKey,
      attack,
      effectTargets,
    );

  const evaluateAttackBonusRollFormulas = usesAttack
    ? buildRollBonusEvaluator(() => readCreature(creature.id), SPELL_ATTACK_KEY)
    : undefined;

  // Свойства окна, общие для частей урона и снарядов
  const commonWindowProps = {
    title: usesAttack
      ? `${CREATURE_ACTIONS_BLOCK_LABELS.attackRollPrefix}${spell.name}`
      : spell.name,
    rollLabel: spell.name,
    actorName: creature.name,
    rollButtonText: getCreatureSpellRollButtonText(usesAttack, isHealing),
    formula: setup.baseParts[0]?.formula ?? '',
    initialRollMode: spellAttackRoll?.mode ?? 'normal',
    rollModeReasons: spellAttackRoll?.reasons,
    incomingAttackType: plan.attackType,
    damageType: getDamagePartsPrimaryType(spell.damageParts),
    isHealing,
    spellLevel: castLevel === undefined ? undefined : spell.level,
    availableSpellLevels: castLevel === undefined ? undefined : [castLevel],
    spellScalingDice:
      castLevel === undefined ? undefined : spell.scaling?.additionalDice,
    damageTypeChoice,
  };

  const attackModifier = usesAttack ? numbers.attackBonus : undefined;

  if (hasProjectiles) {
    return openCreatureProjectileRoll({
      creatureId: creature.id,
      plan,
      windowProps: commonWindowProps,
      attackModifier,
      readCastSpell: () => castSpell,
      projectileFormula: commonWindowProps.formula,
      evaluateBonusDamageParts: setup.evaluateBonusDamageParts,
      evaluateAttackBonusRollFormulas,
      casterSource,
      castKey,
      sourceKey,
      commitCastStart,
    });
  }

  const opened = openDiceRollWindow(
    {
      ...commonWindowProps,
      attackModifier,
      // Расход одноразовых эффектов «следующей атаки» на броске атаки существа
      attackerId: creature.id,
      evaluateBonusRollFormulas: evaluateAttackBonusRollFormulas,
      damageParts: setup.baseParts,
      evaluateBonusDamageParts: setup.evaluateBonusDamageParts,
      onRollParts: applyParts,
      // Атака без частей урона: окно не зовёт `onRollParts`, и эффекты на
      // попадании разбирает тот же оркестратор с пустым набором частей
      onHit:
        usesAttack && !plan.hasDamage && setup.pseudoSpell.activeEffects
          ? (attack?: AttackRollSnapshot) => applyParts([], attack)
          : undefined,
      // Отмена окна обязана убрать шаблон: он размещается ДО броска
      onCancel: templateId ? () => discardSpellTemplate(templateId) : undefined,
    },
    {
      ...(sourceKey === undefined ? {} : { sourceKey }),
      ...(commitCastStart ? { commit: commitCastStart } : {}),
    },
  );

  return opened !== null;
}

/** Вход окна снарядов существа */
interface CreatureProjectileRollInput {
  /** Существо-заклинатель */
  creatureId: string;
  /** Решение о касте */
  plan: SpellCastPlan;
  /** Свойства окна, общие с многочастным путём */
  windowProps: Record<string, unknown>;
  /** Модификатор атаки заклинанием; нет — снаряды без броска попадания */
  attackModifier: number | undefined;
  /** Заклинание каста: тип урона на выбор окно может заменить в броске */
  readCastSpell: () => Spell;
  /** Формула одного снаряда с числами существа */
  projectileFormula: string;
  /** Кость-бонусы урона заклинаний с эффектов существа */
  evaluateBonusDamageParts: (
    context: BonusPartsRollContext,
  ) => SpellDamagePartInput[];
  /** Бонусы к броску атаки с эффектов существа; нет — снаряды без атаки */
  evaluateAttackBonusRollFormulas: RollBonusEvaluator | undefined;
  /** Сл и модификатор существа как заклинателя */
  casterSource: SpellCasterSource;
  /** Ключ каста */
  castKey: string;
  /** Источник действия: окно встаёт на место прежнего окна */
  sourceKey: string | undefined;
  /** Каст состоялся: ход и применение */
  commitCastStart: (() => boolean) | undefined;
}

/**
 * Окно снарядов существа — путь персонажа: формула катится на каждый снаряд.
 * Атакующие снаряды («Палящий луч») — серия бросков попадания, по одному на
 * снаряд; без атаки («Волшебная стрела») — урон каждого снаряда без броска
 * попадания. Закрытое без броска окно отпускает выбор снарядов.
 *
 * @param input - каст и окно
 * @returns `true` — окно открылось
 */
function openCreatureProjectileRoll(
  input: CreatureProjectileRollInput,
): boolean {
  const { evaluateAttackBonusRollFormulas } = input;
  const { attackType } = input.plan;
  const isCurrentProjectileCast = createProjectileCastValidator(true);

  let applied = false;

  /**
   * Окно закрылось без броска: выбор снарядов этого каста отпускается.
   *
   * @param isOpen - окно открыто
   */
  const handleClose = (isOpen: boolean): void => {
    if (!isOpen && !applied && isCurrentProjectileCast()) {
      useProjectileStore().stopTargeting();
    }
  };

  /**
   * Применяет снаряды: доводит каст и разбирает цели.
   *
   * @param projectileAttack - контекст серии атак; нет — автопопадание
   */
  const applyProjectiles = (
    projectileAttack?: ProjectileAttackContext,
  ): void => {
    applied = true;

    applyCreatureSpellProjectiles(input, projectileAttack);
  };

  const opened = openDiceRollWindow(
    {
      ...input.windowProps,
      attackModifier: input.attackModifier,
      // Расход одноразовых эффектов «следующей атаки» на броске атаки существа
      attackerId: input.creatureId,
      skipDamageApplication: true,
      skipChatMessage: true,
      evaluateProjectileBonusRollFormulas: evaluateAttackBonusRollFormulas
        ? (context: RollContext) =>
            collectProjectileRollBonuses(
              context,
              evaluateAttackBonusRollFormulas,
            )
        : undefined,
      // Атакующие снаряды: окно отдаёт контекст, серию бросков катит разбор
      onProjectileAttack: attackType
        ? (rollContext: Omit<ProjectileAttackContext, 'attackType'>) =>
            applyProjectiles({ ...rollContext, attackType })
        : undefined,
      onRoll: () => applyProjectiles(),
    },
    {
      ...(input.sourceKey === undefined ? {} : { sourceKey: input.sourceKey }),
      onClose: handleClose,
      validateRoll: isCurrentProjectileCast,
      ...(input.commitCastStart ? { commit: input.commitCastStart } : {}),
    },
  );

  if (opened === null) {
    handleClose(false);
  }

  return opened !== null;
}

/**
 * Применяет снаряды заклинания существа: доводит каст и катит формулу на
 * каждый снаряд по выбранным целям. Бонус-части эффектов катаются на каждый
 * снаряд с режимом броска серии.
 *
 * @param input - каст
 * @param projectileAttack - контекст серии атак; нет — автопопадание
 */
function applyCreatureSpellProjectiles(
  input: CreatureProjectileRollInput,
  projectileAttack: ProjectileAttackContext | undefined,
): void {
  const creature = readCreature(input.creatureId);

  if (!creature) {
    return;
  }

  const spell = input.readCastSpell();

  const bonusDamageParts = input.evaluateBonusDamageParts({
    hasAdvantage: projectileAttack?.rollMode === 'advantage',
    hasDisadvantage: projectileAttack?.rollMode === 'disadvantage',
  });

  afterSpellCast(
    completeSpellCast({
      spell,
      caster: creature,
      source: input.casterSource,
      template: null,
      castKey: input.castKey,
    }),
    () => {
      const socket = useChatStore().getSocket();
      const actors = listAttackResolutionEntities(projectileAttack?.attack);

      if (!socket || actors.length === 0) {
        return;
      }

      useSpellResolution().resolveSpellDamage(
        {
          spell,
          damageTotal: 0,
          spellSaveDC: input.casterSource.saveDc,
          actors,
          socket,
          casterId: input.creatureId,
          attack: projectileAttack?.attack,
        },
        {
          hasProjectiles: true,
          resolvedDamageFormula: input.projectileFormula,
          scene: useWorldStore().currentScene,
          bonusDamageParts,
          ...(projectileAttack ? { projectileAttack } : {}),
        },
      );
    },
  );
}

/**
 * Применяет брошенные части заклинания существа: доводит каст (конец прежней
 * концентрации, эффекты на существе, зона), затем разбирает цели
 * многочастным оркестратором. Сл спасброска — плоская из блока, а без блока
 * — из заклинательства существа.
 *
 * @param creatureId - существо-источник
 * @param pseudoSpell - псевдо-заклинание (клон с эффектами для спасброска и области)
 * @param parts - брошенные части урона
 * @param templateId - размещённый шаблон области
 * @param casterSource - Сл блока и модификатор характеристики существа
 * @param castKey - ключ каста: окно зовёт применение и по попаданию, и по частям
 * @param attack - снимок броска атаки: стороны удара считаются с эффектами,
 *   которые бросок израсходовал
 * @param effectTargets - цели, выбранные окном до каста; без них — выбранная
 *   цель или шаблон
 */
export function applyCreatureSpellParts(
  creatureId: string,
  pseudoSpell: Spell,
  parts: RolledSpellDamagePart[],
  templateId: string | undefined,
  casterSource: SpellCasterSource,
  castKey: string,
  attack?: AttackRollSnapshot,
  effectTargets?: SpellEffectTargets,
): void {
  const templateStore = useSpellTemplateStore();

  const cachedTemplate = templateId
    ? (templateStore.getPlacedTemplate(templateId) ?? null)
    : null;

  // Шаблон снимается раньше всего: существо могло уйти из мира, пока окно
  // было открыто, и шаблон не должен остаться на карте
  if (templateId) {
    templateStore.removePlacedTemplate(templateId);
    templateStore.deleteTemplate(templateId);
  }

  const creature = readCreature(creatureId);

  if (!creature) {
    return;
  }

  afterSpellCast(
    completeSpellCast({
      spell: pseudoSpell,
      caster: creature,
      source: casterSource,
      template: cachedTemplate,
      castKey,
    }),
    () => {
      const socket = useChatStore().getSocket();

      // Цели читаются после ожидания: эффекты прежнего каста уже сняты, а
      // израсходованные броском этой атаки — на месте
      const actors = listAttackResolutionEntities(attack);

      // Цели нечего получить — ни урона, ни эффекта («Щит» только на себя):
      // оркестратор писал бы в чат «цель не выбрана» к касту, который удался
      if (
        !socket
        || actors.length === 0
        || !castReachesTargets(pseudoSpell, parts.length)
      ) {
        return;
      }

      // Цели, выбранные окном, забираются один раз; выбор устарел — каст
      // ни на кого не ложится
      const targetEntities = effectTargets?.claimEntities();

      if (targetEntities === null) {
        return;
      }

      void useSpellResolution().resolveSpellDamageWithParts(
        {
          spell: pseudoSpell,
          damageTotal: 0,
          spellSaveDC: casterSource.saveDc,
          actors,
          socket,
          casterId: creatureId,
          attack,
        },
        parts,
        { scene: useWorldStore().currentScene, cachedTemplate, targetEntities },
      );
    },
  );
}
