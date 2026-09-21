/**
 * Применение эффектов на столе: предмет пунктом «Использовать», эффект листа
 * кнопкой «Применить», боеприпас — выстрелом.
 *
 * Применение идёт путём заклинания: псевдо-заклинание источника несёт эффекты
 * применения, эффекты «на носителе» ложатся на применившего боевым каналом (там
 * же сервер будит срабатывания «при наложении» — зелье лечит), эффекты «на
 * цели» — на выбранную цель тем же разбором, что и у заклинаний.
 */

import type {
  CreatureAction,
  DnDGameItem,
  DnDSceneEntity,
  Spell,
} from '@vtt/shared/system/dnd.js';

import { emitEntityUpdate } from '@/core/entityUtils';
import { useChatStore } from '@/stores/chatStore';
import { useTargetStore } from '@/stores/targetStore';
import {
  buildItemUseSpell,
  buildUseSpell,
  canUseItem,
  findWeaponAmmunition,
  getCasterSpellEffects,
  isItemDepleted,
  resolveActorStats,
  spendAmmunition,
  spendItemUse,
  tracksWeaponAmmunition,
  withAmmunition,
} from '@vtt/shared/system/dnd.js';

import { useSystemToastStore } from '../stores/systemToastStore';
import { EFFECT_USE_LABELS } from '../ui/effect/constants';
import { runWithEffectVariants } from './effectVariantChoice';
import { applyCasterSpellEffectsToEntity } from './spellCastCompletion';
import { applySpellTargetEffects } from './spellEffectTargeting';
import { getTargetSpellEffects } from './spellResolutionShared';
import { listAmbientEffects } from './useResolvedStats';
import { useWorldEntities } from './useWorldEntities';

/** Выстрел с учётом боеприпаса */
export interface AmmunitionShot {
  /** Оружие выстрела: бонус и эффекты боеприпаса уже учтены */
  weapon: DnDGameItem;
  /** Боеприпас выстрела; нет — лист боеприпасы этого оружия не ведёт */
  ammunition?: DnDGameItem;
}

/**
 * Применяет эффекты псевдо-заклинания применения: сначала выбор варианта,
 * затем проверка цели, расход и наложение.
 *
 * @param spell - псевдо-заклинание применения
 * @param user - кто применяет
 * @param saveDc - Сл применившего: ею заменяется Сл 0 эффекта
 * @param spend - расход источника; зовётся до наложения, чтобы сохранение
 *   листа не затёрло наложенные эффекты
 */
export function applyEffectSource(
  spell: Spell,
  user: DnDSceneEntity,
  saveDc: number,
  spend: () => void,
): void {
  runWithEffectVariants(spell, (chosen) => {
    const needsTarget = getTargetSpellEffects(chosen).length > 0;

    // Не `useToast()`: сюда приходят из обработчика клика и с панели быстрого
    // доступа, где его вызов молча глушится
    if (needsTarget && !useTargetStore().getTargetActor()) {
      useSystemToastStore().add({
        title: EFFECT_USE_LABELS.noTargetTitle,
        description: EFFECT_USE_LABELS.noTargetText,
        color: 'warning',
      });

      return;
    }

    spend();

    // Что сделало применение, пишут список наложенного, разбор цели и исход
    // срабатываний — отдельная строка «применяет» их бы только повторяла
    applyCasterSpellEffectsToEntity(chosen, user, { saveDc });

    if (needsTarget) {
      applySpellTargetEffects(chosen, {
        casterId: user.id,
        spellSaveDC: saveDc,
      });
    }
  });
}

/**
 * Есть ли у действия существа эффекты «на себя».
 *
 * @param action - действие
 * @returns `true`, если действие что-то накладывает на само существо
 */
export function hasActionSelfEffects(
  action: Pick<CreatureAction, 'activeEffects'>,
): boolean {
  return getCasterSpellEffects(action).length > 0;
}

/**
 * Накладывает на существо эффекты «на себя» его действия («Полтергейст»
 * становится невидимым, «Блуждающий огонёк» гасит свет) — после броска или
 * сразу, если бросать нечего. Существо берётся из мира в момент наложения:
 * урон того же действия мог уже изменить его хиты.
 *
 * @param action - действие существа
 * @param creatureId - существо
 */
