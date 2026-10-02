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

import type { SpellCasterSource } from './spellCastCompletion';
import type { SpellCastRefusal } from './spellCastFlow';
import type { RolledSpellDamagePart } from './useSpellResolution';

import { useModalManager } from '@/shared_ui/composables/useModalManager';
import { useChatStore } from '@/stores/chatStore';
import { useSpellTemplateStore } from '@/stores/spellTemplateStore';
import { useTargetStore } from '@/stores/targetStore';
import { useWorldStore } from '@/stores/worldStore';
import { generateId } from '@vtt/shared';
import {
  calculateCreatureSpellBlockNumbers,
  castReachesTargets,
  collectActiveEffects,
  getCreatureSpellBlockAbility,
  getCreatureSpellMod,
  getCreatureSpellRollButtonText,
  getDamagePartsPrimaryType,
  getDamageTemplateColor,
  getSpellAttackType,
  hasCreatureSpellUsesLeft,
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
  spellIsHealing,
} from '@vtt/shared/system/dnd.js';

import { ACTOR_SPELLS_TAB_LABELS } from '../ui/actor/constants';
import { CREATURE_ACTIONS_BLOCK_LABELS } from '../ui/creature/constants';
import { recordEntityActionSpend } from './actionSpend';
import { resolveTargetedAttackRoll } from './attackRollMode';
import { runWithCastFailure } from './castFailure';
import {
  requestDamageTypeChoiceFor,
  runWithDamageTypeChoices,
} from './damageTypeChoice';
import { runWithEffectVariants } from './effectVariantChoice';
import { buildRollBonusEvaluator } from './rollBonusEvaluator';
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

/** Чем входы каста существа различаются */
export interface CreatureSpellCasterPort {
  /** Существо */
  creatureId: string;
  /** Списывает применение заклинания (заряд или общий счётчик группы) */
  spendUse: (spell: Spell, placement?: CreatureSpellPlacement) => void;
  /** Каст не начался: говорит почему */
  refuse: (spell: Spell, refusal: SpellCastRefusal) => void;
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
 * заряды, трата хода, провал каста и применение, шаблон области — и окно.
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
      if (!hasCreatureSpellUsesLeft(spell, placement)) {
        port.refuse(spell, {
          title: ACTOR_SPELLS_TAB_LABELS.noUsesTitle,
          description: `${ACTOR_SPELLS_TAB_LABELS.noUsesTextPrefix}${spell.name}${ACTOR_SPELLS_TAB_LABELS.noUsesTextSuffix}`,
        });

        return;
      }

      recordEntityActionSpend(creature.id, resolveSpellCastCost(spell));

      /** Списывает применение заклинания */
      const spendUse = (): void => port.spendUse(spell, placement);

      // Провал каста («Замедление», «Слово силы: Боль»): применение тратится,
      // только если так велит правило
      runWithCastFailure(spell, creature, { loseUse: spendUse }, () => {
        spendUse();

        if (!spell.areaOfEffect) {
          openCreatureSpellRoll(spell, creature, undefined, placement);

          return;
        }

        // Область: шаблон у фишки существа, затем окно. Круг наложения группы
        // растит область так же, как ячейка персонажа
        useSpellTemplateStore().requestPlacement(
          resolveSpellAreaAtLevel(spell, placement?.ref.castLevel)
            ?? spell.areaOfEffect,
          getDamageTemplateColor(getDamagePartsPrimaryType(spell.damageParts)),
          creature.id,
          (templateId) =>
            openCreatureSpellRoll(spell, creature, templateId, placement),
          null,
        );
      });
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
 */
export function openCreatureSpellRoll(
  spell: Spell,
  creature: DnDCreature,
  templateId: string | undefined,
  placement: CreatureSpellPlacement | undefined,
): void {
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
   */
  const applyParts = (parts: RolledSpellDamagePart[]): void =>
    applyCreatureSpellParts(
      creature.id,
      castSpell,
      parts,
      templateId,
      casterSource,
      castKey,
    );

  useModalManager().openModal('DiceRollModal', {
    title: usesAttack
      ? `${CREATURE_ACTIONS_BLOCK_LABELS.attackRollPrefix}${spell.name}`
      : spell.name,
    rollLabel: spell.name,
    rollButtonText: getCreatureSpellRollButtonText(usesAttack, isHealing),
    formula: setup.baseParts[0]?.formula ?? '',
    attackModifier: usesAttack ? numbers.attackBonus : undefined,
    evaluateBonusRollFormulas: usesAttack
      ? buildRollBonusEvaluator(() => readCreature(creature.id), 'attack.spell')
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
        ? () => applyParts([])
        : undefined,
    damageTypeChoice,
    // Отмена окна обязана убрать шаблон: он размещается ДО броска
    onCancel: templateId ? () => discardSpellTemplate(templateId) : undefined,
    // Расход одноразовых эффектов «следующей атаки» на броске атаки существа
    attackerId: creature.id,
  });
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
 */
export function applyCreatureSpellParts(
  creatureId: string,
  pseudoSpell: Spell,
  parts: RolledSpellDamagePart[],
  templateId: string | undefined,
  casterSource: SpellCasterSource,
  castKey: string,
): void {
  const creature = readCreature(creatureId);

  if (!creature) {
    return;
  }

  const templateStore = useSpellTemplateStore();

  const cachedTemplate = templateId
    ? (templateStore.getPlacedTemplate(templateId) ?? null)
    : null;

  if (templateId) {
    templateStore.removePlacedTemplate(templateId);
    templateStore.deleteTemplate(templateId);
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

      void useSpellResolution().resolveSpellDamageWithParts(
        {
          spell: pseudoSpell,
          damageTotal: 0,
          spellSaveDC: casterSource.saveDc,
          actors,
          socket,
          casterId: creatureId,
        },
        parts,
        { scene: useWorldStore().currentScene, cachedTemplate },
      );
    },
  );
}
