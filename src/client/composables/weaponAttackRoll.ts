/**
 * Атака оружием — один путь на вкладку снаряжения и горячую панель.
 *
 * Раньше вкладка снаряжения (`ActorEquipmentTab.vue`: `openRollModal`,
 * `handleWeaponRollParts`) и горячая панель (макрос атаки оружием в
 * `dnd5eMacros.ts`) держали по своей копии удара, и копии разошлись: лист не
 * проверял дистанцию до цели (удар на дальней дистанции шёл без помехи,
 * удар за пределом — без отказа), панель не передавала предмет броска в
 * условные бонусы («только этим предметом» с панели не срабатывало), а
 * полные хиты цели считала иначе, чем лист. Здесь один путь; порт у входов
 * один ({@link createWeaponAttackPort}), различается только отказ.
 */

import type {
  DnDGameItem,
  DnDSceneEntity,
  Spell,
} from '@vtt/shared/system/dnd.js';

import type { AttackRollSnapshot } from './attackRollSnapshot';
import type { RolledSpellDamagePart } from './useSpellResolution';

import { useChatStore } from '@/stores/chatStore';
import { useTargetStore } from '@/stores/targetStore';
import { useWorldStore } from '@/stores/worldStore';
import {
  calculateWeaponAttackModifier,
  checkRange,
  evaluateConditionalBonuses,
  getAttackBonusKey,
  getAttackFlagCategory,
  getDamageBonusKey,
  getWeaponPrimaryDamageType,
  isSaveAbility,
  isTargetAtFullHp,
  resolveWeaponSaveDc,
} from '@vtt/shared/system/dnd.js';

import {
  ACTOR_EQUIPMENT_TAB_LABELS,
  ACTOR_SPELLS_TAB_LABELS,
  SPELL_DAMAGE_ROLL_BUTTON,
} from '../ui/actor/constants';
import {
  recordEntityActionSpend,
  runWithWeaponAttackCost,
} from './actionSpend';
import { runWeaponAttackChoices } from './attackKindChoice';
import {
  resolveTargetedAttackRoll,
  resolveTargetedCritThreshold,
} from './attackRollMode';
import { listAttackResolutionEntities } from './attackRollSnapshot';
import { requestDamageTypeChoiceFor } from './damageTypeChoice';
import { buildRollSourceKey, openDiceRollWindow } from './diceRollWindow';
import {
  prepareAmmunitionShot,
  spendShotAmmunition,
} from './effectActivationUse';
import { buildRollBonusEvaluator } from './rollBonusEvaluator';
import { refuseWhileSheetEditing } from './sheetEditLock';
import { useBonusDamageParts } from './useBonusDamageParts';
import {
  buildEntityFormulaContext,
  collectEffectsWithAuras,
  resolveEntityStats,
} from './useResolvedStats';
import {
  announceOutOfReach,
  measureTokenDistanceOnScene,
} from './useSceneRangeCheck';
import { useSpellResolution } from './useSpellResolution';
import { useWorldEntities } from './useWorldEntities';

/**
 * Атакующий общего удара. Входы (вкладка снаряжения, горячая панель)
 * собирают его одной фабрикой {@link createWeaponAttackPort} и различаются
 * только отказом.
 */
export interface WeaponAttackPort {
  /** Атакующий сейчас */
  readAttacker: () => DnDSceneEntity | undefined;
  /** Тратит боеприпас выстрела, когда бросок пошёл */
  spendAmmunition: (ammunitionId: string) => void;
  /** Удар сейчас недоступен: лист — уведомлением, панель — в чат */
  refuse: (reason: string) => void;
}

/**
 * Атакующий мира: читается из мира в момент обращения, боеприпас пишется
 * помощником записи листа из свежей сущности.
 *
 * Не через `emit` и `props` вкладки: боеприпас тратит бросок окна, а окно
 * живёт в менеджере окон и переживает вкладку (`v-if`) и лист — `emit`
 * размонтированного компонента ничего не делает, и стрела оставалась в
 * колчане при потраченном действии.
 *
 * @param attackerId - атакующий
 * @param refuse - отказ входа: лист — уведомлением, панель — в чат
 * @returns порт удара
 */
export function createWeaponAttackPort(
  attackerId: string,
  refuse: WeaponAttackPort['refuse'],
): WeaponAttackPort {
  return {
    readAttacker: () => useWorldEntities().findCurrentDndEntity(attackerId),
    spendAmmunition: (ammunitionId) =>
      spendShotAmmunition(attackerId, ammunitionId),
    refuse,
  };
}

/** Итог проверки дистанции удара по выбранной цели */
interface WeaponRangeCheck {
  allowed: boolean;
  disadvantage: boolean;
  distance: number;
  unitLabel: string;
}

