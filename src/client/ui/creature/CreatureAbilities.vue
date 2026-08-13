<script setup lang="ts">
  import type { AbilityType } from '@vtt/shared';
  import type {
    AttackRollMode,
    CreatureSystem,
    DnDCreature,
    DnDCustomBonus,
    DnDCustomBonusContext,
    EffectTargetKey,
  } from '@vtt/shared/system/dnd.js';

  import type { AbilityBonusSource } from '../actor/AbilityScore.vue';

  import { computed, ref, toRef } from 'vue';

  import {
    ABILITY_KEYS,
    ABILITY_LABELS,
    calculateAbilityModifier,
    getActorAbilityModifiers,
    getCreatureProficiencyBonus,
    getCustomBonusesValue,
    getCustomBonusValue,
  } from '@vtt/shared/system/dnd.js';

  import { useResolvedStats } from '../../composables/useResolvedStats';
  import AbilityScore from '../actor/AbilityScore.vue';
  import AbilityScoreSettingsModal from '../actor/AbilityScoreSettingsModal.vue';
  import {
    ABILITY_CHECK_ROLL_LABELS,
    ABILITY_SHORT_LABELS,
    CUSTOM_BONUS_LABELS,
  } from '../actor/constants';
  import DiceRollModal from '../actor/DiceRollModal.vue';
  import { CREATURE_ABILITIES_LABELS } from './constants';

  interface Props {
    creature: DnDCreature;
    isEditMode: boolean;
  }

  const props = defineProps<Props>();

  const emit = defineEmits<{
    'update:system': [updates: Partial<CreatureSystem>];
  }>();

  const { resolvedStats, combinedEffects } = useResolvedStats(
    toRef(() => props.creature),
  );

  /**
   * Числа листа, от которых считается вклад своих бонусов к характеристикам.
   *
   * Берутся из расчёта листа: там это числа ДО прибавок к характеристикам —
   * бонус «+мод. Мудрости к Силе» считается по ним, и разбор в подсказке обязан
   * показывать те же слагаемые. Пока статы не сошлись, считаем по записи
   * существа — иначе строка мигала бы нулём.
   */
  const bonusContext = computed<DnDCustomBonusContext>(
    () =>
      resolvedStats.value?.abilityBonusContext ?? {
        abilityMods: getActorAbilityModifiers(props.creature),
        proficiencyBonus: getCreatureProficiencyBonus(props.creature),
      },
  );

  /**
   * Свои бонусы к значению характеристики.
   *
   * @param abilityKey - характеристика
   * @returns бонусы существа (пусто — их не заводили)
   */
  function getAbilityBonuses(abilityKey: AbilityType): DnDCustomBonus[] {
    return props.creature.system.abilityBonuses?.[abilityKey] ?? [];
  }

  /**
   * Значение характеристики целиком: с эффектами и своими бонусами.
   *
   * @param abilityKey - характеристика
   * @returns итоговое значение
   */
  function getResolvedValue(abilityKey: AbilityType): number {
    return (
      resolvedStats.value?.abilities[abilityKey]
      ?? props.creature.system.abilities[abilityKey]
    );
  }

  /**
   * Итог характеристики задан активным эффектом целиком: свои бонусы в него не
   * идут, пока эффект держится.
   *
   * @param abilityKey - характеристика
   * @returns `true`, если значение перезаписано эффектом
   */
  function isAbilityOverridden(abilityKey: AbilityType): boolean {
    const key: EffectTargetKey = `ability.${abilityKey}`;

    return resolvedStats.value?.overriddenKeys.has(key) ?? false;
  }

  /**
   * Вклад активных эффектов в значение характеристики: итог за вычетом числа
   * самой записи и своих бонусов. Под перезаписью эффектом бонусы в итог не
   * вошли, и вычитать их оттуда нечего.
   *
   * @param abilityKey - характеристика
   * @returns вклад эффектов
   */
  function getEffectsBonus(abilityKey: AbilityType): number {
    // Пока статы не сошлись, раскладывать нечего: итог равен числу записи, и
    // вычитание своих бонусов ушло бы в минус вымышленным «вкладом эффектов»
    if (!resolvedStats.value) {
      return 0;
    }

    const sheetValue = props.creature.system.abilities[abilityKey];
    const difference = getResolvedValue(abilityKey) - sheetValue;

    if (isAbilityOverridden(abilityKey)) {
      return difference;
    }

    return (
      difference
      - getCustomBonusesValue(bonusContext.value, getAbilityBonuses(abilityKey))
    );
  }

  /**
   * Слагаемые итогового значения характеристики: активные эффекты и свои
   * бонусы. Подсказка овала перечисляет их поимённо — иначе разницу между
   * записанным числом и итогом объяснять нечем.
   *
   * @param abilityKey - характеристика
   * @returns источники прибавок
   */
  function getAbilityBonusSources(
    abilityKey: AbilityType,
  ): AbilityBonusSource[] {
    const targetKey: EffectTargetKey = `ability.${abilityKey}`;
    const sources: AbilityBonusSource[] = [];

    for (const effect of combinedEffects.value) {
      for (const change of effect.changes) {
        if (change.key !== targetKey || change.condition) {
          continue;
        }

        const numericValue = Number(change.value);

        if (!Number.isNaN(numericValue) && numericValue !== 0) {
          sources.push({
            name: effect.name,
            value: numericValue,
          });
        }
      }
    }

    // Под перезаписью эффектом свои бонусы в итог не идут: показывать их в
    // разборе значило бы объяснять число слагаемыми, которых в нём нет
    if (isAbilityOverridden(abilityKey)) {
      return sources;
    }

    for (const bonus of getAbilityBonuses(abilityKey)) {
      const value = getCustomBonusValue(bonusContext.value, bonus);

      if (value !== 0) {
        sources.push({
          name: bonus.label.trim() || CUSTOM_BONUS_LABELS.unnamed,
          value,
        });
      }
    }

    return sources;
  }

  /** Плитка характеристики: все её числа собраны в одном месте */
  interface AbilityTile {
    key: AbilityType;
    label: string;
    shortLabel: string;
    /**
     * Число в овале: в правке — записанное у существа (его же правят
     * кнопками), иначе итог с эффектами и своими бонусами.
     */
    value: number;
    baseValue: number;
    /** Итог со всеми прибавками: его показывает разбор в подсказке */
    totalValue: number;
    modifier: number;
    bonusSources: AbilityBonusSource[];
  }

  const abilityTiles = computed<AbilityTile[]>(() =>
    ABILITY_KEYS.map((abilityKey) => {
      const sheetValue = props.creature.system.abilities[abilityKey];
      const resolvedValue = getResolvedValue(abilityKey);

      return {
        key: abilityKey,
        label: ABILITY_LABELS[abilityKey],
        shortLabel: ABILITY_SHORT_LABELS[abilityKey],
        value: props.isEditMode ? sheetValue : resolvedValue,
        baseValue: sheetValue,
        totalValue: resolvedValue,
        modifier:
          resolvedStats.value?.abilityMods[abilityKey]
          ?? calculateAbilityModifier(sheetValue),
        bonusSources: getAbilityBonusSources(abilityKey),
      };
    }),
  );

  const isDiceRollOpen = ref(false);

  /** Настройка окна броска: собирается перед каждым открытием */
  interface DiceRollConfig {
    modifier: number;
    title: string;
    rollLabel: string;
    rollButtonText: string;
    initialRollMode: AttackRollMode;
  }

  const diceRollConfig = ref<DiceRollConfig>({
    modifier: 0,
    title: '',
    rollLabel: '',
    rollButtonText: CREATURE_ABILITIES_LABELS.rollButton,
    initialRollMode: 'normal',
  });

  /**
   * Открывает окно броска проверки характеристики.
   *
   * @param modifier - модификатор броска
   * @param label - название характеристики
   */
  function handleAbilityRoll(modifier: number, label: string): void {
    diceRollConfig.value = {
      modifier,
      title: `${ABILITY_CHECK_ROLL_LABELS.titlePrefix}${label}`,
      rollLabel: `${ABILITY_CHECK_ROLL_LABELS.rollPrefix}${label}`,
      rollButtonText: CREATURE_ABILITIES_LABELS.rollButton,
      initialRollMode: 'normal',
    };

    isDiceRollOpen.value = true;
  }

  /**
   * Правит записанное значение характеристики.
   *
   * @param abilityKey - характеристика
   * @param value - новое значение
   */
  function handleAbilityChange(abilityKey: AbilityType, value: number): void {
    emit('update:system', {
      abilities: {
        ...props.creature.system.abilities,
        [abilityKey]: value,
      },
    });
  }

  // --- Настройка характеристики ---

  const isAbilitySettingsOpen = ref(false);

  /** Характеристика, чью настройку открыли: окно одно на все шесть плиток */
  const settingsAbility = ref<AbilityType>('strength');

  /**
   * Открывает настройку своих бонусов к характеристике.
   *
   * @param abilityKey - характеристика плитки
   */
  function openAbilitySettings(abilityKey: AbilityType): void {
    settingsAbility.value = abilityKey;
    isAbilitySettingsOpen.value = true;
  }

  /**
   * Применяет свои бонусы к характеристике из окна.
   *
   * @param payload - настройка из окна
   * @param payload.ability - характеристика
   * @param payload.bonuses - её свои бонусы
   */
  function onAbilitySettingsApply(payload: {
    ability: AbilityType;
    bonuses: DnDCustomBonus[];
  }): void {
    const abilityBonuses = { ...props.creature.system.abilityBonuses };

    if (payload.bonuses.length > 0) {
      abilityBonuses[payload.ability] = payload.bonuses;
    } else {
      // Пустой список не хранится: без ключа характеристика считается по
      // правилам, и запись существа не копит пустые массивы
      delete abilityBonuses[payload.ability];
    }

    emit('update:system', { abilityBonuses });
  }
