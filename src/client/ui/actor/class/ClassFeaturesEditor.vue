<script setup lang="ts">
  import type { TypedWebSocketClient } from '@vtt/shared';

  import type { SpellOption } from '../grantedSpellsEditorTypes';
  import type { EditableClassFeature } from './classEditorTypes';

  import { computed, ref } from 'vue';

  import UDraggableModal from '@/shared_ui/components/UDraggableModal.vue';
  import { useModalManager } from '@/shared_ui/composables/useModalManager';
  import { formatChoiceCountRange } from '@vtt/shared/system/dnd.js';

  import { useExpandedRows } from '../../../composables/useExpandedRows';
  import {
    CLASS_FEATURE_DEFAULT_NAME,
    CLASS_FEATURES_EDITOR_LABELS,
    DELETE_CONFIRM_TITLE,
    LEVEL_BADGE_SUFFIX,
    MODAL_BUTTON_LABELS,
  } from '../constants';
  import {
    countFilledMechanicsBlocks,
    createEmptyFeature,
  } from './classEditorTypes';
  import ClassFeatureFields from './ClassFeatureFields.vue';

  defineProps<{
    /** Заклинания компендиума по пакам — для подсказок связывания. */
    availableSpells?: SpellOption[];
    /**
     * Сокет для окна выбора заклинания из компендиума. Без него добавить
     * заклинание нечем: другого способа завести запись у редактора нет.
     */
    socket?: TypedWebSocketClient | null;
  }>();

  /** Бейдж в шапке свёрнутого умения. */
  interface FeatureBadge {
    key: string;
    label: string;
    color: 'neutral' | 'primary';
  }

  /** Список умений класса/подкласса. */
  const features = defineModel<EditableClassFeature[]>({ required: true });

  const emit = defineEmits<{
    'open-spell': [spellId: string, packId?: string];
  }>();

  const { getNextZIndex } = useModalManager();

  const { isExpanded, expand, toggle, drop } = useExpandedRows();

  /** Ключ умения, про которое спрашивают подтверждение удаления. */
  const pendingRemovalKey = ref<string | null>(null);

  /** Z-index окна подтверждения: оно встаёт поверх окна класса. */
  const removalConfirmZIndex = ref<number | undefined>(undefined);

  /** Название умения в вопросе окна подтверждения. */
  const pendingRemovalName = computed(() => {
    const pending = features.value.find(
      (feature) => feature.key === pendingRemovalKey.value,
    );

    return pending?.name || CLASS_FEATURES_EDITOR_LABELS.fallbackName;
  });

  /**
   * Подпись бейджа выбираемого списка вариантов: сколько из скольких берут и
   * до скольких это число дорастает по уровням. У справочного списка важна
   * только его длина — там бейдж другой.
   *
   * @param feature - умение строки
   * @returns подпись бейджа
   */
  function choiceBadgeLabel(feature: EditableClassFeature): string {
    const config = feature.choiceConfig;

    const range = formatChoiceCountRange(
      config?.count,
      config?.scaling.map((step) => step.count) ?? [],
    );

    return (
      `${CLASS_FEATURES_EDITOR_LABELS.choiceBadge}${range} `
      + `${CLASS_FEATURES_EDITOR_LABELS.choiceBadgeOf} ${feature.choices.length}`
    );
  }

  /**
   * Бейджи свёрнутой строки: что у умения заполнено, не разворачивая его. Без
   * них автор открывает умения по одному, чтобы найти, где что настроено.
   *
   * @param feature - умение строки
   * @returns бейджи в порядке показа
   */
  function featureBadges(feature: EditableClassFeature): FeatureBadge[] {
    const badges: FeatureBadge[] = [];
    const mechanicsCount = countFilledMechanicsBlocks(feature);

    if (mechanicsCount) {
      badges.push({
        key: 'mechanics',
        label: `${CLASS_FEATURES_EDITOR_LABELS.mechanicsBadge}${mechanicsCount}`,
        color: 'primary',
      });
    }

    if (feature.scaling.length) {
      badges.push({
        key: 'scaling',
        label: `${CLASS_FEATURES_EDITOR_LABELS.scalingBadge}${feature.scaling.length}`,
        color: 'neutral',
      });
    }

    if (feature.choices.length) {
      badges.push({
        key: 'choices',
        label: feature.choiceConfig
          ? choiceBadgeLabel(feature)
          : `${CLASS_FEATURES_EDITOR_LABELS.choicesBadge}${feature.choices.length}`,
        color: feature.choiceConfig ? 'primary' : 'neutral',
      });
    }

    if (feature.isInformationalOnly) {
      badges.push({
        key: 'informational',
        label: CLASS_FEATURES_EDITOR_LABELS.informationalBadge,
        color: 'neutral',
      });
    }

    return badges;
  }

  /**
   * Подпись плашки для скринридера: по нажатию она раскрывается и сворачивается,
   * и текст должен говорить, что случится дальше.
   *
   * @param key - ключ умения
   */
  function toggleAriaLabel(key: string): string {
    return isExpanded(key)
      ? CLASS_FEATURES_EDITOR_LABELS.collapse
      : CLASS_FEATURES_EDITOR_LABELS.expand;
  }

  /**
   * Стрелка слева от названия — только рисунок: нажимается вся плашка целиком.
   *
   * @param key - ключ умения
   */
  function toggleIcon(key: string): string {
    return isExpanded(key) ? 'tabler:chevron-down' : 'tabler:chevron-right';
  }

  /**
   * Оформление плашки умения.
   *
   * У раскрытого умения снизу идёт редактор — нижние углы подсветки не должны
   * срезать разделитель, — и его шапка прилипает к верху окна: механика уезжает
   * на несколько экранов вглубь, и без прилипшей шапки не видно, чьё это умение.
   * Прилипает только раскрытая: списку свёрнутых умений это лишь мешало бы.
   *
   * @param key - ключ умения
   */
  function headerClass(key: string): string {
    return isExpanded(key)
      ? 'sticky top-0 z-20 rounded-t-lg border-b border-default bg-elevated'
      : 'rounded-lg';
  }

  /** Добавляет умение и сразу раскрывает его редактор. */
  /**
   * Заводит умение и сразу разворачивает его. Наружу — кнопка добавления живёт
   * в шапке раздела, а новое умение собирает список.
   */
  function addFeature(): void {
    const feature = createEmptyFeature(CLASS_FEATURE_DEFAULT_NAME);

    features.value.push(feature);
    expand(feature.key);
  }

  defineExpose({ addFeature });

  /**
   * Спрашивает подтверждение удаления. Настройки умения — дары, ресурсы,
   * эффекты — уходят вместе с ним, а промахнуться по корзине легко.
   *
   * @param key - ключ умения
   */
  function requestRemoval(key: string): void {
    pendingRemovalKey.value = key;
    removalConfirmZIndex.value = getNextZIndex();
  }

  /** Закрывает окно подтверждения, оставляя умение на месте. */
  function cancelRemoval(): void {
    pendingRemovalKey.value = null;
  }

  /**
   * Закрытие окна подтверждения крестиком или кликом мимо — тот же отказ.
   *
   * @param isConfirmOpen - новое состояние окна
   */
  function handleRemovalOpenChange(isConfirmOpen: boolean): void {
    if (!isConfirmOpen) {
      cancelRemoval();
    }
  }

  /** Удаляет умение, про которое спрашивали. */
  function confirmRemoval(): void {
    const key = pendingRemovalKey.value;

    pendingRemovalKey.value = null;

    if (!key) {
      return;
    }

    const index = features.value.findIndex((feature) => feature.key === key);

    if (index === -1) {
      return;
    }

    features.value.splice(index, 1);
    drop(key);
  }

  function forwardOpenSpell(spellId: string, packId?: string): void {
    emit('open-spell', spellId, packId);
  }
