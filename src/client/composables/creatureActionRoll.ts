/**
 * Действие существа — один путь на лист существа и горячую панель.
 *
 * Раньше лист (`CreatureActionsBlock.vue`: `openRollModal`, `startActionRoll`,
 * `applyActionParts`) и горячая панель (`dnd5eMacros.ts`: макрос
 * `creature-action`, `openCreatureActionRoll`, `applyCreatureActionParts`)
 * держали почти дословные копии — запрет, вид атаки, дистанция, трата хода,
 * урон «или», шаблон, окно броска и применение частей. Здесь один путь;
 * входы различаются портом ({@link CreatureActionPort}): как отказать и как
 * показать запись, которой нечего бросать и накладывать.
 */

import type {
  CreatureAction,
  CreatureActionSectionKey,
  DnDCreature,
  Spell,
} from '@vtt/shared/system/dnd.js';

import type { CreatureDamageVariant } from './creatureDamageChoice';
import type { CreatureRollSetup } from './useBonusDamageParts';
import type { RolledSpellDamagePart } from './useSpellResolution';

import { useChatStore } from '@/stores/chatStore';
import { useSpellTemplateStore } from '@/stores/spellTemplateStore';
import { useTargetStore } from '@/stores/targetStore';
import { useWorldStore } from '@/stores/worldStore';
import {
  collectActiveEffects,
  creatureActionHasSave,
  findCreatureActionBlock,
  getAttackBonusKey,
  getAttackFlagCategory,
  hasCreatureActionRoll,
  isCreatureAttackAction,
  isDndCreature,
  isTargetAtFullHp,
  resolveCreatureActionSaveDc,
  resolveCreatureSectionCost,
  resolveEntityActionBlocks,
} from '@vtt/shared/system/dnd.js';

import { SPELL_DAMAGE_ROLL_BUTTON } from '../ui/actor/constants';
import { checkCreatureActionRangeOnScene } from '../ui/creature/composables/useCreatureRangeCheck';
import {
  CREATURE_ACTION_BLOCKED_TITLE,
  CREATURE_ACTION_MENU_LABELS,
  CREATURE_ACTION_MISSING_REASON,
  CREATURE_ACTIONS_BLOCK_LABELS,
} from '../ui/creature/constants';
import { recordEntityActionSpend, warnOpportunityAttack } from './actionSpend';
import { runCreatureActionChoices } from './attackKindChoice';
import { resolveTargetedAttackRoll } from './attackRollMode';
import {
  buildCreatureRollVariants,
  launchCreatureAction,
  runDamagelessCreatureAction,
  runWithCreatureDamageChoice,
} from './creatureDamageChoice';
import { openDiceRollWindow } from './diceRollWindow';
import {
  applyActionSelfEffects,
  applyActionUseEffects,
  hasActionUseEffects,
} from './effectActivationUse';
import { isEntityOwnTurn } from './encounterTurn';
import { buildRollBonusEvaluator } from './rollBonusEvaluator';
import { discardSpellTemplate } from './spellResolutionShared';
import { useBonusDamageParts } from './useBonusDamageParts';
import { listAmbientEffects } from './useResolvedStats';
import { announceOutOfReach } from './useSceneRangeCheck';
import { useSpellResolution } from './useSpellResolution';
import { useWorldEntities } from './useWorldEntities';

