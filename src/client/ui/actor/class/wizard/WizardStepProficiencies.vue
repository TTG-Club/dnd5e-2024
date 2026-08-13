<script setup lang="ts">
  /**
   * Шаг мастера: Владения (доспехи, оружие, инструменты).
   *
   * Первый класс — показывает полные стартовые владения.
   * Мультикласс — показывает сокращённый набор по PHB 2024.
   */
  import type { TypedWebSocketClient } from '@vtt/shared';
  import type { ClassDefinition } from '@vtt/shared/system/dnd.js';

  import { computed } from 'vue';

  import { getMulticlassProficiencies } from '@vtt/shared/system/dnd.js';

  import { CLASS_WIZARD_LABELS, GRANT_SECTION_LABELS } from '../../constants';
  import ToolProficiencyGrant from '../../ToolProficiencyGrant.vue';
  import { ARMOR_PROF_LABELS, WEAPON_PROF_LABELS } from './constants';

  const props = defineProps<{
    classDefinition: ClassDefinition;
    isFirstClass: boolean;
    isMulticlass: boolean;
    socket: TypedWebSocketClient | null;
  }>();

  /** Разобранные ключи владений инструментами — уходят на лист персонажа */
  const toolProficiencies = defineModel<string[]>('toolProficiencies', {
    default: () => [],
  });

  /** Владения доспехами для отображения */
  const armorProficiencies = computed(() => {
    if (props.isFirstClass) {
      return props.classDefinition.armorProficiencies;
    }

    if (props.isMulticlass) {
      const multiProf = getMulticlassProficiencies(props.classDefinition);

      return multiProf?.armor ?? [];
    }

    return [];
  });

  /** Владения оружием для отображения */
  const weaponProficiencies = computed(() => {
    if (props.isFirstClass) {
      return props.classDefinition.weaponProficiencies;
    }

    if (props.isMulticlass) {
      const multiProf = getMulticlassProficiencies(props.classDefinition);

      return multiProf?.weapons ?? [];
    }

    return [];
  });

  /** Владения инструментами как их прислал компендиум — текстом */
  const toolSources = computed(() => {
    if (props.isFirstClass) {
      return props.classDefinition.toolProficiencies ?? [];
    }

    if (props.isMulticlass) {
      const multiProf = getMulticlassProficiencies(props.classDefinition);

      return multiProf?.tools ?? [];
    }

    return [];
  });

  /** Есть ли хоть одно владение для отображения */
  const hasProficiencies = computed(() => {
    return (
      armorProficiencies.value.length > 0
      || weaponProficiencies.value.length > 0
      || toolSources.value.length > 0
    );
  });
</script>

<template>
  <div class="space-y-3">
    <span class="mb-2 block text-sm font-medium text-toned">
      {{ GRANT_SECTION_LABELS.proficiencies }}
      <span
        v-if="isMulticlass"
        class="text-sm text-dimmed"
        >{{ CLASS_WIZARD_LABELS.multiclassNote }}</span
      >
    </span>

    <div
      v-if="hasProficiencies"
      class="space-y-3"
    >
      <!-- Доспехи -->
      <div v-if="armorProficiencies.length > 0">
        <span class="mb-1 block text-sm font-medium text-muted">{{
          GRANT_SECTION_LABELS.equipment
        }}</span>

        <div class="flex flex-wrap gap-1.5">
          <UBadge
            v-for="armor in armorProficiencies"
            :key="armor"
            :label="ARMOR_PROF_LABELS[armor] ?? armor"
            color="neutral"
            variant="soft"
            size="md"
          />
        </div>
      </div>

      <!-- Оружие -->
      <div v-if="weaponProficiencies.length > 0">
        <span class="mb-1 block text-sm font-medium text-muted">{{
          GRANT_SECTION_LABELS.weapons
        }}</span>

        <div class="flex flex-wrap gap-1.5">
          <UBadge
            v-for="weapon in weaponProficiencies"
            :key="weapon"
            :label="WEAPON_PROF_LABELS[weapon] ?? weapon"
            color="neutral"
            variant="soft"
            size="md"
          />
        </div>
      </div>

      <!-- Инструменты: текст компендиума сопоставляется со словарём владений -->
      <ToolProficiencyGrant
        v-if="toolSources.length > 0"
        v-model:selected="toolProficiencies"
        :sources="toolSources"
        :socket="socket"
      />
    </div>

    <!-- Нет владений (Sorcerer, Wizard при мультиклассе) -->
    <div
      v-else
      class="rounded-lg border border-default/50 bg-elevated/30 px-3 py-2.5"
    >
      <span class="text-sm text-muted">
        {{ CLASS_WIZARD_LABELS.proficienciesEmpty }}
      </span>
    </div>
  </div>
</template>
