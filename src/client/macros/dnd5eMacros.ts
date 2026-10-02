import type {
  MacroExecutionContext,
  MacroSlotState,
} from '@/core/registries/macroRegistry';
import type { HotbarMacro, SceneEntity } from '@vtt/shared';
import type {
  ActiveEffect,
  CreatureAction,
  DnDActor,
  DnDCreature,
  DnDGameItem,
  DnDSceneEntity,
} from '@vtt/shared/system/dnd.js';

import type { SpellCasterPort } from '../composables/spellCastFlow';

import { registerMacro } from '@/core/registries/macroRegistry';
import { useChatStore } from '@/stores/chatStore';
/**
 * Регистрация макро-executor'ов, специфичных для D&D 5e.
 * Вся боевая логика (бросок атаки, двухэтапная атака, криты, урон) вынесена
 * в attackUtils.ts, а здесь остаётся только оркестрация и контекст выполнения макроса.
 */
import {
  canSwitchOnEffect,
  collectEffectToggleGroup,
  describeItemUseAvailability,
  describeWeaponAttackAvailability,
  findCreatureActionSection,
  findCreatureSpellPlacement,
  isUseActivatedEffect,
  stripDescriptionRollMarkers,
} from '@vtt/shared/system/dnd.js';

import { startCreatureAction } from '../composables/creatureActionRoll';
import {
  createCreatureSpellCasterPort,
  startCreatureSpellCast,
} from '../composables/creatureSpellCast';
import {
  applyEntityEffectUse,
  applyEntityItemUse,
} from '../composables/effectActivationUse';
import {
  readEntityCounters,
  toggleEntityEffect,
} from '../composables/effectToggle';
import {
  createSpellCasterPort,
  startSpellCast,
} from '../composables/spellCastFlow';
import { useWorldEntities } from '../composables/useWorldEntities';
import {
  createWeaponAttackPort,
  startWeaponAttack,
} from '../composables/weaponAttackRoll';
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

        // Удар — общим путём удара, тем же, что у вкладки снаряжения;
        // отказ — в чат
        const attackerId = result.actor.id;

        startWeaponAttack(
          result.weapon,
          createWeaponAttackPort(attackerId, refuseBlockedMacro),
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
 * Заклинатель горячей панели для общего разбора каста: тот же заклинатель
 * мира, что у листа; отказ — строкой в чат.
 *
 * @param actorId - заклинатель
 * @returns порт заклинателя
 */
function createHotbarCasterPort(actorId: string): SpellCasterPort {
  return createSpellCasterPort(actorId, (spell, refusal) => {
    useChatStore().sendMessage(
      `${MACRO_MESSAGE_LABELS.blockedPrefix}${spell.name}: ${refusal.description}`,
      'text',
    );
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
      startCreatureSpellCast(
        foundSpell,
        placement,
        createCreatureSpellCasterPort(foundCreature.id, (spell, refusal) => {
          useChatStore().sendMessage(
            `${MACRO_MESSAGE_LABELS.blockedPrefix}${spell.name}: ${refusal.description}`,
            'text',
          );
        }),
      );
    } catch (err) {
      console.error('[Hotbar] Ошибка выполнения creature-spell:', err);
    }
  });
}
