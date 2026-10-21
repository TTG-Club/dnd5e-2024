<script setup lang="ts">
  import type {
    DnDActor,
    DnDActorPersonality,
    PersonalityFieldKey,
  } from '@vtt/shared/system/dnd.js';

  import { computed, ref } from 'vue';

  import ItemDescriptionRenderer from '@/shared_ui/components/ItemDescriptionRenderer.vue';
  import {
    ABILITY_KEYS,
    ABILITY_LABELS,
    getAlignmentLabel,
    PERSONALITY_TEXT_FIELD_KEYS,
    readActorPersonality,
  } from '@vtt/shared/system/dnd.js';

  import {
    PERSONALITY_EMPTY_VALUE,
    PERSONALITY_TAB_LABELS,
    PERSONALITY_TEXT_FIELD_LABELS,
  } from '../constants';
  import PersonalityAppearanceModal from '../PersonalityAppearanceModal.vue';
  import PersonalityDescriptionModal from '../PersonalityDescriptionModal.vue';

  /*
   * Вкладка «Личность» листа актёра — по образцу вкладки листа на сайте:
   * приметы, предыстория и подробное описание.
   *
   * Вкладка не переключается в правку вместе с листом: приметы и описание
   * правятся своими окнами — по плитке или карандашу раздела, как на сайте.
   * Вне режима правки лист сохраняет такую правку сразу, в режиме правки — по
   * «Сохранить». Предыстория здесь только показывается: её меняет мастер в
   * шапке листа.
   */

  interface Props {
    actor: DnDActor;
    /** Может ли пользователь править лист: без прав окна не открываются */
    canEdit: boolean;
  }

  const props = defineProps<Props>();

  const emit = defineEmits<{
    'update:actor': [updates: Partial<DnDActor>];
  }>();

  const personality = computed(() =>
    readActorPersonality(props.actor.system.personality),
  );

  const isAppearanceModalOpen = ref(false);
  const isDescriptionModalOpen = ref(false);

  /** Поле, по плитке которого открыли окно примет: в нём встанет курсор */
  const appearanceFocusField = ref<PersonalityFieldKey | null>(null);

  /**
   * Плитки примет: заполненное читается основным цветом, прочерк —
   * приглушённым, иначе ряд пустых полей забивает собой вкладку.
   */
  const appearanceTiles = computed(() => {
    const alignmentLabel = getAlignmentLabel(personality.value.alignment) ?? '';

    const tiles: { key: PersonalityFieldKey; label: string; value: string }[] =
      [
        {
          key: 'alignment',
          label: PERSONALITY_TAB_LABELS.alignment,
          value: alignmentLabel,
        },
        ...PERSONALITY_TEXT_FIELD_KEYS.map((field) => ({
          key: field,
          label: PERSONALITY_TEXT_FIELD_LABELS[field].label,
          value: personality.value[field].trim(),
        })),
      ];

    return tiles.map((tile) => ({
      ...tile,
      value: tile.value || PERSONALITY_EMPTY_VALUE,
      valueClass: tile.value ? 'text-highlighted' : 'text-dimmed',
    }));
  });

  /** Плитка — кнопка правки только у того, кто может править лист */
  const tileClass = computed(() =>
    props.canEdit
      ? 'cursor-pointer hover:border-primary/60 hover:bg-elevated/40'
      : 'cursor-default',
  );

  const background = computed(() => props.actor.system.background);

  /** Прибавки характеристик от предыстории — чипами рядом с её названием */
  const backgroundBonusChips = computed(() => {
    const choices = background.value?.abilityChoices ?? {};

    return ABILITY_KEYS.filter((ability) => (choices[ability] ?? 0) > 0).map(
      (ability) => ({
        ability,
        label: `${ABILITY_LABELS[ability]} +${choices[ability]}`,
      }),
    );
  });

  const backgroundFeatLabel = computed(() =>
    background.value?.grantedFeatName
      ? `${PERSONALITY_TAB_LABELS.backgroundFeat}: ${background.value.grantedFeatName}`
      : '',
  );

  /**
   * Кладёт личность в блок `system` актёра. Пишется личность целиком: так
   * поле, которого у старого актёра не было, заводится одной правкой.
   *
   * @param nextPersonality - новая личность
   */
  function writePersonality(nextPersonality: DnDActorPersonality): void {
    emit('update:actor', {
      system: { ...props.actor.system, personality: nextPersonality },
    });
  }

  function openAppearanceModal(field: PersonalityFieldKey | null): void {
    appearanceFocusField.value = field;
    isAppearanceModalOpen.value = true;
  }

  /** Правка примет карандашом раздела — без выделенного поля */
  function handleAppearanceEdit(): void {
    openAppearanceModal(null);
  }

  function handleDescriptionEdit(): void {
    isDescriptionModalOpen.value = true;
  }

  function handleDescriptionApply(description: string): void {
    writePersonality({ ...personality.value, description });
  }