/**
 * Дистанция между атакующим и выбранной целью на текущей сцене.
 *
 * @param weapon - оружие удара
 * @param attackerId - атакующий
 * @param targetTokenId - фишка цели
 * @returns проверка дистанции; нет фишек на сцене — `null`
 */
export function checkWeaponRangeOnScene(
  weapon: DnDGameItem,
  attackerId: string,
  targetTokenId: string,
): WeaponRangeCheck | null {
  const measurement = measureTokenDistanceOnScene(attackerId, targetTokenId);

  if (!measurement) {
    return null;
  }

  return {
    ...checkRange(weapon, measurement.distance),
    distance: measurement.distance,
    unitLabel: measurement.unitLabel,
  };
}

/**
 * Наносит удар оружием: запрет трат хода и чем удар совершается, боеприпас,
 * вид атаки, дистанция до выбранной цели — и окно броска.
 *
 * @param sourceWeapon - оружие; вид атаки ещё не выбран
 * @param port - вход удара
 */
export function startWeaponAttack(
  sourceWeapon: DnDGameItem,
  port: WeaponAttackPort,
): void {
  const attacker = port.readAttacker();

  // Лист атакующего в режиме правки — удар ждёт «Сохранить» или отмены
  if (!attacker || refuseWhileSheetEditing(attacker.id)) {
    return;
  }

  // Запрет трат хода («Замедление» после бонусного действия) — до окна; там
  // же решается, чем удар совершается
  runWithWeaponAttackCost(
    attacker,
    sourceWeapon.name,
    port.refuse,
    (attackCost) => {
      // Стрелковое оружие стреляет боеприпасом, если лист их ведёт: без него
      // атаки нет, его бонус и эффекты идут в бросок
      const shot = prepareAmmunitionShot(attacker, sourceWeapon);

      if (!shot) {
        return;
      }

      const ammunitionId = shot.ammunition?.id;

      runWeaponAttackChoices(shot.weapon, attacker.id, (weapon) => {
        if (!weapon.damageParts?.length) {
          return;
        }

        // Дистанция до выбранной цели (`checkRange`): за пределом — отказ, на
        // дальней дистанции — помеха
        const { targetTokenId } = useTargetStore();

        const rangeCheck = targetTokenId
          ? checkWeaponRangeOnScene(weapon, attacker.id, targetTokenId)
          : null;

        if (rangeCheck && !rangeCheck.allowed) {
          announceOutOfReach(weapon.name, rangeCheck);

          return;
        }

        openWeaponAttackRoll(weapon, attacker, port, {
          isDisadvantage: Boolean(rangeCheck?.disadvantage),
          // Боеприпас и действие хода тратятся, когда бросок пошёл, а не при
          // открытии окна
          beforeRoll: () => {
            if (ammunitionId) {
              port.spendAmmunition(ammunitionId);
            }

            recordEntityActionSpend(attacker.id, attackCost, true);

            return true;
          },
        });
      });
    },
  );
}

/**
 * Окно броска удара — многочастный путь, общий с заклинаниями: части урона
 * оружия и бонус-части эффектов. Оружие со спасброском броска попадания не
 * делает — цель кидает спасбросок.
 *
 * @param weapon - оружие (вид атаки выбран, боеприпас учтён)
 * @param attacker - атакующий
 * @param port - вход удара
 * @param options - помеха по дистанции и расход перед броском
 * @param options.isDisadvantage - стартовать с помехой
 * @param options.beforeRoll - расход боеприпаса и хода, когда бросок пошёл
 */
