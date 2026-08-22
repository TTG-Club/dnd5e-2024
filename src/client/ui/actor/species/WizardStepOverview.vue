<script setup lang="ts">
  import type {
    DamageDefenseKind,
    SpeciesDefinition,
  } from '@vtt/shared/system/dnd.js';

  import type { SpeciesWizardState } from './useSpeciesWizard';

  import { computed } from 'vue';

  import {
    DAMAGE_DEFENSE_KIND_LABELS,
    DAMAGE_TYPE_LABELS,
    getConditionEntry,
  } from '@vtt/shared/system/dnd.js';

  import {
    ABILITY_LABELS,
    CREATURE_SIZE_LABELS,
    CREATURE_TYPE_LABELS,
    GRANT_FIELD_LABELS,
    GRANT_SECTION_LABELS,
    SPECIES_DETAIL_LABELS,
    WIZARD_OVERVIEW_LABELS,
  } from '../constants';

  const props = defineProps<{
    speciesDefinition: SpeciesDefinition;
    state: SpeciesWizardState;
  }>();

  const emit = defineEmits<{
    'update:state': [value: SpeciesWizardState];
  }>();

  const localState = computed({
    get: () => props.state,
    set: (val) => emit('update:state', val),
  });

  const speedDisplay = computed(() => {
    const spd = props.speciesDefinition.speed;

    const parts = [
      `${SPECIES_DETAIL_LABELS.speedWalk} ${spd.walk} ${SPECIES_DETAIL_LABELS.speedUnit}`,
    ];

    if (spd.fly) {
      parts.push(
        `${SPECIES_DETAIL_LABELS.speedFly} ${spd.fly} ${SPECIES_DETAIL_LABELS.speedUnit}`,
      );
    }

    if (spd.swim) {
      parts.push(
        `${SPECIES_DETAIL_LABELS.speedSwim} ${spd.swim} ${SPECIES_DETAIL_LABELS.speedUnit}`,
      );
    }

    if (spd.climb) {
      parts.push(
        `${SPECIES_DETAIL_LABELS.speedClimb} ${spd.climb} ${SPECIES_DETAIL_LABELS.speedUnit}`,
      );
    }

    if (spd.burrow) {
      parts.push(
        `${SPECIES_DETAIL_LABELS.speedBurrow} ${spd.burrow} ${SPECIES_DETAIL_LABELS.speedUnit}`,
      );
    }

    return parts.join(', ');
  });

  const displayType = computed(() => {
    const creatureType = props.speciesDefinition.creatureType;

    return CREATURE_TYPE_LABELS[creatureType] || creatureType;
  });

  const sizeOptions = computed(() => {
    return props.speciesDefinition.size.map((sizeValue) => ({
      value: sizeValue,
      label: CREATURE_SIZE_LABELS[sizeValue] || sizeValue,
    }));
  });

  const hasMultipleSizes = computed(
    () => props.speciesDefinition.size.length > 1,
  );

  // Инфо-гранты
  const infoGrants = computed(() => {
    const grants: { title: string; desc: string }[] = [];

    props.speciesDefinition.grants.forEach((group) => {
      if (group.type === 'darkvision') {
        grants.push({
          title: SPECIES_DETAIL_LABELS.darkvision,
          desc: `${group.range} ${SPECIES_DETAIL_LABELS.speedUnit}`,
        });
      } else if (group.type === 'savingThrowProficiency') {
        if (group.abilities.length > 0) {
          grants.push({
            title: GRANT_SECTION_LABELS.savingThrows,
            desc: group.abilities
              .map((ability) => ABILITY_LABELS[ability] ?? ability)
              .join(', '),
          });
        }
      } else if (group.type === 'damageDefense') {
        const typesByKind = new Map<DamageDefenseKind, string[]>();

        for (const entry of group.entries) {
          const list = typesByKind.get(entry.kind) ?? [];

          list.push(DAMAGE_TYPE_LABELS[entry.damageType] ?? entry.damageType);
          typesByKind.set(entry.kind, list);
        }

        for (const [kind, types] of typesByKind) {
          grants.push({
            title: DAMAGE_DEFENSE_KIND_LABELS[kind],
            desc: types.join(', '),
          });
        }
      } else if (group.type === 'conditionImmunity') {
        if (group.conditions.length > 0) {
          grants.push({
            title: GRANT_FIELD_LABELS.conditionImmunities,
            desc: group.conditions
              .map((key) => getConditionEntry(key)?.nameRu ?? key)
              .join(', '),
          });
        }
      } else if (
        group.type === 'language'
        && (!group.choices || group.choices.count === 0)
      ) {
        if (group.items.length > 0) {
          grants.push({
            title: GRANT_SECTION_LABELS.languages,
            desc: group.items.join(', '),
          });
        }
      } else if (
        group.type === 'weaponProficiency'
        && (!group.choices || group.choices.count === 0)
      ) {
        if (group.items.length > 0) {
          grants.push({
            title: GRANT_SECTION_LABELS.weapons,
            desc: group.items.join(', '),
          });
        }
      } else if (
        group.type === 'armorProficiency'
        && (!group.choices || group.choices.count === 0)
      ) {
        if (group.items.length > 0) {
          grants.push({
            title: GRANT_SECTION_LABELS.equipment,
            desc: group.items.join(', '),
          });
        }
      } else if (
        group.type === 'toolProficiency'
        && (!group.choices || group.choices.count === 0)
      ) {
        if (group.items.length > 0) {
          grants.push({
            title: GRANT_SECTION_LABELS.tools,
            desc: group.items.join(', '),
          });
        }
      }
    });

    return grants;
  });
