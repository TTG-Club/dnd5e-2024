<!--
  Флажок «Действует при себе» — одинаковый у снаряжения и оружия: магия такого
  предмета работает, пока он в инвентаре, без отметки «надет».
-->
<script setup lang="ts">
  import { ITEM_FORM_LABELS } from './constants';

  const activeWhenCarried = defineModel<boolean>({ required: true });
</script>

<template>
  <UCheckbox
    v-model="activeWhenCarried"
    :label="ITEM_FORM_LABELS.activeWhenCarried"
    :description="ITEM_FORM_LABELS.activeWhenCarriedDescription"
  />
</template>