</script>

<template>
  <div class="flex flex-col gap-2">
    <div
      v-for="(feature, featureIndex) in features"
      :key="feature.key"
      class="rounded-lg border border-default bg-elevated/20"
    >
      <!-- Нажимается вся плашка целиком: попадать в стрелку или ровно в
        название незачем, промахи мимо них раньше просто ничего не делали -->
      <div
        class="flex min-h-11 cursor-pointer items-center gap-2 p-2 transition-colors hover:bg-elevated/50"
        :class="headerClass(feature.key)"
        role="button"
        tabindex="0"
        :aria-expanded="isExpanded(feature.key)"
        :aria-label="toggleAriaLabel(feature.key)"
        @click.left.exact.prevent="toggle(feature.key)"
        @keydown.enter.prevent="toggle(feature.key)"
        @keydown.space.prevent="toggle(feature.key)"
      >
        <UIcon
          :name="toggleIcon(feature.key)"
          class="size-4 shrink-0 text-muted"
        />

        <span
          class="min-w-0 flex-1 truncate text-sm font-medium text-highlighted"
        >
          {{ feature.name || CLASS_FEATURES_EDITOR_LABELS.fallbackName }}
        </span>

        <!-- Бейджи прячутся на узком окне: там их место нужнее названию -->
        <UBadge
          v-for="badge in featureBadges(feature)"
          :key="badge.key"
          :color="badge.color"
          variant="subtle"
          size="sm"
          class="hidden shrink-0 md:inline-flex"
        >
          {{ badge.label }}
        </UBadge>

        <UBadge
          color="neutral"
          variant="subtle"
          size="sm"
          class="shrink-0"
        >
          {{ feature.level }}{{ LEVEL_BADGE_SUFFIX }}
        </UBadge>

        <UButton
          icon="tabler:trash"
          color="error"
          variant="ghost"
          size="xs"
          :aria-label="CLASS_FEATURES_EDITOR_LABELS.remove"
          @click.left.exact.prevent.stop="requestRemoval(feature.key)"
        />
      </div>

      <div
        v-if="isExpanded(feature.key)"
        class="border-t border-default/50 p-3"
      >
        <ClassFeatureFields
          v-model="features[featureIndex]"
          :available-spells="availableSpells"
          :socket="socket"
          @open-spell="forwardOpenSpell"
        />
      </div>
    </div>
  </div>

  <!-- Подтверждение удаления: настройки умения вернуть неоткуда -->
  <UDraggableModal
    :open="pendingRemovalKey !== null"
    :title="DELETE_CONFIRM_TITLE"
    :draggable="false"
    :resizable="false"
    blocking
    :min-width="400"
    :min-height="160"
    :z-index="removalConfirmZIndex"
    @update:open="handleRemovalOpenChange"
  >
    <template #body>
      <div class="space-y-4">
        <p class="text-sm text-toned">
          {{ CLASS_FEATURES_EDITOR_LABELS.removeConfirmPrefix
          }}<span class="font-semibold text-highlighted">{{
            pendingRemovalName
          }}</span
          >{{ CLASS_FEATURES_EDITOR_LABELS.removeConfirmSuffix }}
        </p>

        <div class="flex justify-end gap-2">
          <UButton
            variant="ghost"
            color="neutral"
            size="sm"
            @click.left.exact.prevent="cancelRemoval"
          >
            {{ MODAL_BUTTON_LABELS.cancel }}
          </UButton>

          <UButton
            color="error"
            icon="tabler:trash"
            size="sm"
            @click.left.exact.prevent="confirmRemoval"
          >
            {{ MODAL_BUTTON_LABELS.remove }}
          </UButton>
        </div>
      </div>
    </template>
  </UDraggableModal>
</template>