</script>

<template>
  <div class="flex flex-col gap-6 p-1">
    <!-- Описание вида -->
    <div class="rounded-lg bg-elevated/50 p-4 leading-relaxed text-toned">
      {{ speciesDefinition.description }}
    </div>

    <!-- Основные характеристики -->
    <div class="grid grid-cols-2 gap-4">
      <div class="flex flex-col rounded-lg bg-elevated p-3">
        <span
          class="mb-1 text-[10px] font-semibold tracking-wider text-muted uppercase"
        >
          {{ WIZARD_OVERVIEW_LABELS.creatureType }}
        </span>

        <span class="font-medium text-highlighted">{{ displayType }}</span>
      </div>

      <div class="flex flex-col rounded-lg bg-elevated p-3">
        <span
          class="mb-1 text-[10px] font-semibold tracking-wider text-muted uppercase"
        >
          {{ WIZARD_OVERVIEW_LABELS.speed }}
        </span>

        <span class="font-medium text-highlighted">{{ speedDisplay }}</span>
      </div>
    </div>

    <!-- Выбор размера (если есть варианты) -->
    <div
      v-if="hasMultipleSizes"
      class="flex flex-col rounded-lg bg-elevated/50 p-4"
    >
      <span
        class="mb-3 text-xs font-semibold tracking-wider text-muted uppercase"
      >
        {{ WIZARD_OVERVIEW_LABELS.sizePrompt }}
      </span>

      <div class="flex gap-4">
        <URadioGroup
          v-model="localState.selectedSize"
          :items="sizeOptions"
          orientation="horizontal"
          class="gap-4"
          value-key="value"
          label-key="label"
        />
      </div>
    </div>

    <div
      v-else
      class="flex flex-col rounded-lg bg-elevated p-3"
    >
      <span
        class="mb-1 text-[10px] font-semibold tracking-wider text-muted uppercase"
      >
        {{ WIZARD_OVERVIEW_LABELS.size }}
      </span>

      <span class="font-medium text-highlighted">{{
        sizeOptions[0]?.label
      }}</span>
    </div>

    <!-- Информационные гранты -->
    <div
      v-if="infoGrants.length > 0"
      class="flex flex-col gap-3"
    >
      <span class="text-xs font-semibold tracking-wider text-muted uppercase">
        {{ WIZARD_OVERVIEW_LABELS.innateFeatures }}
      </span>

      <div class="grid grid-cols-2 gap-3">
        <div
          v-for="(grant, idx) in infoGrants"
          :key="idx"
          class="flex flex-col rounded-lg bg-elevated p-3"
        >
          <span
            class="mb-1 text-[10px] font-semibold tracking-wider text-primary uppercase"
          >
            {{ grant.title }}
          </span>

          <span class="font-medium text-highlighted">{{ grant.desc }}</span>
        </div>
      </div>
    </div>
  </div>
</template>
