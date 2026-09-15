<!--
  Шаг «Урон»: урон в момент срабатывания. Урон каждый ход — строка списка
  «Срабатывания».
-->
<script setup lang="ts">
  import type { DamagePart } from '@vtt/shared';
  import type {
    ActiveEffect,
    EffectFormLayout,
  } from '@vtt/shared/system/dnd.js';

  import { computed } from 'vue';

  import { useSystemDataStore } from '../../../stores/systemDataStore';
  import DamagePartsEditor from '../../actor/DamagePartsEditor.vue';
  import { EFFECT_DAMAGE_STEP_LABELS } from '../constants';

  defineProps<{
    /** Раскладка окна */
    layout: EffectFormLayout;
  }>();

  const effect = defineModel<ActiveEffect>('effect', { required: true });

  const systemDataStore = useSystemDataStore();

  const damageTypeOptions = computed(() =>
    systemDataStore.damageTypes.map((damageType) => ({
      label: damageType.name,
      value: damageType.key,
    })),
  );

  const triggerDamage = computed({
    get: () => effect.value.damageParts ?? [],
    set: (parts: DamagePart[]) => {
      effect.value = {
        ...effect.value,
        damageParts: parts.length > 0 ? parts : undefined,
      };
    },
  });
</script>

<template>
  <div
    v-if="layout.showTriggerDamage"
    class="flex flex-col gap-2"
  >
    <div>
      <span class="text-xs font-medium text-default">
        {{ EFFECT_DAMAGE_STEP_LABELS.triggerTitle }}
      </span>

      <p class="text-xs text-muted">
        {{ EFFECT_DAMAGE_STEP_LABELS.triggerHint }}
      </p>
    </div>

    <DamagePartsEditor
      v-model="triggerDamage"
      :damage-type-options="damageTypeOptions"
      :include-spell-modifier="false"
      :hide-modifiers="true"
      :hide-healing="true"
      :allow-empty="true"
      :add-label="EFFECT_DAMAGE_STEP_LABELS.addDamage"
    />
  </div>
</template>
