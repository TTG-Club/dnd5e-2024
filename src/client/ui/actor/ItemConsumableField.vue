<!--
  Флажок «Расходуемый» карточкой с пояснением — одинаковый у снаряжения и
  оружия: расходуемый предмет применение тратит поштучно, и его можно зарядить
  в стрелковое оружие.
-->
<script setup lang="ts">
  import { EQUIPMENT_FORM_LABELS } from './constants';

  const consumable = defineModel<boolean>({ required: true });
</script>

<template>
  <UCheckbox
    v-model="consumable"
    variant="card"
    icon="tabler:check"
    :label="EQUIPMENT_FORM_LABELS.consumable"
    :description="EQUIPMENT_FORM_LABELS.consumableDescription"
  />
</template>