export function applyActionSelfEffects(
  action: Pick<CreatureAction, 'name' | 'activeEffects' | 'saveDC'>,
  creatureId: string,
): void {
  const creature = useWorldEntities().findCurrentDndEntity(creatureId);

  if (!creature) {
    return;
  }

  if (!hasActionSelfEffects(action)) {
    return;
  }

  applyCasterSpellEffectsToEntity(
    buildUseSpell({
      id: `${creatureId}-${action.name}`,
      name: action.name,
      effects: action.activeEffects ?? [],
      rollSource: 'creatureAction',
    }),
    creature,
    { saveDc: action.saveDC ?? 0 },
  );
}

/**
 * Готовит атаку оружием: закончившимся оружием не бьют; у оружия с
 * боеприпасами, которые лист ведёт, берёт боеприпас и складывает его бонус и
 * эффекты с оружием.
 *
 * @param entity - стрелок
 * @param weapon - оружие
 * @returns выстрел либо `null`, если бить нечем (в чат ушло пояснение)
 */
export function prepareAmmunitionShot(
  entity: DnDSceneEntity,
  weapon: DnDGameItem,
): AmmunitionShot | null {
  if (isItemDepleted(weapon)) {
    useChatStore().sendMessage(
      `${EFFECT_USE_LABELS.blockedPrefix}${weapon.name}${EFFECT_USE_LABELS.depletedSuffix}`,
      'text',
    );

    return null;
  }

  const equipment = entity.equipment ?? [];

  if (!tracksWeaponAmmunition(equipment, weapon)) {
    return { weapon };
  }

  const ammunition = findWeaponAmmunition(equipment, weapon);

  if (!ammunition) {
    useChatStore().sendMessage(
      `${EFFECT_USE_LABELS.blockedPrefix}${weapon.name}${EFFECT_USE_LABELS.noAmmunitionSuffix}`,
      'text',
    );

    return null;
  }

  return { weapon: withAmmunition(weapon, ammunition), ammunition };
}

/**
 * Меняет инвентарь актуальной сущности мира — для путей без листа (панель
 * быстрого доступа).
 *
 * @param entityId - владелец
 * @param change - новый инвентарь по текущему
 */
function updateEntityEquipment(
  entityId: string,
  change: (equipment: readonly DnDGameItem[]) => DnDGameItem[],
): void {
  const socket = useChatStore().getSocket();
  const entity = useWorldEntities().findCurrentDndEntity(entityId);

  if (!socket || !entity) {
    return;
  }

  // Новый объект: живую запись стора меняет только ответ сервера
  const updated: DnDSceneEntity = {
    ...entity,
    equipment: change(entity.equipment ?? []),
  };

  emitEntityUpdate(socket, updated);
}

/**
 * Тратит боеприпас выстрела у актуальной сущности мира — для путей без листа
 * (панель быстрого доступа).
 *
 * @param entityId - стрелок
 * @param ammunitionId - боеприпас
 */
export function spendShotAmmunition(
  entityId: string,
  ammunitionId: string,
): void {
  updateEntityEquipment(entityId, (equipment) =>
    spendAmmunition(equipment, ammunitionId),
  );
}

/**
 * Применяет предмет сущности мира без листа — кнопкой панели быстрого
 * доступа: эффекты применения ложатся на владельца или цель, предмет теряет
 * заряд или единицу количества.
 *
 * @param entityId - владелец предмета
 * @param itemId - предмет
 */
export function applyEntityItemUse(entityId: string, itemId: string): void {
  const entity = useWorldEntities().findCurrentDndEntity(entityId);
  const item = entity?.equipment?.find((candidate) => candidate.id === itemId);

  if (!entity || !item || !canUseItem(item)) {
    return;
  }

  applyEffectSource(
    buildItemUseSpell(item),
    entity,
    resolveActorStats(entity, listAmbientEffects(entity.id)).spellSaveDC,
    () =>
      updateEntityEquipment(entityId, (equipment) =>
        spendItemUse(equipment, itemId),
      ),
  );
}