export function openWeaponAttackRoll(
  weapon: DnDGameItem,
  attacker: DnDSceneEntity,
  port: WeaponAttackPort,
  options: { isDisadvantage: boolean; beforeRoll: () => boolean },
): void {
  const resolvedStats = resolveEntityStats(attacker);

  const combinedEffects = collectEffectsWithAuras(attacker);
  const attackKey = getAttackBonusKey(weapon.rangeType);
  const damageKey = getDamageBonusKey(weapon.rangeType);

  const baseMod = calculateWeaponAttackModifier(
    attacker,
    weapon,
    resolvedStats,
  );

  // Оружие со спасброском: цель кидает спас, броска попадания нет
  const hasSave = isSaveAbility(weapon.saveType);
  const weaponSaveDC = resolveWeaponSaveDc(baseMod);
  const incomingAttackType = getAttackFlagCategory(weapon.rangeType);

  const weaponAttackRoll = resolveTargetedAttackRoll(
    attacker,
    incomingAttackType,
    { forceDisadvantage: options.isDisadvantage },
  );

  const { buildWeaponRollSetup, buildTargetHpContext, buildTargetTypeContext } =
    useBonusDamageParts();

  // Хиты цели — для условных веток @target.full / @target.notFull: тем же
  // правилом, что у заклинаний (с эффектами на максимум)
  const weaponPartsSetup = buildWeaponRollSetup({
    weapon,
    actor: attacker,
    effects: combinedEffects,
    resolvedStats,
    targetIsFull: isTargetAtFullHp(useTargetStore().getTargetActor()),
    targetType: buildTargetTypeContext(),
  });

  // Тип урона на выбор спрашивает окно броска: части урона решает оно само,
  // а эффекты оружия на цель получают тот же тип здесь
  let weaponSpell = weaponPartsSetup.pseudoSpell;

  const damageTypeChoice = requestDamageTypeChoiceFor(
    weapon,
    weaponPartsSetup.pseudoSpell,
    (chosen) => {
      weaponSpell = chosen;
    },
  );

  openDiceRollWindow(
    {
      title: `${ACTOR_EQUIPMENT_TAB_LABELS.attackRollPrefix}${weapon.name}`,
      rollLabel: weapon.name,
      rollButtonText: hasSave
        ? SPELL_DAMAGE_ROLL_BUTTON
        : ACTOR_SPELLS_TAB_LABELS.attackRoll,
      // Формула для показа: бросок идёт многочастным путём по частям
      formula: weaponPartsSetup.baseParts[0]?.formula ?? '',
      attackModifier: hasSave ? undefined : baseMod,
      evaluateBonusRollFormulas: hasSave
        ? undefined
        : buildRollBonusEvaluator(
            () =>
              useWorldEntities().findCurrentDndEntity(attacker.id)
              ?? port.readAttacker(),
            attackKey,
          ),
      initialRollMode: weaponAttackRoll.mode,
      rollModeReasons: weaponAttackRoll.reasons,
      critThreshold: resolveTargetedCritThreshold(
        attacker,
        resolvedStats.critThreshold,
      ),
      incomingAttackType,
      evaluateConditionalBonuses: (modalContext: {
        hasAdvantage: boolean;
        hasDisadvantage: boolean;
      }) => {
        // Хиты цели читаются в момент броска — для условий target.hp.*
        // («Убийца»); предмет броска — для «только этим предметом»
        const rollContext = {
          ...modalContext,
          target: buildTargetHpContext(undefined, attacker.id),
          itemId: weapon.id,
        };

        // Условный бонус может быть формулой (`@prof`, `@mod.dex`) — от
        // итоговых чисел атакующего
        const formulaContext = buildEntityFormulaContext(
          attacker,
          resolvedStats,
        );

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
      damageType: getWeaponPrimaryDamageType(weapon, resolvedStats),
      damageParts: weaponPartsSetup.baseParts,
      evaluateBonusDamageParts: weaponPartsSetup.evaluateBonusDamageParts,
      // Эффекты «на цель» гейтит оркестратор (по спасброску и попаданию);
      // прямого `onHit` нет — он вешал эффект на каждое попадание мимо спасброска
      onRollParts: (
        parts: RolledSpellDamagePart[],
        attack?: AttackRollSnapshot,
      ) =>
        applyWeaponAttackParts(
          attacker.id,
          weaponSpell,
          parts,
          weaponSaveDC,
          attack,
        ),
      damageTypeChoice,
      // Расход одноразовых эффектов «следующей атаки» (Злая насмешка и т.п.)
      attackerId: attacker.id,
      beforeRoll: options.beforeRoll,
    },
    // Повторный удар тем же оружием заменяет своё прежнее окно. Ход и
    // боеприпас тратит бросок — замена ничего не тратит
    { sourceKey: buildRollSourceKey(attacker.id, 'weapon', weapon.id) },
  );
}

/**
 * Применяет брошенные части удара многочастным оркестратором: защиты по типу
 * на каждую часть, гейты @target.*, спасбросок оружия, единая запись хитов.
 *
 * @param attackerId - атакующий
 * @param pseudoSpell - псевдо-заклинание оружия (со спасброском оружия)
 * @param parts - брошенные части урона
 * @param spellSaveDC - Сл спасброска оружия
 * @param attack - снимок броска атаки: стороны удара считаются с эффектами,
 *   которые бросок израсходовал
 */
export function applyWeaponAttackParts(
  attackerId: string,
  pseudoSpell: Spell,
  parts: RolledSpellDamagePart[],
  spellSaveDC: number,
  attack?: AttackRollSnapshot,
): void {
  const socket = useChatStore().getSocket();
  const actors = listAttackResolutionEntities(attack);

  if (actors.length === 0 || !socket) {
    return;
  }

  void useSpellResolution().resolveSpellDamageWithParts(
    {
      spell: pseudoSpell,
      damageTotal: 0,
      spellSaveDC,
      actors,
      socket,
      casterId: attackerId,
      attack,
    },
    parts,
    { scene: useWorldStore().currentScene },
  );
}
