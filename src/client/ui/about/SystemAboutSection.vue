<script setup lang="ts">
  import { name, version } from '../../../../system.json';
  import { SYSTEM_NAME_LABEL, SYSTEM_VERSION_LABEL } from './constants';

  // Слот передаёт свой контекст (`isAdmin`) всем блокам как атрибуты; блоку он
  // не нужен, а на корневом элементе дал бы лишний атрибут в разметке.
  defineOptions({ inheritAttrs: false });
</script>

<template>
  <!-- Строки повторяют разметку блока «О проекте» хоста, чтобы читаться как его продолжение -->
  <div class="space-y-2">
    <div class="flex items-center justify-between gap-3">
      <span class="text-sm text-muted">{{ SYSTEM_NAME_LABEL }}</span>

      <span class="text-right text-sm font-medium text-highlighted">{{
        name
      }}</span>
    </div>

    <div class="flex items-center justify-between gap-3">
      <span class="text-sm text-muted">{{ SYSTEM_VERSION_LABEL }}</span>

      <span class="font-mono text-sm text-primary-400">{{ version }}</span>
    </div>
  </div>
</template>
