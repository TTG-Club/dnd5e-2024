<script setup lang="ts">
  import { computed, ref, useId } from 'vue';

  import {
    ENTITY_OWNERSHIP_ICONS,
    ENTITY_OWNERSHIP_LABELS,
    ENTITY_OWNERSHIP_SEARCH_INPUT,
  } from './constants';

  const props = defineProps<{
    users: ReadonlyArray<{ id: string; username: string; role: string }>;
    editable: boolean;
  }>();

  const selectedOwnerIds = defineModel<string[]>({ required: true });
  const inputId = useId();
  const captionId = useId();
  const isMenuOpen = ref(false);

  const userOptions = computed(() => {
    const availableUsers = props.users.map((user) => ({
      value: user.id,
      label: user.username,
      description:
        user.role === 'admin'
          ? ENTITY_OWNERSHIP_LABELS.gm
          : ENTITY_OWNERSHIP_LABELS.player,
    }));

    const missingOwners = selectedOwnerIds.value
      .filter((ownerId) => !props.users.some((user) => user.id === ownerId))
      .map((ownerId) => ({
        value: ownerId,
        label: ENTITY_OWNERSHIP_LABELS.unknown,
        description: ownerId,
      }));

    return [...availableUsers, ...missingOwners];
  });

  const ownerNames = computed(() =>
    selectedOwnerIds.value.map(
      (ownerId) =>
        props.users.find((user) => user.id === ownerId)?.username
        ?? ENTITY_OWNERSHIP_LABELS.unknown,
    ),
  );

  const firstOwnerName = computed(
    () => ownerNames.value[0] ?? ENTITY_OWNERSHIP_LABELS.none,
  );

  const remainingOwners = computed(() =>
    Math.max(0, ownerNames.value.length - 1),
  );

  const fullOwnerNames = computed(
    () => ownerNames.value.join(', ') || ENTITY_OWNERSHIP_LABELS.none,
  );

  /** Escape закрывает только открытый список, сохраняя черновик настроек. */
  function closeOwnersOnEscape(event: KeyboardEvent): void {
    if (!isMenuOpen.value) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    isMenuOpen.value = false;
  }
</script>

<template>
  <!-- Колонка на flex-gap, а не на space-y: при `portal: false` открытый
       список становится ещё одним потомком, и отступ space-y переезжал бы на
       поле, растягивая шапку на пару пикселей. -->
  <div class="ml-auto flex w-44 max-w-full flex-col gap-1">
    <label
      v-if="editable"
      :for="inputId"
      class="block text-xs text-muted"
      >{{ ENTITY_OWNERSHIP_LABELS.label }}</label
    >

    <span
      v-else
      :id="captionId"
      class="block text-xs text-muted"
      >{{ ENTITY_OWNERSHIP_LABELS.label }}</span
    >

    <USelectMenu
      v-if="editable"
      :id="inputId"
      v-model="selectedOwnerIds"
      v-model:open="isMenuOpen"
      :aria-label="ENTITY_OWNERSHIP_LABELS.label"
      :items="userOptions"
      :content="{ align: 'end' }"
      :ui="{
        content: 'min-w-64 max-w-[calc(100vw-2rem)]',
        viewport: 'max-h-64',
      }"
      value-key="value"
      multiple
      :search-input="ENTITY_OWNERSHIP_SEARCH_INPUT"
      :portal="false"
      :icon="ENTITY_OWNERSHIP_ICONS.users"
      :selected-icon="ENTITY_OWNERSHIP_ICONS.selected"
      class="w-full"
      :title="fullOwnerNames"
      @keydown.esc.capture="closeOwnersOnEscape"
    >
      <span class="min-w-0 truncate">{{ firstOwnerName }}</span>

      <span
        v-if="remainingOwners"
        class="shrink-0 text-xs text-muted"
        >{{ ENTITY_OWNERSHIP_LABELS.more }} {{ remainingOwners }}</span
      >

      <template #empty>{{ ENTITY_OWNERSHIP_LABELS.empty }}</template>

      <template #content-bottom>
        <p class="border-t border-default p-2 text-xs text-muted">
          {{ ENTITY_OWNERSHIP_LABELS.hint }}
        </p>
      </template>
    </USelectMenu>

    <p
      v-else
      :aria-labelledby="captionId"
      class="text-xs wrap-anywhere text-muted"
    >
      {{ fullOwnerNames }}
    </p>
  </div>
</template>
