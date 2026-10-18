<!--
  Окно мастера «Запросить бросок»: кому (выделенные фишки или группа фишек
  сцены), что бросить (спасбросок, проверка характеристики или навыка) и
  против какой сложности. Открывается слотом ядра `promptGmRollRequest` — из
  меню фишки с выделенной группой или из меню пустого места карты.

  Списки взаимоисключающие: открыт только один, следующий закрывает прежний.
-->
<script setup lang="ts">
  import type { AbilityType, SkillType } from '@vtt/shared';

  import type { GmRollRequestGroup, GmRollRequestKind } from './constants';

  import { computed, ref } from 'vue';

  import UDraggableModal from '@/shared_ui/components/UDraggableModal.vue';
  import { useWorldStore } from '@/stores/worldStore';
  import { isCreatureEntity } from '@vtt/shared';
  import {
    ABILITY_KEYS,
    ABILITY_LABELS,
    SKILLS_LIST,
  } from '@vtt/shared/system/dnd.js';

  import { sendGmRollRequest } from '../../composables/gmRollRequest';
  import { useWorldEntities } from '../../composables/useWorldEntities';
  import { MODAL_BUTTON_LABELS } from '../actor/constants';
  import {
    GM_ROLL_REQUEST_DC_MAX,
    GM_ROLL_REQUEST_DC_MIN,
    GM_ROLL_REQUEST_DEFAULT_ABILITY,
    GM_ROLL_REQUEST_DEFAULT_DC,
    GM_ROLL_REQUEST_DEFAULT_GROUP,
    GM_ROLL_REQUEST_DEFAULT_KIND,
    GM_ROLL_REQUEST_DEFAULT_SKILL,
    GM_ROLL_REQUEST_GROUP_LABELS,
    GM_ROLL_REQUEST_GROUPS,
    GM_ROLL_REQUEST_ICON,
    GM_ROLL_REQUEST_KIND_LABELS,
    GM_ROLL_REQUEST_KINDS,
    GM_ROLL_REQUEST_LABELS,
    GM_ROLL_REQUEST_LOG_MESSAGES,
    GM_ROLL_REQUEST_LOG_PREFIX,
  } from './constants';

  /** Списки окна: открытым бывает только один */
  type RollRequestSelectKey = 'recipients' | 'kind' | 'subject';

  /** Сущность сцены, которую видят игроки */
  interface VisibleSceneEntity {
    /** ID сущности */
    entityId: string;
    /** Существо (а не персонаж игрока) */
    isCreature: boolean;
  }

  const props = defineProps<{
    /** Открыто ли окно */
    open: boolean;
    /** Сцена, с которой открыли окно */
    sceneId: string;
    /** Сущности выделенных фишек; пусто — окно открыто с карты */
    initialEntityIds: readonly string[];
    /** Скрытые пропсы менеджера окон — чтобы не было предупреждений */
    modalId?: string;
    savedPosition?: unknown;
    savedSize?: unknown;
    /** Z-index окна (управляется менеджером окон) */
    zIndex?: number;
  }>();

  const emit = defineEmits<{
    'update:open': [value: boolean];
    'bring-to-front': [];
  }>();

  const worldStore = useWorldStore();
  const { findCurrentDndEntity } = useWorldEntities();

  const hasSelection = props.initialEntityIds.length > 0;

  const group = ref<GmRollRequestGroup>(
    hasSelection ? 'selected' : GM_ROLL_REQUEST_DEFAULT_GROUP,
  );

  const kind = ref<GmRollRequestKind>(GM_ROLL_REQUEST_DEFAULT_KIND);
  const ability = ref<AbilityType>(GM_ROLL_REQUEST_DEFAULT_ABILITY);
  const skill = ref<SkillType>(GM_ROLL_REQUEST_DEFAULT_SKILL);
  const dc = ref<number>(GM_ROLL_REQUEST_DEFAULT_DC);

  /** Какой список открыт сейчас */
  const openSelect = ref<RollRequestSelectKey | null>(null);

  /** Выделенные есть в списке, только если окно открыли из меню фишки */
  const groupItems = GM_ROLL_REQUEST_GROUPS.filter(
    (value) => value !== 'selected' || hasSelection,
  ).map((value) => ({
    value,
    label:
      value === 'selected'
        ? `${GM_ROLL_REQUEST_GROUP_LABELS[value]}${GM_ROLL_REQUEST_LABELS.countPrefix}${props.initialEntityIds.length}${GM_ROLL_REQUEST_LABELS.countSuffix}`
        : GM_ROLL_REQUEST_GROUP_LABELS[value],
  }));

  const kindItems = GM_ROLL_REQUEST_KINDS.map((value) => ({
    value,
    label: GM_ROLL_REQUEST_KIND_LABELS[value],
  }));

  const abilityItems = ABILITY_KEYS.map((value) => ({
    value,
    label: ABILITY_LABELS[value],
  }));

  const skillItems = SKILLS_LIST.map((entry) => ({
    value: entry.key,
    label: entry.label,
  }));

  /**
   * Сущности фишек сцены, которые видят игроки, — по одной записи на
   * сущность. Сущность скрыта, только если скрыты все её фишки.
   */
  const visibleSceneEntities = computed<VisibleSceneEntity[]>(() => {
    const scene = worldStore.currentWorld?.scenes.find(
      (sceneEntry) => sceneEntry.id === props.sceneId,
    );

    const entities = new Map<string, VisibleSceneEntity>();

    for (const token of scene?.tokens ?? []) {
      if (token.hidden === true || entities.has(token.actorId)) {
        continue;
      }

      const entity = findCurrentDndEntity(token.actorId);

      if (entity) {
        entities.set(entity.id, {
          entityId: entity.id,
          isCreature: isCreatureEntity(entity),
        });
      }
    }

    return [...entities.values()];
  });

  /** Кому уйдёт запрос по выбору в поле «Кому» */
  const recipientIds = computed<readonly string[]>(() => {
    if (group.value === 'selected') {
      return props.initialEntityIds;
    }

    return visibleSceneEntities.value
      .filter(
        (entry) =>
          group.value === 'all'
          || entry.isCreature === (group.value === 'creatures'),
      )
      .map((entry) => entry.entityId);
  });

  const hasRecipients = computed(() => recipientIds.value.length > 0);

  /** Ошибка поля «Кому»: под выбор не попала ни одна фишка */
  const recipientsError = computed(() =>
    hasRecipients.value ? false : GM_ROLL_REQUEST_LABELS.noRecipients,
  );

  const isSkillCheck = computed(() => kind.value === 'skill');

  const canSubmit = computed(
    () => hasRecipients.value && dc.value >= GM_ROLL_REQUEST_DC_MIN,
  );

  /**
   * Открывает или закрывает список; открытие закрывает остальные.
   *
   * @param key - какой список
   * @param isOpen - открыть или закрыть
   */
  function setSelectOpen(key: RollRequestSelectKey, isOpen: boolean): void {
    if (isOpen) {
      openSelect.value = key;
    } else if (openSelect.value === key) {
      openSelect.value = null;
    }
  }

  /** Закрывает окно */
  function closeWindow(): void {
    emit('update:open', false);
  }

  /** Рассылает запрос и закрывает окно: итог мастер увидит уведомлением */
  function submitRequest(): void {
    if (!canSubmit.value) {
      return;
    }

    sendGmRollRequest({
      entityIds: recipientIds.value,
      kind: kind.value,
      ability: ability.value,
      skill: skill.value,
      dc: Math.trunc(dc.value),
    }).catch((error: unknown) => {
      console.error(
        `${GM_ROLL_REQUEST_LOG_PREFIX} ${GM_ROLL_REQUEST_LOG_MESSAGES.sendFailed}`,
        error,
      );
    });

    closeWindow();
  }
