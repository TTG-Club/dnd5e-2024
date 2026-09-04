<script setup lang="ts">
  import type { Feature } from '@vtt/shared';
  import type { BackgroundDefinition } from '@vtt/shared/system/dnd.js';

  import type { ChoicePickerOption } from '../ChoicePickerModal.vue';

  import { computed } from 'vue';

  import ItemDescriptionRenderer from '@/shared_ui/components/ItemDescriptionRenderer.vue';
  import { useModalManager } from '@/shared_ui/composables/useModalManager';
  import {
    SKILLS_LABELS,
    toolProficiencyLabel,
  } from '@vtt/shared/system/dnd.js';

  import ChoicePickerField from '../ChoicePickerField.vue';
  import { BACKGROUND_WIZARD_LABELS, GRANT_SECTION_LABELS } from '../constants';

  const props = defineProps<{
    backgroundDefinition: BackgroundDefinition;
    featsData: Feature[];
  }>();

  const selectedFeatId = defineModel<string>('selectedFeatId');

  const { openModal } = useModalManager();

  function openFeatDescription() {
    const featId =
      selectedFeatId.value || props.backgroundDefinition.featGrant.featId;

    if (!featId) {
      return;
    }

    const feat = props.featsData.find((feat) => feat.id === featId);

    if (!feat) {
      return;
    }

    openModal('ActorDescriptionModal', {
      _modalKey: feat.id,
      title: feat.name,
      subtitle: feat.nameEn || '',
      sourceKey: feat.sourceKey,
      description: feat.description || '',
    });
  }

  /**
   * Строка «сколько инструментов на выбор»: перед числом встаёт связка
   * перечисления, если выданные инструменты уже перечислены до него. Склейка
   * строкой, а не шаблоном: хвост начинается с пробела, и разорви форматтер
   * подстановки переносом — пробелов стало бы два.
   */
  const toolChoiceLabel = computed(() => {
    const { toolGrant } = props.backgroundDefinition;

    const listPrefix =
      toolGrant.items.length > 0 ? BACKGROUND_WIZARD_LABELS.listAnd : '';

    return (
      listPrefix
      + (toolGrant.choices?.count ?? 0)
      + BACKGROUND_WIZARD_LABELS.toolChoiceSuffix
    );
  });

  /**
   * Черты на выбор для окна выбора. Незагруженная запись показывается своим
   * ключом: так видно, что выбор есть, а справочник до него не доехал.
   */
  const featChoiceOptions = computed<ChoicePickerOption[]>(() =>
    (props.backgroundDefinition.featGrant.featChoices ?? []).map((id) => {
      const feat = props.featsData.find((entry) => entry.id === id);

      return {
        value: id,
        name: feat?.name ?? id,
        nameEn: feat?.nameEn,
        description: feat?.description,
      };
    }),
  );

  /** Выбранная черта набором отметок — так её ждёт строка выбора */
  const featChoiceSelected = computed(() =>
    selectedFeatId.value ? [selectedFeatId.value] : [],
  );

  /**
   * Записывает выбранную черту: окно отдаёт набор отметок, а черту берут одну.
   *
   * @param values - отмеченные значения
   */
  function selectFeat(values: string[]): void {
    selectedFeatId.value = values[0] ?? undefined;
  }
</script>

<template>
  <div class="space-y-6">
    <ItemDescriptionRenderer :content="backgroundDefinition.description" />

    <!-- Резюме -->
    <div class="grid grid-cols-2 gap-2">
      <div
        class="rounded-lg border border-default/50 bg-elevated/30 px-3 py-2.5"
      >
        <span
          class="block text-[10px] font-medium tracking-wider text-dimmed uppercase"
        >
          {{ GRANT_SECTION_LABELS.skills }}
        </span>

        <div class="mt-1.5 flex flex-wrap gap-1.5">
          <UBadge
            v-for="skill in backgroundDefinition.skillGrant.skills"
            :key="skill"
            variant="subtle"
            color="neutral"
            size="sm"
          >
            {{ SKILLS_LABELS[skill] }}
          </UBadge>
        </div>
      </div>

      <div
        class="rounded-lg border border-default/50 bg-elevated/30 px-3 py-2.5"
      >
        <span
          class="block text-[10px] font-medium tracking-wider text-dimmed uppercase"
        >
          {{ GRANT_SECTION_LABELS.tools }}
        </span>

        <div class="mt-1.5 flex flex-wrap items-center gap-1.5">
          <UBadge
            v-for="tool in backgroundDefinition.toolGrant.items"
            :key="tool"
            variant="subtle"
            color="neutral"
            size="sm"
          >
            {{ toolProficiencyLabel(tool) }}
          </UBadge>

          <span
            v-if="backgroundDefinition.toolGrant.choices?.count"
            class="text-sm font-semibold text-highlighted"
          >
            {{ toolChoiceLabel }}
          </span>
        </div>
      </div>

      <div
        class="col-span-2 flex flex-col gap-2 rounded-lg border border-default/50 bg-elevated/30 p-3"
      >
        <span
          class="block text-[10px] font-medium tracking-wider text-dimmed uppercase"
        >
          {{ BACKGROUND_WIZARD_LABELS.featTitle }}
        </span>

        <template v-if="backgroundDefinition.featGrant.featChoices?.length">
          <ChoicePickerField
            :label="BACKGROUND_WIZARD_LABELS.featPlaceholder"
            :options="featChoiceOptions"
            :selected="featChoiceSelected"
            :max="1"
            @update:selected="selectFeat"
          />

          <UButton
            v-if="selectedFeatId"
            variant="link"
            color="primary"
            class="h-auto self-start p-0"
            @click.left.exact.prevent="openFeatDescription"
          >
            {{ BACKGROUND_WIZARD_LABELS.featShowDescription }}
          </UButton>
        </template>

        <template v-else>
          <button
            class="self-start text-left text-sm font-medium text-healing hover:text-healing/80 hover:underline"
            @click.left.exact.prevent="openFeatDescription"
          >
            {{ backgroundDefinition.featGrant.featName }}
          </button>
        </template>
      </div>
    </div>
  </div>
</template>
