<script setup lang="ts">
  import type { AbilityType, ActorMovement } from '@vtt/shared';
  import type {
    CreatureSystem,
    DnDProficiencySettings,
  } from '@vtt/shared/system/dnd.js';

  import { computed, ref } from 'vue';

  import FieldsetLabel from '@/shared_ui/components/FieldsetLabel.vue';
  import { DISTANCE_UNIT_SHORT } from '@vtt/shared';
  import {
    calculateAbilityModifier,
    getDisplayMovement,
    getMovementList,
    rollDamageFormula,
  } from '@vtt/shared/system/dnd.js';

  import { useProficiencyBonus } from '../../composables/useProficiencyBonus';
  import ArmorClassModal from '../actor/ArmorClassModal.vue';
  import { SHEET_TILE_LABELS } from '../actor/constants';
  import DiceRollModal from '../actor/DiceRollModal.vue';
  import InitiativeModal from '../actor/InitiativeModal.vue';
  import ProficiencyBonusModal from '../actor/ProficiencyBonusModal.vue';
  import { formatSignedNumber } from '../actor/utils/formatSignedNumber';
  import {
    CREATURE_MOVEMENT_EMPTY,
    CREATURE_PROFICIENCY_RULE_TITLE,
  } from './constants';
  import CreatureHitPointsModal from './CreatureHitPointsModal.vue';
  import CreatureMovementModal from './CreatureMovementModal.vue';

  interface Props {
    system: CreatureSystem;
    isEditMode: boolean;
    /** Модификаторы характеристик листа — для бонусов от характеристики */
    abilityMods: Record<AbilityType, number>;
    /** Итоговый бонус мастерства листа с учётом активных эффектов */
    proficiencyBonus?: number;
  }

  const props = defineProps<Props>();

  const emit = defineEmits<{
    'update:system': [updates: Partial<CreatureSystem>];
  }>();

  const dexModifier = computed(() =>
    calculateAbilityModifier(props.system.abilities?.dexterity ?? 10),
  );

  // --- Бонус мастерства ---

  /** Подпись основы по правилам: показатель опасности существа */
  const proficiencyRuleTitle = computed(
    () =>
      `${CREATURE_PROFICIENCY_RULE_TITLE} ${props.system.challengeRating || '—'}`,
  );

  const {
    settings: proficiencySettings,
    value: proficiencyValue,
    tooltip: proficiencyTooltip,
  } = useProficiencyBonus({
    settings: () => props.system.proficiencySettings,
    ruleValue: () => props.system.proficiencyBonus,
    ruleTitle: proficiencyRuleTitle,
    abilityMods: () => props.abilityMods,
    resolvedValue: () => props.proficiencyBonus,
  });

  const formattedProficiency = computed(() =>
    formatSignedNumber(proficiencyValue.value),
  );

  const isProficiencyBonusOpen = ref(false);

  /** Открывает окно настройки бонуса мастерства — только в правке */
  function openProficiencyBonus(): void {
    if (props.isEditMode) {
      isProficiencyBonusOpen.value = true;
    }
  }

  /**
   * Применяет настройку бонуса мастерства из окна.
   *
   * @param settings - своя основа и свои бонусы
   */
  function onProficiencySettingsApply(settings: DnDProficiencySettings): void {
    emit('update:system', { proficiencySettings: settings });
  }

  // --- Передвижение ---

  /** Дефолтные значения передвижения (для safety) */
  const DEFAULT_MOVEMENT: ActorMovement = {
    walk: 30,
    swim: 0,
    fly: 0,
    climb: 0,
    burrow: 0,
    hover: false,
    units: 'ft',
  };

  const creatureMovement = computed<ActorMovement>(
    () => props.system.movement ?? DEFAULT_MOVEMENT,
  );

  /** Главный вид передвижения — он и стоит в плитке */
  const displayMovement = computed(() =>
    getDisplayMovement(creatureMovement.value),
  );

  const movementList = computed(() => getMovementList(creatureMovement.value));

  /** Сокращение единиц измерения — оно одно у плитки и у подсказки */
  const movementUnitLabel = computed(
    () => DISTANCE_UNIT_SHORT[creatureMovement.value.units ?? 'ft'],
  );

  const isMovementOpen = ref(false);

  function openMovement() {
    isMovementOpen.value = true;
  }

  /**
   * Применяет обновлённые данные передвижения
   */
  function onMovementApply(movement: ActorMovement) {
    emit('update:system', { movement });
  }

  // --- Хиты ---
  const isHitPointsOpen = ref(false);

  /** Класс значения временных ХП: золото при наличии, приглушённый при нуле */
  const tempHitPointsClass = computed(() =>
    (props.system.hitPoints?.temp ?? 0) > 0 ? 'text-primary/80' : 'text-dimmed',
  );

  function onHitPointsApply(
    data: Partial<import('@vtt/shared/system/dnd.js').CreatureHitPoints>,
  ) {
    emit('update:system', {
      hitPoints: {
        ...props.system.hitPoints,
        ...data,
      },
    });
  }

  /**
   * Бросает формулу здоровья и выставляет результат в максимум И в текущее
   * значение ХП. Минимум 1 (формула вроде «1к4 - 1» может дать 0).
   */
  function rollHitPointsFromFormula() {
    const formula = props.system.hitPoints?.formula;

    if (!formula) {
      return;
    }

    const { total } = rollDamageFormula(formula);
    const rolled = Math.max(1, total);

    emit('update:system', {
      hitPoints: {
        ...props.system.hitPoints,
        max: rolled,
        current: rolled,
      },
    });
  }

  // --- КД ---
  const isArmorClassOpen = ref(false);

  function onArmorClassApply(
    armorClass: import('@vtt/shared').ActorArmorClass,
  ) {
    emit('update:system', { armorClass });
  }

  // --- Инициатива ---
  const initiative = computed(() => {
    const ability = props.system.initiativeAbility ?? 'dexterity';

    const abilityModifier = calculateAbilityModifier(
      props.system.abilities?.[ability] ?? 10,
    );

    return abilityModifier + (props.system.initiativeBonus ?? 0);
  });

  const formattedInitiative = computed(() => {
    return initiative.value >= 0
      ? `+${initiative.value}`
      : `${initiative.value}`;
  });

  const isInitiativeOpen = ref(false);
  const isDiceRollOpen = ref(false);

  const diceRollConfig = ref({
    modifier: 0,
    title: '',
    rollLabel: '',
  });

  function handleInitiativeClick() {
    if (props.isEditMode) {
      isInitiativeOpen.value = true;
    } else {
      diceRollConfig.value = {
        modifier: initiative.value,
        title: 'Бросок инициативы',
        rollLabel: 'Инициатива',
      };

      isDiceRollOpen.value = true;
    }
  }

  function onInitiativeApply(data: {
    initiativeBonus: number;
    initiativeAbility: import('@vtt/shared').AbilityType;
  }) {
    emit('update:system', data);
  }
