<!--
  Карточка активного эффекта — ТОЛЬКО просмотр: что эффект делает, чем гейтится
  и сколько держится. Правка живёт отдельно (`ActiveEffectFormModal`) и доступна
  не всем: игрок видит эффект на предмете, черте или существе, но менять его не
  вправе.

  Окно одно на всю систему: его открывает любая строка эффекта — в карточке
  записи, на вкладке эффектов листа и в блоке эффектов существа.
-->
<script setup lang="ts">
  import type { ActiveEffect } from '@vtt/shared/system/dnd.js';

  import { computed } from 'vue';

  import ItemDescriptionRenderer from '@/shared_ui/components/ItemDescriptionRenderer.vue';
  import UDraggableModal from '@/shared_ui/components/UDraggableModal.vue';
  import {
    buildActiveEffectDetails,
    describeActiveEffect,
    EFFECT_ORIGIN_LABELS,
  } from '@vtt/shared/system/dnd.js';

  import {
    ACTIVE_EFFECT_DEFAULTS,
    ACTIVE_EFFECT_DETAIL_LABELS,
    ACTIVE_EFFECT_ICON_CLASS,
    ACTIVE_EFFECT_SECTION_ICONS,
  } from './constants';

  const props = defineProps<{
    /** Открыто ли окно */
    open: boolean;
    /** Эффект для просмотра */
    effect?: ActiveEffect | null;
    /** Название записи-носителя (предмет, черта, действие) — если известно */
    ownerName?: string;
    /** Z-index окна (ведёт менеджер окон хоста) */
    zIndex?: number;
  }>();

  const emit = defineEmits<{
    'update:open': [value: boolean];
    'bring-to-front': [];
  }>();

  /** Разбор настроек эффекта разделами: движок собирает, окно только показывает */
  const detailSections = computed(() =>
    props.effect ? buildActiveEffectDetails(props.effect) : [],
  );

  /**
   * Авторское описание эффекта. Описание, собранное кнопкой «Сгенерировать из
   * настроек», не показывается: разбор ниже говорит ровно то же самое, только
   * разделами — и карточка повторяла бы саму себя.
   */
  const authoredDescription = computed(() => {
    if (!props.effect?.description) {
      return '';
    }

    return props.effect.description === describeActiveEffect(props.effect)
      ? ''
      : props.effect.description;
  });

  /** Откуда эффект взялся — подпись значка в шапке */
  const originLabel = computed(() =>
    props.effect ? EFFECT_ORIGIN_LABELS[props.effect.origin] : '',
  );

  /** Цвет значка эффекта: у отключённого он гаснет */
  const iconClass = computed(() =>
    props.effect?.disabled
      ? ACTIVE_EFFECT_ICON_CLASS.disabled
      : ACTIVE_EFFECT_ICON_CLASS.active,
  );
</script>

<template>
  <UDraggableModal
    :open="open"
    :title="effect?.name ?? ACTIVE_EFFECT_DETAIL_LABELS.fallbackTitle"
    :subtitle="ownerName || undefined"
    :initial-width="480"
    :min-width="320"
    :min-height="200"
    :resizable="true"
    :z-index="zIndex"
    @update:open="emit('update:open', $event)"
    @bring-to-front="emit('bring-to-front')"
  >
    <template #header-actions>
      <UBadge
        v-if="effect?.disabled"
        :label="ACTIVE_EFFECT_DETAIL_LABELS.disabledBadge"
        color="neutral"
        variant="subtle"
        size="sm"
      />

      <UBadge
        v-if="originLabel"
        :label="originLabel"
        color="primary"
        variant="subtle"
        size="sm"
      />
    </template>

    <template #body>
      <div
        v-if="effect"
        class="flex flex-col gap-4"
      >
        <!-- Шапка: значок эффекта рядом с авторским описанием -->
        <div class="flex items-start gap-3">
          <UIcon
            :name="effect.icon || ACTIVE_EFFECT_DEFAULTS.fallbackIcon"
            class="mt-0.5 size-7 shrink-0"
            :class="iconClass"
          />

          <ItemDescriptionRenderer
            v-if="authoredDescription"
            :content="authoredDescription"
            class="min-w-0 flex-1"
          />
        </div>

        <!-- Разбор настроек: то, что эффект делает на самом деле -->
        <div class="flex flex-col gap-2">
          <h3 class="text-xs font-semibold tracking-wider text-muted uppercase">
            {{ ACTIVE_EFFECT_DETAIL_LABELS.mechanicsTitle }}
          </h3>

          <div
            v-for="section in detailSections"
            :key="section.key"
            class="rounded-lg border border-default/50 bg-elevated/30 p-3"
          >
            <div class="mb-1.5 flex items-center gap-2">
              <UIcon
                :name="ACTIVE_EFFECT_SECTION_ICONS[section.key]"
                class="size-4 shrink-0 text-primary"
              />

              <span class="text-xs font-semibold text-toned">
                {{ section.title }}
              </span>
            </div>

            <ul class="flex flex-col gap-1">
              <li
                v-for="(line, index) in section.lines"
                :key="index"
                class="text-sm wrap-break-word text-highlighted"
              >
                {{ line }}
              </li>
            </ul>
          </div>

          <p
            v-if="detailSections.length === 0"
            class="rounded-lg border border-dashed border-default p-3 text-center text-xs text-dimmed italic"
          >
            {{ ACTIVE_EFFECT_DETAIL_LABELS.mechanicsEmpty }}
          </p>
        </div>
      </div>
    </template>
  </UDraggableModal>
</template>