</script>

<template>
  <UDraggableModal
    :open="open"
    :title="GM_ROLL_REQUEST_LABELS.title"
    :initial-width="460"
    :min-width="360"
    :min-height="320"
    :z-index="zIndex"
    @update:open="emit('update:open', $event)"
    @bring-to-front="emit('bring-to-front')"
  >
    <template #body>
      <div class="flex flex-col gap-4">
        <UFormField
          :label="GM_ROLL_REQUEST_LABELS.recipients"
          :help="GM_ROLL_REQUEST_LABELS.recipientsHint"
          :error="recipientsError"
          size="md"
        >
          <USelect
            v-model="group"
            :open="openSelect === 'recipients'"
            :items="groupItems"
            value-key="value"
            label-key="label"
            size="md"
            class="w-full"
            @update:open="setSelectOpen('recipients', $event)"
          />
        </UFormField>

        <UFormField
          :label="GM_ROLL_REQUEST_LABELS.kind"
          size="md"
        >
          <USelect
            v-model="kind"
            :open="openSelect === 'kind'"
            :items="kindItems"
            value-key="value"
            label-key="label"
            size="md"
            class="w-full"
            @update:open="setSelectOpen('kind', $event)"
          />
        </UFormField>

        <div class="flex gap-3">
          <UFormField
            v-if="isSkillCheck"
            :label="GM_ROLL_REQUEST_LABELS.skill"
            size="md"
            class="min-w-0 flex-1"
          >
            <USelect
              v-model="skill"
              :open="openSelect === 'subject'"
              :items="skillItems"
              value-key="value"
              label-key="label"
              size="md"
              class="w-full"
              @update:open="setSelectOpen('subject', $event)"
            />
          </UFormField>

          <UFormField
            v-else
            :label="GM_ROLL_REQUEST_LABELS.ability"
            size="md"
            class="min-w-0 flex-1"
          >
            <USelect
              v-model="ability"
              :open="openSelect === 'subject'"
              :items="abilityItems"
              value-key="value"
              label-key="label"
              size="md"
              class="w-full"
              @update:open="setSelectOpen('subject', $event)"
            />
          </UFormField>

          <UFormField
            :label="GM_ROLL_REQUEST_LABELS.dc"
            size="md"
            class="w-40 shrink-0"
          >
            <UInputNumber
              v-model="dc"
              :min="GM_ROLL_REQUEST_DC_MIN"
              :max="GM_ROLL_REQUEST_DC_MAX"
              size="md"
            />
          </UFormField>
        </div>

        <div class="flex justify-end gap-2 pt-2">
          <UButton
            :label="MODAL_BUTTON_LABELS.cancel"
            color="neutral"
            variant="ghost"
            size="md"
            @click.left.exact.prevent="closeWindow"
          />

          <UButton
            :label="GM_ROLL_REQUEST_LABELS.submit"
            :disabled="!canSubmit"
            :icon="GM_ROLL_REQUEST_ICON"
            color="primary"
            size="md"
            @click.left.exact.prevent="submitRequest"
          />
        </div>
      </div>
    </template>
  </UDraggableModal>
</template>