</script>

<template>
  <div class="flex flex-col gap-3">
    <!-- Плитки стоят сеткой два на два, как в листе персонажа: четыре коротких
      числа читаются рядом, и ни одно из них не растягивается на всю колонку -->
    <div class="grid grid-cols-2 gap-3">
      <!-- КД -->
      <FieldsetLabel
        :label="SHEET_TILE_LABELS.armorClass"
        center
        class="group h-full bg-default/20 transition-colors"
        :class="
          isEditMode
            ? 'cursor-pointer border-primary/30 hover:border-primary/50'
            : 'border-muted'
        "
        @click.left.exact.prevent="isEditMode && (isArmorClassOpen = true)"
      >
        <div class="flex h-full flex-col items-center justify-center p-2 pt-0">
          <div
            class="text-center text-xl font-bold text-highlighted tabular-nums"
          >
            {{ system.armorClass?.value ?? 10 }}
          </div>

          <div
            v-if="system.armorClass?.formula"
            class="mt-0.5 text-center text-xs leading-tight font-medium text-dimmed"
          >
            ({{ system.armorClass.formula }})
          </div>
        </div>
      </FieldsetLabel>

      <!-- Инициатива -->
      <FieldsetLabel
        :label="SHEET_TILE_LABELS.initiative"
        center
        class="h-full bg-default/20 transition-colors"
        :class="
          isEditMode
            ? 'cursor-pointer border-primary/30 hover:border-primary/50'
            : 'cursor-pointer border-muted hover:border-primary/50'
        "
        @click.left.exact.prevent="handleInitiativeClick"
      >
        <div class="flex h-full items-center justify-center p-2 pt-0">
          <div
            class="text-xl font-bold tabular-nums"
            :class="initiative >= 0 ? 'text-highlighted' : 'text-danger'"
          >
            {{ formattedInitiative }}
          </div>
        </div>
      </FieldsetLabel>

      <!-- Мастерство -->
      <UTooltip
        :delay-duration="300"
        :ui="{ content: 'h-auto' }"
      >
        <FieldsetLabel
          :label="SHEET_TILE_LABELS.proficiency"
          center
          class="h-full bg-default/20 transition-colors"
          :class="
            isEditMode
              ? 'cursor-pointer border-primary/30 hover:border-primary/50'
              : 'border-muted'
          "
          @click.left.exact.prevent="openProficiencyBonus"
        >
          <div class="flex h-full items-center justify-center p-2 pt-0">
            <div class="text-xl font-bold text-highlighted tabular-nums">
              {{ formattedProficiency }}
            </div>
          </div>
        </FieldsetLabel>

        <template #content>
          <span>{{ proficiencyTooltip }}</span>
        </template>
      </UTooltip>

      <!-- Скорость: в плитке главный вид передвижения, остальные — в подсказке.
        Так же она стоит и в листе персонажа -->
      <UTooltip
        :delay-duration="300"
        :ui="{ content: 'h-auto' }"
      >
        <FieldsetLabel
          :label="displayMovement.label"
          center
          class="h-full bg-default/20 transition-colors"
          :class="
            isEditMode
              ? 'cursor-pointer border-primary/30 hover:border-primary/50'
              : 'border-muted'
          "
          @click.left.exact.prevent="isEditMode && openMovement()"
        >
          <div class="flex h-full items-center justify-center p-2 pt-0">
            <div class="flex items-baseline gap-1">
              <span class="text-xl font-bold text-highlighted tabular-nums">
                {{ displayMovement.value }}
              </span>

              <span class="text-[10px] font-medium text-dimmed">
                {{ movementUnitLabel }}
              </span>
            </div>
          </div>
        </FieldsetLabel>

        <template #content>
          <div class="flex flex-col gap-1">
            <div
              v-for="item in movementList"
              :key="item.type"
              class="flex items-center gap-2"
            >
              <span class="tabular-nums opacity-70">
                {{ item.value }} {{ movementUnitLabel }}
              </span>

              <span>
                {{ item.label }}
                <span
                  v-if="item.type === 'fly' && creatureMovement.hover"
                  class="text-xs italic opacity-70"
                >
                  (зависание)
                </span>
              </span>
            </div>

            <span v-if="movementList.length === 0">
              {{ CREATURE_MOVEMENT_EMPTY }}
            </span>
          </div>
        </template>
      </UTooltip>
    </div>

    <!-- Здоровье -->
    <FieldsetLabel
      :label="SHEET_TILE_LABELS.hitPoints"
      class="group h-full cursor-pointer bg-default/20 transition-colors"
      :class="
        isEditMode
          ? 'border-primary/30 hover:border-primary/50'
          : 'border-muted hover:border-primary/50'
      "
      @click.left.exact.prevent="isHitPointsOpen = true"
    >
      <div class="flex h-full flex-col items-center justify-center p-2 pt-0">
        <!-- ХП: цифры + подписи -->
        <div class="flex w-full items-center">
          <span
            class="flex-1 text-center text-xl font-bold text-highlighted tabular-nums"
          >
            {{ system.hitPoints?.current ?? system.hitPoints?.average ?? 0 }}
          </span>

          <span class="w-3 text-center font-light text-dimmed">/</span>

          <span
            class="flex-1 text-center text-xl font-bold text-muted tabular-nums"
          >
            {{ system.hitPoints?.max ?? system.hitPoints?.average ?? 0 }}
          </span>

          <div class="mx-2 h-6 w-px bg-elevated" />

          <span
            class="flex-1 text-center text-xl font-bold tabular-nums"
            :class="tempHitPointsClass"
          >
            {{ system.hitPoints?.temp ?? 0 }}
          </span>
        </div>

        <div class="mt-0.5 flex w-full items-center">
          <span
            class="flex-1 text-center text-xs font-medium tracking-wider text-dimmed uppercase"
          >
            Сейчас
          </span>

          <span class="w-3" />

          <span
            class="flex-1 text-center text-xs font-medium tracking-wider text-dimmed uppercase"
          >
            Всего
          </span>

          <div class="mx-2 w-px" />

          <span
            class="flex-1 text-center text-xs font-medium tracking-wider text-dimmed uppercase"
          >
            Врем.
          </span>
        </div>

        <div class="my-2 w-full border-t border-muted/50" />

        <div class="relative flex w-full items-center justify-center gap-1">
          <UTooltip
            v-if="isEditMode && system.hitPoints?.formula"
            text="Сгенерировать здоровье по формуле"
          >
            <UButton
              icon="tabler:dice-5"
              variant="ghost"
              color="primary"
              size="xs"
              class="absolute top-1/2 left-0 -translate-y-1/2"
              @click.left.exact.stop.prevent="rollHitPointsFromFormula"
            />
          </UTooltip>

          <span class="text-xs font-bold tracking-wider text-dimmed uppercase">
            Формула:
          </span>

          <span class="text-xs font-medium text-toned">
            {{ system.hitPoints?.formula || '—' }}
          </span>
        </div>

        <div
          v-if="system.hitPoints?.text"
          class="mt-1 text-center text-xs font-medium text-dimmed"
        >
          {{ system.hitPoints.text }}
        </div>
      </div>
    </FieldsetLabel>
  </div>

  <!-- Модалка передвижения -->
  <CreatureMovementModal
    v-model:open="isMovementOpen"
    :movement="creatureMovement"
    @apply="onMovementApply"
  />

  <!-- Модалка очков здоровья -->
  <CreatureHitPointsModal
    v-model:open="isHitPointsOpen"
    :hit-points="system.hitPoints"
    @apply="onHitPointsApply"
  />

  <!-- Модалка класса защиты -->
  <ArmorClassModal
    v-model:open="isArmorClassOpen"
    :armor-class="system.armorClass"
    :dex-modifier="dexModifier"
    is-creature-mode
    @apply="onArmorClassApply"
  />

  <!-- Модалка настройки бонуса мастерства -->
  <ProficiencyBonusModal
    v-model:open="isProficiencyBonusOpen"
    :settings="proficiencySettings"
    :ability-mods="abilityMods"
    :rule-value="system.proficiencyBonus"
    :rule-title="proficiencyRuleTitle"
    :sheet-value="proficiencyValue"
    @apply="onProficiencySettingsApply"
  />

  <!-- Модалка инициативы -->
  <InitiativeModal
    v-model:open="isInitiativeOpen"
    :initiative-bonus="system.initiativeBonus ?? 0"
    :initiative-ability="system.initiativeAbility ?? 'dexterity'"
    :ability-scores="system.abilities"
    @apply="onInitiativeApply"
  />

  <!-- Бросок дайсов -->
  <DiceRollModal
    v-model:open="isDiceRollOpen"
    :modifier="diceRollConfig.modifier"
    :title="diceRollConfig.title"
    :roll-label="diceRollConfig.rollLabel"
    roll-button-text="Бросить инициативу"
    initial-roll-mode="normal"
  />
</template>
