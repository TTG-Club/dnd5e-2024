<!--
  Особые правила эффекта (флаги): помеха, преимущество, сопротивления и прочее,
  что не число. Правило выбирается только из списка движка — произвольная
  строка молча не работала бы и отбрасывалась при разборе.
-->
<script setup lang="ts">
  // Корневой вход `@nuxt/ui` типов компонентов не отдаёт — берём из подпути
  import type { DropdownMenuItem } from '@nuxt/ui/components/DropdownMenu.vue';

  import type {
    EffectFlagKey,
    EffectFlagMenuGroup,
  } from '@vtt/shared/system/dnd.js';

  import { computed, ref } from 'vue';

  import {
    describeEffectFlag,
    EFFECT_FLAG_LABELS,
    EFFECT_FLAG_MENU,
    isEffectFlagKey,
  } from '@vtt/shared/system/dnd.js';

  import { SCROLLABLE_DROPDOWN_UI } from '../../actor/constants';
  import ActiveEffectSuggestionsModal from '../ActiveEffectSuggestionsModal.vue';
  import {
    ACTIVE_EFFECT_TEMPLATES_LABELS,
    CONDITION_PRESET_ICON,
    EFFECT_FLAG_ROW_LABELS,
    EFFECT_MODIFIERS_STEP_LABELS,
    EFFECT_TEMPLATES_MODAL_IDS,
  } from '../constants';

  const props = withDefaults(
    defineProps<{
      /**
       * Шаблоны состояний: их ищут среди правил («Отравленный» — не флаг, а
       * набор модификаторов и правил), поэтому меню «Готовые» ведёт и к ним.
       * Пусто — раздела нет.
       */
      conditionPresetItems?: DropdownMenuItem[];
    }>(),
    { conditionPresetItems: () => [] },
  );

  const flags = defineModel<EffectFlagKey[]>('flags', { required: true });

  const isSearchOpen = ref(false);

  /** Список флагов для поиска: подписи те же, что у строк */
  const flagSuggestions = Object.entries(EFFECT_FLAG_LABELS).map(
    ([flagKey, flagLabel]) => ({ value: flagKey, label: flagLabel }),
  );

  /** Поставленные правила с подписями */
  const rows = computed(() =>
    flags.value.map((flag) => ({ flag, label: describeEffectFlag(flag) })),
  );

  /**
   * Добавляет правило. Уже стоящее пропускается: список — набор, повтор ничего
   * не добавляет, а в списке выглядел бы дублем.
   *
   * @param flag - ключ правила
   */
  function addFlag(flag: EffectFlagKey): void {
    if (!flags.value.includes(flag)) {
      flags.value = [...flags.value, flag];
    }
  }

  /**
   * Убирает правило.
   *
   * @param flag - ключ правила
   */
  function removeFlag(flag: EffectFlagKey): void {
    flags.value = flags.value.filter((entry) => entry !== flag);
  }

  /**
   * Добавляет правило, выбранное в поиске, и закрывает окно.
   *
   * @param value - ключ из списка подсказок
   */
  function applySearchResult(value: string): void {
    isSearchOpen.value = false;

    if (isEffectFlagKey(value)) {
      addFlag(value);
    }
  }

  /** Открывает поиск правил */
  function openSearch(): void {
    isSearchOpen.value = true;
  }

  /**
   * Разворачивает раздел правил в пункт меню: у защит от урона внутри свои
   * разделы (сопротивление, иммунитет, уязвимость), у остальных — сразу правила.
   *
   * @param group - раздел меню
   * @returns пункт меню со вложенным списком
   */
  function flagGroupItem(group: EffectFlagMenuGroup): DropdownMenuItem {
    const nested = group.groups?.map(flagGroupItem) ?? [];

    return {
      label: group.label,
      children: [
        ...nested,
        ...group.items.map((item) => ({
          label: item.label,
          onSelect: () => addFlag(item.key),
        })),
      ],
    };
  }

  /** Разделы правил: правил под сотню, поэтому по разделам */
  const flagMenuGroups: DropdownMenuItem[][] = EFFECT_FLAG_MENU.map((group) => [
    flagGroupItem(group),
  ]);

  /**
   * Меню «Готовые»: состояния отдельным разделом в самом начале — подпись
   * внутри предупреждает, что выбор заменит правила, а не добавит одно
   */
  const presetMenuItems = computed<DropdownMenuItem[][]>(() => {
    if (props.conditionPresetItems.length === 0) {
      return flagMenuGroups;
    }

    const conditionGroup: DropdownMenuItem = {
      label: EFFECT_MODIFIERS_STEP_LABELS.flagMenuConditions,
      icon: CONDITION_PRESET_ICON,
      children: [
        {
          type: 'label',
          label: EFFECT_MODIFIERS_STEP_LABELS.flagMenuConditionsNote,
        },
        ...props.conditionPresetItems,
      ],
    };

    return [[conditionGroup], ...flagMenuGroups];
  });
</script>

<template>
  <div class="flex flex-col gap-2">
    <div class="flex items-center justify-between gap-2">
      <span class="text-xs font-medium text-default">
        {{ EFFECT_MODIFIERS_STEP_LABELS.flagsTitle }}
      </span>

      <div class="flex items-center gap-1">
        <UDropdownMenu
          :items="presetMenuItems"
          :content="{ align: 'end' }"
          :ui="SCROLLABLE_DROPDOWN_UI"
        >
          <UButton
            color="primary"
            variant="soft"
            size="xs"
            icon="tabler:list-search"
            :label="EFFECT_MODIFIERS_STEP_LABELS.presets"
            :title="EFFECT_MODIFIERS_STEP_LABELS.flagPresetHint"
          />
        </UDropdownMenu>

        <UButton
          color="primary"
          variant="ghost"
          size="xs"
          icon="tabler:search"
          :label="EFFECT_MODIFIERS_STEP_LABELS.flagSearch"
          @click.left.exact.prevent="openSearch"
        />
      </div>
    </div>

    <p
      v-if="rows.length === 0"
      class="rounded-md border border-dashed border-default px-3 py-2 text-center text-xs text-dimmed"
    >
      {{ EFFECT_MODIFIERS_STEP_LABELS.flagsEmpty }}
    </p>

    <div
      v-else
      class="flex flex-wrap gap-1.5"
    >
      <UBadge
        v-for="row in rows"
        :key="row.flag"
        color="neutral"
        variant="soft"
        size="lg"
        :title="row.flag"
      >
        {{ row.label }}

        <template #trailing>
          <UButton
            color="neutral"
            variant="link"
            size="xs"
            icon="tabler:x"
            class="p-0"
            :title="EFFECT_FLAG_ROW_LABELS.remove"
            @click.left.exact.prevent="removeFlag(row.flag)"
          />
        </template>
      </UBadge>
    </div>
  </div>

  <ActiveEffectSuggestionsModal
    v-model:open="isSearchOpen"
    :title="ACTIVE_EFFECT_TEMPLATES_LABELS.flagTitle"
    :search-placeholder="ACTIVE_EFFECT_TEMPLATES_LABELS.flagSearchPlaceholder"
    :empty-label="ACTIVE_EFFECT_TEMPLATES_LABELS.flagEmpty"
    :items="flagSuggestions"
    :modal-id="EFFECT_TEMPLATES_MODAL_IDS.flag"
    @select="applySearchResult"
  />
</template>
