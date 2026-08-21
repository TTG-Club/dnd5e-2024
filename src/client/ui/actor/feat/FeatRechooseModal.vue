<script setup lang="ts">
  import type { TypedWebSocketClient } from '@vtt/shared';
  import type {
    DnDActor,
    FeatAwaitingChoices,
  } from '@vtt/shared/system/dnd.js';

  import type { AppliedFeatFeature } from './featApply';

  import { computed, ref, toRef, watch } from 'vue';

  import UDraggableModal from '@/shared_ui/components/UDraggableModal.vue';
  import { Z_INDEX } from '@/shared_ui/consts';
  import {
    calculateProficiencyBonus,
    collectRechoosableFeats,
    getTotalLevel,
  } from '@vtt/shared/system/dnd.js';

  import { useFeatChoiceSpells } from '../../../composables/useFeatChoiceSpells';
  import {
    FEAT_CHOICES_LABELS,
    MODAL_BUTTON_LABELS,
    REST_LABELS,
  } from '../constants';
  import FeatChoicesFields from './FeatChoicesFields.vue';

  /**
   * Выбор у черт, которые персонаж уже взял.
   *
   * Поводов два, и работа у них одна. Продолжительный отдых пересматривает то,
   * что черта разрешает менять («Мастер оружия» — вид оружия). Повышение уровня
   * открывает новую ступень таблицы заклинаний, и её спрашивают впервые: на
   * взятии черты этой ступени ещё не было.
   *
   * Уже сделанный выбор подставлен: закрыть окно, ничего не трогая, — законный
   * исход, менять выбор никто не обязан.
   */
  const props = withDefaults(
    defineProps<{
      open: boolean;
      actor: DnDActor;
      /**
       * Что спрашивать. Не задано — пересматриваемые на отдыхе выборы: так окно
       * открывает отдых, и знать про его повод больше никому не нужно.
       */
      feats?: FeatAwaitingChoices[] | null;
      /** Заголовок окна; не задан — про пересмотр на отдыхе */
      title?: string;
      /** Подпись под заголовком */
      hint?: string;
      /** Надпись на кнопке подтверждения */
      confirmLabel?: string;
      /** Сокет: пул выбора заклинания берётся из компендиума */
      socket?: TypedWebSocketClient | null;
    }>(),
    {
      feats: null,
      title: FEAT_CHOICES_LABELS.rechooseTitle,
      hint: FEAT_CHOICES_LABELS.rechooseHint,
      confirmLabel: REST_LABELS.long,
      socket: null,
    },
  );

  const emit = defineEmits<{
    'update:open': [value: boolean];
    /** Новый выбор по чертам: id особенности → (ключ выбора → значения) */
    'apply': [selections: Record<string, Record<string, string[]>>];
  }>();

  const isOpen = computed({
    get: () => props.open,
    set: (value) => emit('update:open', value),
  });

  /** Черты, у которых есть что выбрать */
  const feats = computed(
    () => props.feats ?? collectRechoosableFeats(props.actor),
  );

  /**
   * Каталог заклинаний для пула: ступень таблицы перечисляет заклинания
   * ссылками, и без каталога игрок увидел бы список без названий.
   */
  const choiceList = computed(() =>
    feats.value.flatMap((entry) => entry.choices),
  );

  const { spells } = useFeatChoiceSpells(toRef(props, 'socket'), choiceList);

  /** Выбор по каждой черте: id особенности → (ключ выбора → значения) */
  const selections = ref<Record<string, Record<string, string[]>>>({});

  const proficiencyBonus = computed(() =>
    calculateProficiencyBonus(getTotalLevel(props.actor.system.classes)),
  );

  /** Текущий выбор черты — с ним окно и открывается */
  function currentSelections(featureId: string): Record<string, string[]> {
    // Массив объявлен типом черты: базовый `Feature` о сделанных выборах не знает
    const features: AppliedFeatFeature[] = props.actor.features ?? [];

    return features.find((entry) => entry.id === featureId)?.choices ?? {};
  }

  watch(
    () => props.open,
    (opened) => {
      if (!opened) {
        return;
      }

      const initial: Record<string, Record<string, string[]>> = {};

      for (const entry of feats.value) {
        initial[entry.featureId] = { ...currentSelections(entry.featureId) };
      }

      selections.value = initial;
    },
    { immediate: true },
  );

  /** Двусторонняя привязка выбора одной черты для общего блока полей */
  function featSelections(featureId: string) {
    return computed({
      get: () => selections.value[featureId] ?? {},
      set: (value: Record<string, string[]>) => {
        selections.value = { ...selections.value, [featureId]: value };
      },
    });
  }

  function apply(): void {
    emit('apply', { ...selections.value });
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
      <div class="space-y-4">
        <p class="text-xs text-dimmed">
          {{ hint }}
        </p>

        <div
          v-for="entry in feats"
          :key="entry.featureId"
          class="space-y-2"
        >
          <span class="text-xs font-bold tracking-wider text-primary uppercase">
            {{ entry.featureName }}
          </span>

          <FeatChoicesFields
            v-model="featSelections(entry.featureId).value"
            :choices="entry.choices"
            :actor="actor"
            :proficiency-bonus="proficiencyBonus"
            :spells="spells"
          />
        </div>

        <div class="border-t border-muted" />

        <div class="flex justify-end gap-2 pt-1">
          <UButton
            variant="ghost"
            color="neutral"
            size="md"
            @click.left.exact.prevent="isOpen = false"
          >
            {{ MODAL_BUTTON_LABELS.cancel }}
          </UButton>

          <UButton
            color="primary"
            size="md"
            @click.left.exact.prevent="apply"
          >
            {{ confirmLabel }}
          </UButton>
        </div>
      </div>
    </template>
  </UDraggableModal>
</template>