/** Чем входы действия существа различаются */
export interface CreatureActionPort {
  /** Существо */
  creatureId: string;
  /** Раздел статблока: по нему — трата хода и «одна атака за ход» */
  section: CreatureActionSectionKey | undefined;
  /**
   * Действие не совершить сейчас: лист — уведомлением, панель — в чат
   *
   * @param title - заголовок отказа
   * @param reason - почему
   */
  refuse: (title: string, reason: string) => void;
  /**
   * Запись без броска и без эффектов («Ловкий побег»): показать, что существо
   * сделало, — лист отправляет карточку, панель — описание строкой
   */
  announce: (action: CreatureAction) => void;
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
 * Трата хода раздела («Замедление») — когда действие точно идёт: отказ по
 * дистанции её не тратит. Удар вне своего хода при запрете провоцированных
 * атак предупреждается здесь же, до окна броска.
 *
 * @param port - вход действия
 * @param action - действие с броском; нет — действие без броска
 */
function spendCreatureActionTurn(
  port: CreatureActionPort,
  action?: CreatureAction,
): void {
  const isAttack =
    action !== undefined && isCreatureAttackAction(port.section, action);

  if (port.section) {
    recordEntityActionSpend(
      port.creatureId,
      resolveCreatureSectionCost(port.section),
      isAttack,
    );
  }

  if (isAttack) {
    warnOpportunityAttack(port.creatureId);
  }
}

/**
 * Совершает действие существа: запрет трат хода, вид атаки, затем либо
 * эффекты без броска, либо дистанция, трата хода, урон «или», шаблон и окно.
 *
 * @param sourceAction - действие; вид атаки и эффекты ещё не выбраны
 * @param port - вход действия
 */
export function startCreatureAction(
  sourceAction: CreatureAction,
  port: CreatureActionPort,
): void {
  const creature = readCreature(port.creatureId);

  if (!creature) {
    port.refuse(CREATURE_ACTION_BLOCKED_TITLE, CREATURE_ACTION_MISSING_REASON);

    return;
  }

  // Запрет трат хода («Электрошок» — нет реакций) и вторая атака действием
  // под «одной атакой за ход»
  const blocked = port.section
    ? findCreatureActionBlock(
        resolveEntityActionBlocks(creature, listAmbientEffects(creature.id)),
        port.section,
        sourceAction,
        isEntityOwnTurn(creature.id),
      )
    : null;

  if (blocked) {
    port.refuse(CREATURE_ACTION_BLOCKED_TITLE, blocked);

    return;
  }

  runCreatureActionChoices(sourceAction, creature.id, (action) => {
    // Действие без броска только накладывает эффекты — на само существо или
    // на выбранную цель; окна броска нет — тип урона на выбор спрашивает
    // плашка, получателя «на цель» выбирают на карте
    if (!hasCreatureActionRoll(action)) {
      spendCreatureActionTurn(port);

      // Записи без броска и эффектов накладывать нечего: что существо
      // сделало, показывает запись в чате
      if (!hasActionUseEffects(action)) {
        port.announce(action);

        return;
      }

      applyActionUseEffects(action, creature.id);

      return;
    }

    // Дистанция — только у прямых атак (область выбирается шаблоном)
    let isDisadvantage = false;

    const { targetTokenId } = useTargetStore();

    if (!action.areaOfEffect && targetTokenId) {
      const rangeCheck = checkCreatureActionRangeOnScene(
        action,
        creature.id,
        targetTokenId,
      );

      if (rangeCheck && !rangeCheck.allowed) {
        announceOutOfReach(action.name, rangeCheck);

        return;
      }

      isDisadvantage = Boolean(rangeCheck?.disadvantage);
    }

    // Урон «или» решается после проверки дистанции: состояние и случай —
    // сразу, выбор человека — полем «Урон» в окне броска
    runWithCreatureDamageChoice(
      action,
      creature,
      (chosen, variants, announceChoice) =>
        launchCreatureAction(chosen, creature.id, (templateId) => {
          // Ход и строка чата — когда действие состоялось: отказ по
          // дистанции и неоткрывшееся окно хода не тратят, шаблон убирается
          if (
            openCreatureActionRoll(
              chosen,
              creature,
              isDisadvantage,
              templateId,
              variants,
            )
          ) {
            spendCreatureActionTurn(port, action);
            announceChoice();
          } else if (templateId) {
            discardSpellTemplate(templateId);
          }
        }),
    );
  });
}

/**
 * Окно броска действия существа — многочастный путь, общий с заклинаниями и
 * оружием. Атаки — с броском попадания; спасброски и область — без него,
 * спасброски и эффекты разбирает оркестратор по каждой задетой цели.
 *
 * @param action - действие существа
 * @param creature - существо-источник
 * @param isDisadvantage - стартовать с помехой (проверка дистанции)
 * @param templateId - размещённый шаблон области
 * @param variants - наборы урона «или» на выбор в окне; пусто — набор один
 * @returns `true` — действие состоялось: окно открылось или действие без
 *   урона применено сразу
 */
export function openCreatureActionRoll(
  action: CreatureAction,
  creature: DnDCreature,
  isDisadvantage: boolean,
  templateId: string | undefined,
  variants: readonly CreatureDamageVariant[] = [],
): boolean {
  const { buildCreatureRollSetup, buildTargetHpContext } =
    useBonusDamageParts();

  const usesSaveOrArea = creatureActionHasSave(action) || !!action.areaOfEffect;
  const effects = collectActiveEffects(creature);

  // Хиты цели для @target.* — только у одиночной цели (не у области)
  const targetHp = action.areaOfEffect ? undefined : buildTargetHpContext();

  // Полные хиты — тем же правилом, что у заклинаний и оружия (с эффектами на
  // максимум)
  const targetIsFull = action.areaOfEffect
    ? undefined
    : isTargetAtFullHp(useTargetStore().getTargetActor());

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
      creature.id,
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
    return false;
  }