</script>

<template>
  <div class="flex flex-col gap-4">
    <section>
      <div class="mb-2 flex items-center gap-1">
        <h4 class="text-xs font-semibold tracking-wider text-muted uppercase">
          {{ PERSONALITY_TAB_LABELS.appearanceTitle }}
        </h4>

        <UButton
          v-if="canEdit"
          icon="tabler:pencil"
          color="neutral"
          variant="ghost"
          size="xs"
          square
          :aria-label="PERSONALITY_TAB_LABELS.editAppearance"
          @click.left.exact.prevent="handleAppearanceEdit"
        />
      </div>

      <!-- Ряд плиток считает колонки по своей ширине, а не по ширине листа:
        вкладки на широком листе занимают лишь часть окна -->
      <div class="@container">
        <div class="grid grid-cols-2 gap-2 @md:grid-cols-3 @xl:grid-cols-4">
          <button
            v-for="tile in appearanceTiles"
            :key="tile.key"
            type="button"
            class="flex flex-col gap-0.5 rounded-lg border border-default/50 bg-elevated/20 px-3 py-2 text-left transition-colors"
            :class="tileClass"
            :disabled="!canEdit"
            :aria-label="`${PERSONALITY_TAB_LABELS.editAppearanceTile}: ${tile.label}`"
            @click.left.exact.prevent="openAppearanceModal(tile.key)"
          >
            <span
              class="text-[10px] font-bold tracking-wider text-muted uppercase"
            >
              {{ tile.label }}
            </span>

            <!-- Значение переносится, а не обрезается: на узкой плитке
              мировоззрение иначе читалось бы огрызком -->
            <span
              class="text-sm font-medium wrap-break-word"
              :class="tile.valueClass"
            >
              {{ tile.value }}
            </span>
          </button>
        </div>
      </div>
    </section>

    <section>
      <h4
        class="mb-2 text-xs font-semibold tracking-wider text-muted uppercase"
      >
        {{ PERSONALITY_TAB_LABELS.backgroundTitle }}
      </h4>

      <div
        v-if="background"
        class="flex flex-col gap-2"
      >
        <div class="flex flex-wrap items-center gap-2">
          <UIcon
            name="tabler:book"
            class="size-4 shrink-0 text-primary"
          />

          <span class="text-sm font-medium text-highlighted">
            {{ background.backgroundName }}
          </span>
        </div>

        <div
          v-if="backgroundBonusChips.length"
          class="flex flex-wrap gap-1.5"
        >
          <UBadge
            v-for="chip in backgroundBonusChips"
            :key="chip.ability"
            :label="chip.label"
            color="neutral"
            variant="subtle"
            size="sm"
          />
        </div>

        <span
          v-if="backgroundFeatLabel"
          class="text-sm text-muted"
        >
          {{ backgroundFeatLabel }}
        </span>

        <span class="text-xs text-dimmed italic">
          {{ PERSONALITY_TAB_LABELS.backgroundHint }}
        </span>
      </div>

      <p
        v-else
        class="rounded-lg border border-dashed border-default px-3 py-4 text-center text-sm text-dimmed"
      >
        {{ PERSONALITY_TAB_LABELS.backgroundEmpty }}
      </p>
    </section>

    <section>
      <div class="mb-2 flex items-center gap-1">
        <h4 class="text-xs font-semibold tracking-wider text-muted uppercase">
          {{ PERSONALITY_TAB_LABELS.descriptionTitle }}
        </h4>

        <UButton
          v-if="canEdit"
          icon="tabler:pencil"
          color="neutral"
          variant="ghost"
          size="xs"
          square
          :aria-label="PERSONALITY_TAB_LABELS.editDescription"
          @click.left.exact.prevent="handleDescriptionEdit"
        />
      </div>

      <ItemDescriptionRenderer
        v-if="personality.description"
        :content="personality.description"
        class="rounded-lg bg-accented/30 p-4"
      />

      <div
        v-else
        class="flex flex-col items-center gap-2 rounded-lg border border-dashed border-default px-3 py-6 text-center"
      >
        <span class="text-sm text-dimmed">
          {{ PERSONALITY_TAB_LABELS.descriptionEmpty }}
        </span>

        <UButton
          v-if="canEdit"
          icon="tabler:plus"
          :label="PERSONALITY_TAB_LABELS.addDescription"
          color="neutral"
          variant="ghost"
          size="sm"
          @click.left.exact.prevent="handleDescriptionEdit"
        />
      </div>
    </section>

    <PersonalityAppearanceModal
      v-model:open="isAppearanceModalOpen"
      :personality="personality"
      :focus-field="appearanceFocusField"
      @apply="writePersonality"
    />

    <PersonalityDescriptionModal
      v-model:open="isDescriptionModalOpen"
      :description="personality.description"
      @apply="handleDescriptionApply"
    />
  </div>
</template>
