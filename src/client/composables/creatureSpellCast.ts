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
  Spell,
} from '@vtt/shared/system/dnd.js';

import type { AttackRollSnapshot } from './attackRollSnapshot';
import type { SpellCasterSource } from './spellCastCompletion';
import type { SpellCastRefusal } from './spellCastFlow';
import type { RolledSpellDamagePart } from './useSpellResolution';

import { useChatStore } from '@/stores/chatStore';
import { useSpellTemplateStore } from '@/stores/spellTemplateStore';
import { useTargetStore } from '@/stores/targetStore';
import { useWorldStore } from '@/stores/worldStore';
import { generateId } from '@vtt/shared';
import {
  calculateCreatureSpellBlockNumbers,
  castReachesTargets,
  collectActiveEffects,
  consumeCreatureSpellGroupUse,
  getCreatureSpellBlockAbility,
  getCreatureSpellMod,
  getCreatureSpellRollButtonText,
  getDamagePartsPrimaryType,
  getDamageTemplateColor,
  getSpellAttackType,
  hasLiveCreatureSpellUsesLeft,
  isCreatureSpellPoolMode,
  isDndCreature,
  isDndSceneEntity,
  isTargetAtFullHp,
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
import { buildRollBonusEvaluator } from './rollBonusEvaluator';
import { refuseWhileSheetEditing } from './sheetEditLock';
import {
  afterSpellCast,
  completeSpellCast,
  SPELL_CAST_KEY_PREFIX,
} from './spellCastCompletion';
import { beginSpellCast } from './spellCasts';
import { discardSpellTemplate } from './spellResolutionShared';
import { useBonusDamageParts } from './useBonusDamageParts';
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
 * когда каст состоялся: окно открылось, каст применён сразу или сорвался.
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

      /** Списывает применение заклинания */
      const spendUse = (): void => port.spendUse(spell, placement);

      /** «Замедление»: после действия бонусное в этот ход недоступно */
      const spendTurn = (): void =>
        recordEntityActionSpend(creature.id, resolveSpellCastCost(spell));

      /**
       * Окно с шаблоном или без: открылось — тратятся ход и применение; нет
       * — шаблон убирается.
       *
       * @param templateId - размещённый шаблон области
       */
      const openRoll = (templateId: string | undefined): void => {
        // Повторный каст того же заклинания заменяет своё прежнее окно: то
        // закрывается как отменённое, а ход и заряд оно уже потратило
        const sourceKey = buildRollSourceKey(creature.id, 'spell', spell.id);
        const replaced = closeRollWindow(sourceKey);

        /** Каст состоялся: ход и применение — один раз на каст */
        const commitCastStart = (): void => {
          if (!replaced) {
            spendTurn();
            spendUse();
          }
        };

        if (
          !openCreatureSpellRoll(
            spell,
            creature,
            templateId,
            placement,
            sourceKey,
            commitCastStart,
          )
          && templateId
        ) {
          discardSpellTemplate(templateId);
        }
      };

      // Провал каста («Замедление», «Слово силы: Боль»): ход тратится,
      // применение — только если так велит правило
      runWithCastFailure(
        spell,
        creature,
        { loseUse: spendUse, spendTurn },
        () => {
          if (!spell.areaOfEffect) {
            openRoll(undefined);

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
          );
        },
      );
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
 * @param onCastStarted - каст состоялся: вызывающий тратит ход и применение.
 *   У каста без окна зовётся ДО доведения каста: запись заряда — полная
 *   запись сущности, и после доведения она вернула бы серверу эффекты из
 *   стора — прежнюю метку концентрации вместо новой
 * @returns `true` — каст состоялся (окно открылось или каст применён сразу)
 */
export function openCreatureSpellRoll(
  spell: Spell,
  creature: DnDCreature,
  templateId: string | undefined,
  placement: CreatureSpellPlacement | undefined,
  sourceKey?: string,
  onCastStarted?: () => void,
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

  const plan = resolveSpellCastPlan({
    spell,
    // Плану нужны только наличие частей: путь существа всегда многочастный,
    // а надпись кнопки у него своя
    damageParts: setup.baseParts.map(({ formula }) => ({ formula })),
    hasProjectiles: false,
    hasBonusDamage: false,
    // Ячеек у существа нет: круг закреплён, как у врождённого
    isInnate: true,
    hasTemplate: templateId !== undefined,
    attackType,
    forceMultiPart: true,
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
    // Ресурсы каста — до его доведения (правило `completeSpellCast`)
    onCastStarted?.();

    runWithDamageTypeChoices(setup.pseudoSpell, (chosen) => {
      applyCreatureSpellParts(
        creature.id,
        chosen,
        [],
        templateId,
        casterSource,
        castKey,
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
    );

  const opened = openDiceRollWindow(
    {
      title: usesAttack
        ? `${CREATURE_ACTIONS_BLOCK_LABELS.attackRollPrefix}${spell.name}`
        : spell.name,
      rollLabel: spell.name,
      rollButtonText: getCreatureSpellRollButtonText(usesAttack, isHealing),
      formula: setup.baseParts[0]?.formula ?? '',
      attackModifier: usesAttack ? numbers.attackBonus : undefined,
      evaluateBonusRollFormulas: usesAttack
        ? buildRollBonusEvaluator(
            () => readCreature(creature.id),
            SPELL_ATTACK_KEY,
          )
        : undefined,
      initialRollMode: spellAttackRoll?.mode ?? 'normal',
      rollModeReasons: spellAttackRoll?.reasons,
      incomingAttackType: plan.attackType,
      damageType: getDamagePartsPrimaryType(spell.damageParts),
      isHealing,
      damageParts: setup.baseParts,
      spellLevel: castLevel === undefined ? undefined : spell.level,
      availableSpellLevels: castLevel === undefined ? undefined : [castLevel],
      spellScalingDice:
        castLevel === undefined ? undefined : spell.scaling?.additionalDice,
      evaluateBonusDamageParts: setup.evaluateBonusDamageParts,
      onRollParts: applyParts,
      // Атака без частей урона: окно не зовёт `onRollParts`, и эффекты на
      // попадании разбирает тот же оркестратор с пустым набором частей
      onHit:
        usesAttack && !plan.hasDamage && setup.pseudoSpell.activeEffects
          ? (attack?: AttackRollSnapshot) => applyParts([], attack)
          : undefined,
      damageTypeChoice,
      // Отмена окна обязана убрать шаблон: он размещается ДО броска
      onCancel: templateId ? () => discardSpellTemplate(templateId) : undefined,
      // Расход одноразовых эффектов «следующей атаки» на броске атаки существа
      attackerId: creature.id,
    },
    sourceKey === undefined ? {} : { sourceKey },
  );

  if (opened === null) {
    return false;
  }

  onCastStarted?.();

  return true;
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
 */
export function applyCreatureSpellParts(
  creatureId: string,
  pseudoSpell: Spell,
  parts: RolledSpellDamagePart[],
  templateId: string | undefined,
  casterSource: SpellCasterSource,
  castKey: string,
  attack?: AttackRollSnapshot,
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
        { scene: useWorldStore().currentScene, cachedTemplate },
      );
    },
  );
}
