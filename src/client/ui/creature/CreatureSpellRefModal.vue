<script setup lang="ts">
  import type { CreatureSpellRef } from '@vtt/shared/system/dnd.js';

  import { computed, reactive, watch } from 'vue';

  import UDraggableModal from '@/shared_ui/components/UDraggableModal.vue';
  import { Z_INDEX } from '@/shared_ui/consts';
  import {
    MAX_SPELL_SLOT_LEVEL,
    MIN_SPELL_SLOT_LEVEL,
  } from '@vtt/shared/system/dnd.js';

  import { MODAL_BUTTON_LABELS } from '../actor/constants';
  import { CREATURE_SPELL_REF_FORM_LABELS } from './constants';

  interface Props {
    open: boolean;
    /** Правимая ссылка на заклинание группы */
    spellRef?: CreatureSpellRef;
    /** Название заклинания — заголовок окна без него ничего не говорит */
    spellName?: string;
  }

  const props = withDefaults(defineProps<Props>(), {
    spellRef: undefined,
    spellName: '',
  });

  const emit = defineEmits<{
    'update:open': [value: boolean];
    'apply': [spellRef: CreatureSpellRef];
  }>();

  const isOpen = computed({
    get: () => props.open,
    set: (value) => emit('update:open', value),
  });

  /** Правка идёт по копии: до «Применить» запись существа не меняется */
  const form = reactive<{ castLevel: number | null; note: string }>({
    castLevel: null,
    note: '',
  });

  watch(
    () => [props.open, props.spellRef] as const,
    ([opened, spellRef]) => {
      if (!opened || !spellRef) {
        return;
      }

      form.castLevel = spellRef.castLevel ?? null;
      form.note = spellRef.note ?? '';
    },
    { immediate: true },
  );

  /** Заголовок окна: круг и оговорка — всегда чьи-то, и чьи именно, видно сразу */
  const title = computed(() =>
    props.spellName
      ? `${CREATURE_SPELL_REF_FORM_LABELS.title} — ${props.spellName}`
      : CREATURE_SPELL_REF_FORM_LABELS.title,
  );

  function applyRef(): void {
    if (!props.spellRef) {
      return;
    }

    const note = form.note.trim();

    emit('apply', {
      ...props.spellRef,
      castLevel: form.castLevel ?? undefined,
      note: note || undefined,
    });

    isOpen.value = false;
  }
</script>

<template>
  <UDraggableModal
    v-model:open="isOpen"
    :draggable="false"
    :resizable="false"
    :blocking="true"
    :min-width="420"
    :min-height="260"
    :title="title"
    :z-index="Z_INDEX.MODAL_ELEVATED"
  >
    <template #body>
      <div class="space-y-3">
        <p class="text-xs leading-relaxed text-dimmed">
          {{ CREATURE_SPELL_REF_FORM_LABELS.hint }}
        </p>

        <div class="space-y-1">
          <div class="flex items-center justify-between gap-4">
            <span class="text-sm text-toned">
              {{ CREATURE_SPELL_REF_FORM_LABELS.castLevel }}
            </span>

            <UInputNumber
              v-model="form.castLevel"
              :min="MIN_SPELL_SLOT_LEVEL"
              :max="MAX_SPELL_SLOT_LEVEL"
              size="sm"
              class="w-56 shrink-0"
            />
          </div>

          <p class="text-xs leading-relaxed text-dimmed">
            {{ CREATURE_SPELL_REF_FORM_LABELS.castLevelOwn }}
          </p>
        </div>

        <div class="border-t border-muted" />

        <div class="space-y-1">
          <div class="flex items-center justify-between gap-4">
            <span class="text-sm text-toned">
              {{ CREATURE_SPELL_REF_FORM_LABELS.note }}
            </span>

            <UInput
              v-model="form.note"
              :placeholder="CREATURE_SPELL_REF_FORM_LABELS.notePlaceholder"
              size="sm"
              class="w-56 shrink-0"
            />
          </div>

          <p class="text-xs leading-relaxed text-dimmed">
            {{ CREATURE_SPELL_REF_FORM_LABELS.noteHint }}
          </p>
        </div>

        <div class="flex justify-end gap-2 pt-2">
          <UButton
            variant="ghost"
            color="neutral"
            size="sm"
            @click.left.exact.prevent="isOpen = false"
          >
            {{ MODAL_BUTTON_LABELS.cancel }}
          </UButton>

          <UButton
            color="primary"
            size="sm"
            @click.left.exact.prevent="applyRef"
          >
            {{ MODAL_BUTTON_LABELS.apply }}
          </UButton>
        </div>
      </div>
    </template>
  </UDraggableModal>
</template>
