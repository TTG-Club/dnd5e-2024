/**
 * Трата хода носителя в бою — для ограничений «за ход одно из» («Замедление»:
 * действие или бонусное действие; «Психическая плеть Таши»: ещё и
 * перемещение) и «одна атака за ход» (`actionRestrictions.ts`).
 *
 * Записывается там же, где стоит проверка запрета: каст заклинания, удар
 * оружием, действие статблока, «вырваться», действие эффекта. Счётчик живёт в
 * счётчиках хода носителя и уезжает боевым каналом; обнуляет его сервер в
 * конце хода. У носителя без флага и вне боя ничего не пишется. Перемещение
 * пишет сервер сам — он его и видит.
 *
 * Здесь же цена удара оружием (действие «Атака», вне своего хода — реакция,
 * по слову бьющего — бонусное действие) и предупреждение об ударе вне своего
 * хода носителю без провоцированных атак («Электрошок»).
 */

import type {
  DnDSceneEntity,
  EffectActionCost,
  RestrictedActionCost,
} from '@vtt/shared/system/dnd.js';

import { useModalManager } from '@/shared_ui/composables/useModalManager';
import { useChatStore } from '@/stores/chatStore';
import {
  formatActionCostBlock,
  isRestrictedActionCost,
  planWeaponAttack,
  recordActionSpend,
  resolveActionCostBlock,
  resolveAttackCost,
  resolveOpportunityAttackWarning,
  WEAPON_DECLARED_ATTACK_COST,
  withTriggerUsage,
} from '@vtt/shared/system/dnd.js';

import { useSystemToastStore } from '../stores/systemToastStore';
import {
  EFFECT_QUESTION_PROMPT_MODAL,
  OPPORTUNITY_ATTACK_WARNING_LABELS,
  WEAPON_ATTACK_COST_PROMPT_LABELS,
} from '../ui/effect/constants';
import { isEntityOwnTurn, resolveCombatRound } from './encounterTurn';
import { changeEntityCombatState } from './entityCombatWrite';
import { listAmbientEffects } from './useResolvedStats';
import { useWorldEntities } from './useWorldEntities';

/**
 * Предупреждает о запрещённой трате хода («нет бонусных действий», «нет
 * реакций») и говорит, пускать ли действие дальше.
 *
 * @param entity - кто тратит
 * @param cost - что тратит; нет — запрещать нечего
 * @param title - заголовок предупреждения: что именно не пустили
 * @returns `true`, если трата запрещена и действие надо остановить
 */
export function warnActionCostBlocked(
  entity: DnDSceneEntity,
  cost: EffectActionCost | undefined,
  title: string,
): boolean {
  const blocked = resolveActionCostBlock(
    entity,
    cost,
    listAmbientEffects(entity.id),
  );

  if (!blocked) {
    return false;
  }

  useSystemToastStore().add({
    title,
    description: formatActionCostBlock(blocked),
    color: 'warning',
  });

  return true;
}

/**
 * Отмечает трату хода носителя.
 *
 * @param entityId - кто тратит
 * @param cost - что тратит; нет — трата не считается
 * @param attack - трата — атака (удар оружием, атака из раздела «Действия»
 *   статблока). Вне своего хода атака действием — реакция; «одна атака за
 *   ход» считает только атаку действием
 */
export function recordEntityActionSpend(
  entityId: string | undefined,
  cost: EffectActionCost | undefined,
  attack = false,
): void {
  // Вне боя хода нет — и обнулить счётчик было бы некому
  if (resolveCombatRound() === undefined) {
    return;
  }

  changeEntityCombatState(entityId, (entity) => {
    // Удар вне своего хода — реакция: ни действием, ни атакой хода не считается
    const spendCost =
      attack && isRestrictedActionCost(cost)
        ? resolveAttackCost(cost, isEntityOwnTurn(entity.id))
        : cost;

    const ledger = recordActionSpend(entity, spendCost, {
      attack,
      ambientEffects: listAmbientEffects(entity.id),
    });

    // Новый объект: живую запись стора меняет только ответ сервера
    return ledger ? withTriggerUsage(entity, ledger) : null;
  });
}

/**
 * Решает, чем персонаж бьёт оружием, и пускает удар дальше. В свой ход удар —
 * действие «Атака», вне хода — реакция. Под «одной атакой за ход» второй удар
 * не гаснет молча: своего поля цены у оружия нет, поэтому бьющего спрашивают,
 * не бонусным ли действием он бьёт, — ответ уходит в чат. Закрытая плашка
 * отменяет удар. Удар вне своего хода носителю без провоцированных атак
 * предупреждается здесь же — до окна броска.
 *
 * @param entity - кто бьёт
 * @param weaponName - чем бьёт: заголовок вопроса и строка чата
 * @param refuse - удар запрещён: причина словами
 * @param proceed - удар идёт: чем он совершается
 */
export function runWithWeaponAttackCost(
  entity: DnDSceneEntity,
  weaponName: string,
  refuse: (reason: string) => void,
  proceed: (cost: RestrictedActionCost) => void,
): void {
  const plan = planWeaponAttack(
    entity,
    isEntityOwnTurn(entity.id),
    listAmbientEffects(entity.id),
  );

  if (plan.blocked === null) {
    // Предупреждение — до окна броска: бьющий видит его, пока ещё решает,
    // бить ли; раньше оно появлялось только после броска, и окно открывалось
    // молча
    warnOpportunityAttack(entity.id);
    proceed(plan.cost);

    return;
  }

  if (!plan.canDeclareBonus) {
    refuse(plan.blocked);

    return;
  }

  useModalManager().openModal(EFFECT_QUESTION_PROMPT_MODAL, {
    allowMultiple: true,
    question: `${plan.blocked}${WEAPON_ATTACK_COST_PROMPT_LABELS.questionSuffix}`,
    options: [
      {
        id: WEAPON_DECLARED_ATTACK_COST,
        label: WEAPON_ATTACK_COST_PROMPT_LABELS.bonus,
      },
    ],
    sourceName: weaponName,
    onAnswer: () => {
      useChatStore().sendMessage(
        `${weaponName}${WEAPON_ATTACK_COST_PROMPT_LABELS.chatSuffix}`,
        'text',
      );

      proceed(WEAPON_DECLARED_ATTACK_COST);
    },
    onCancel: () => {},
  });
}

/**
 * Предупреждает об ударе вне своего хода, если носителю запрещены
 * провоцированные атаки. Удар не отменяет: вне хода бьют и по заготовленному
 * действию — решает стол.
 *
 * @param entityId - кто бьёт
 */
export function warnOpportunityAttack(entityId: string): void {
  // Вне боя и в свой ход провоцированных атак не бывает
  if (isEntityOwnTurn(entityId)) {
    return;
  }

  const entity = useWorldEntities().findCurrentDndEntity(entityId);

  const warning = entity
    ? resolveOpportunityAttackWarning(entity, listAmbientEffects(entityId))
    : null;

  if (warning !== null) {
    useSystemToastStore().add({
      title: OPPORTUNITY_ATTACK_WARNING_LABELS.title,
      description: `${warning}${OPPORTUNITY_ATTACK_WARNING_LABELS.suffix}`,
      color: 'warning',
    });
  }
}