</script>

<template>
  <div class="grid grid-cols-6 gap-2">
    <AbilityScore
      v-for="tile in abilityTiles"
      :key="tile.key"
      :label="tile.label"
      :short-label="tile.shortLabel"
      :value="tile.value"
      :base-value="tile.baseValue"
      :total-value="tile.totalValue"
      :modifier="tile.modifier"
      :is-edit-mode="isEditMode"
      with-settings
      :bonus-sources="tile.bonusSources"
      @update:value="handleAbilityChange(tile.key, $event)"
      @roll="handleAbilityRoll"
      @open-settings="openAbilitySettings(tile.key)"
    />
  </div>

  <DiceRollModal
    v-model:open="isDiceRollOpen"
    :modifier="diceRollConfig.modifier"
    :title="diceRollConfig.title"
    :roll-label="diceRollConfig.rollLabel"
    :roll-button-text="diceRollConfig.rollButtonText"
    :initial-roll-mode="diceRollConfig.initialRollMode"
  />

  <!-- Модалка настройки характеристики: одна на все плитки -->
  <AbilityScoreSettingsModal
    v-model:open="isAbilitySettingsOpen"
    :ability="settingsAbility"
    :sheet-value="creature.system.abilities[settingsAbility]"
    :effects-bonus="getEffectsBonus(settingsAbility)"
    :is-overridden="isAbilityOverridden(settingsAbility)"
    :bonuses="getAbilityBonuses(settingsAbility)"
    :context="bonusContext"
    @apply="onAbilitySettingsApply"
  />
</template>
