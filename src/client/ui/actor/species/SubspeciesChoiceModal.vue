<script setup lang="ts">
  /**
   * Окно «какой подвид»: открывается, когда на лист переносят вид, у которого
   * есть подвиды. По правилам персонаж берёт подвид, а не вид сам по себе, —
   * поэтому прежде мастера настройки окно спрашивает, какой именно.
   *
   * Подвиды приходят готовым списком из каталога видов: окно ничего не ищет
   * само и о компендиумах не знает.
   *
   * Как и в окне выбора вида, отметку ставит флажок, а нажатие на строку
   * открывает карточку подвида — из неё подвид тоже можно выбрать.
   */

  import type { SpeciesDefinition } from '@vtt/shared/system/dnd.js';

  import { computed, ref, watch } from 'vue';

  import UDraggableModal from '@/shared_ui/components/UDraggableModal.vue';
  import { Z_INDEX } from '@/shared_ui/consts';

  import { SUBSPECIES_LIST_LABELS } from '../constants';
  import PickerListRow from '../PickerListRow.vue';
  import SpeciesDetailModal from './SpeciesDetailModal.vue';

  const props = defineProps<{
    /** Открыто ли окно */
    open: boolean;
    /** Название вида — в пояснении */
    speciesName: string;
    /** Подвиды вида по алфавиту */
    options: SpeciesDefinition[];
    /** Пак вида — карточка подвида читает записи того же компендиума */
    packId?: string;
  }>();

  const emit = defineEmits<{
    'update:open': [value: boolean];
    /** Подвид выбран — лист открывает мастера настройки с ним */
    'choose': [subspecies: SpeciesDefinition];
  }>();

  /** Отмеченный подвид */
  const selectedKey = ref<string | null>(null);

  /** Подвид, открытый на просмотр */
  const detailOption = ref<SpeciesDefinition | null>(null);
  const isDetailOpen = ref(false);

  /** Пояснение под заголовком с названием вида */
  const hintText = computed(
    () =>
      SUBSPECIES_LIST_LABELS.chooseHintPrefix
      + props.speciesName
      + SUBSPECIES_LIST_LABELS.chooseHintSuffix,
  );

  /** Отмеченная запись подвида */
  const selectedOption = computed<SpeciesDefinition | null>(
    () =>
      props.options.find((option) => option.key === selectedKey.value) ?? null,
  );

  /**
   * Отмечает подвид.
   *
   * @param option - подвид
   */
  function selectOption(option: SpeciesDefinition): void {
    selectedKey.value = option.key;
  }

  /**
   * Открывает карточку подвида. Отметку нажатие не меняет — за неё отвечает
   * флажок.
   *
   * @param option - подвид
   */
  function openDetail(option: SpeciesDefinition): void {
    detailOption.value = option;
    isDetailOpen.value = true;
  }

  /** Отмечает подвид из его карточки и возвращает к списку */
  function handleDetailSelect(): void {
    if (detailOption.value) {
      selectOption(detailOption.value);
    }

    isDetailOpen.value = false;
  }

  /** Отдаёт выбранный подвид листу и закрывает окно */
  function confirmChoice(): void {
    const option = selectedOption.value;

    if (!option) {
      return;
    }

    emit('choose', option);
    emit('update:open', false);
  }

  function handleModalClose(): void {
    emit('update:open', false);
  }

  // Каждое открытие начинается без отметки: окно спрашивает про новый вид
  watch(
    () => props.open,
    (isOpen) => {
      if (isOpen) {
        selectedKey.value = null;
        detailOption.value = null;
        isDetailOpen.value = false;
      }
    },
    { immediate: true },
  );
</script>

<template>
  <UDraggableModal
    :open="open"
    :title="SUBSPECIES_LIST_LABELS.chooseTitle"
    :initial-width="520"
    :initial-height="480"
    :min-width="360"
    :min-height="280"
    :z-index="Z_INDEX.MODAL_ELEVATED"
    :ui="{ body: 'overflow-hidden p-0 flex flex-col' }"
    @update:open="handleModalClose"
  >
    <template #body>
      <p class="shrink-0 px-4 pt-3 pb-2 text-sm text-toned">
        {{ hintText }}
      </p>

      <div class="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
        <div class="flex flex-col divide-y divide-accented/25">
          <PickerListRow
            v-for="option in options"
            :key="option.key"
            :name="option.name"
            :name-en="option.nameEn"
            :source-key="option.sourceKey"
            :source="option.source"
            :selected="selectedKey === option.key"
            detail-on-click
            @toggle="selectOption(option)"
            @open="openDetail(option)"
          />
        </div>
      </div>

      <div
        class="flex shrink-0 justify-end border-t border-default/50 px-4 py-3"
      >
        <UButton
          color="primary"
          size="sm"
          icon="tabler:check"
          :disabled="!selectedOption"
          @click.left.exact.prevent="confirmChoice"
        >
          {{ SUBSPECIES_LIST_LABELS.confirm }}
        </UButton>
      </div>
    </template>
  </UDraggableModal>

  <!-- Карточка подвида: «Выбрать» в шапке отмечает его в списке. Другой
    подвид при открытой карточке поднимает её над списком (`raise-key`) -->
  <SpeciesDetailModal
    v-if="detailOption"
    v-model:open="isDetailOpen"
    :species-definition="detailOption"
    :pack-id="packId"
    :raise-key="detailOption.key"
    :z-index="Z_INDEX.MODAL_CONFIRM"
    show-select-button
    @select="handleDetailSelect"
  />
</template>