  // Спасбросок или область без урона: бросать существу нечего — цели
  // спасаются сами, эффекты ложатся по исходу
  if (
    runDamagelessCreatureAction(
      action,
      rollVariants,
      (chosenAction) => buildSetup(chosenAction).pseudoSpell,
      applyParts,
    )
  ) {
    return true;
  }

  const actionAttackRoll = usesSaveOrArea
    ? undefined
    : resolveTargetedAttackRoll(
        creature,
        getAttackFlagCategory(action.rangeType),
        { forceDisadvantage: isDisadvantage },
      );

  const opened = openDiceRollWindow({
    title: usesSaveOrArea
      ? action.name
      : `${CREATURE_ACTIONS_BLOCK_LABELS.attackRollPrefix}${action.name}`,
    rollLabel: action.name,
    rollButtonText: usesSaveOrArea
      ? SPELL_DAMAGE_ROLL_BUTTON
      : CREATURE_ACTION_MENU_LABELS.attack,
    formula: primary.formula,
    attackModifier: usesSaveOrArea ? undefined : action.attackBonus,
    evaluateBonusRollFormulas: usesSaveOrArea
      ? undefined
      : buildRollBonusEvaluator(
          () => readCreature(creature.id),
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
    // Отмена окна обязана убрать шаблон: он размещается ДО броска
    onCancel: templateId ? () => discardSpellTemplate(templateId) : undefined,
    // Расход одноразовых эффектов «следующей атаки» на броске атаки существа
    attackerId: creature.id,
  });

  return opened !== null;
}

/**
 * Применяет брошенные части действия через многочастный оркестратор
 * (спасброски целей, защиты по типу, шаблон области, единая запись хитов),
 * затем эффекты действия на самом существе.
 *
 * @param creatureId - существо-источник
 * @param action - действие (источник Сл спасброска)
 * @param pseudoSpell - псевдо-заклинание действия
 * @param parts - брошенные части урона
 * @param templateId - размещённый шаблон области
 */
export function applyCreatureActionParts(
  creatureId: string,
  action: CreatureAction,
  pseudoSpell: Spell,
  parts: RolledSpellDamagePart[],
  templateId: string | undefined,
): void {
  const socket = useChatStore().getSocket();
  const actors = useWorldEntities().getCurrentWorldEntities();
  const templateStore = useSpellTemplateStore();

  const cachedTemplate = templateId
    ? (templateStore.getPlacedTemplate(templateId) ?? null)
    : null;

  if (templateId) {
    templateStore.removePlacedTemplate(templateId);
  }

  if (actors.length > 0 && socket) {
    void useSpellResolution().resolveSpellDamageWithParts(
      {
        spell: pseudoSpell,
        damageTotal: 0,
        spellSaveDC: resolveCreatureActionSaveDc(action),
        actors,
        socket,
        casterId: creatureId,
      },
      parts,
      { scene: useWorldStore().currentScene, cachedTemplate },
    );
  }

  if (templateId) {
    templateStore.deleteTemplate(templateId);
  }

  applyActionSelfEffects(action, creatureId);
}
