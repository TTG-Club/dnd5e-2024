<!--
  Форма состояния: значок, названия, описание и эффект, который состояние
  накладывает, пока висит на сущности.

  Одна форма и на своё состояние стола, и на правку канонного: канон в мире не
  хранится, поэтому его правка сохраняется обычной записью мира и перекрывает
  канонное состояние по ключу. Кнопка «Сбросить к канону» такую запись удаляет.
-->
<script setup lang="ts">
  import type { TypedWebSocketClient } from '@vtt/shared';
  import type { ActiveEffect, DnDGameItem } from '@vtt/shared/system/dnd.js';

  import { computed, ref, watch } from 'vue';

  import AssetBrowser from '@/shared_ui/components/AssetBrowser.vue';
  import RichTextEditor from '@/shared_ui/components/RichTextEditor.vue';
  import UDraggableModal from '@/shared_ui/components/UDraggableModal.vue';
  import { useModalManager } from '@/shared_ui/composables/useModalManager';
  import { useItemsStore } from '@/stores/itemsStore';
  import { useWorldStore } from '@/stores/worldStore';
  import {
    buildConditionRecord,
    buildRuntimeConditionRecord,
    DEFAULT_CONDITION_ICON,
    describeActiveEffect,
    isCanonConditionKey,
    isConditionTemplateLocked,
    listRuntimeConditions,
    mintConditionKey,
    readConditionSystemData,
  } from '@vtt/shared/system/dnd.js';

  import { MODAL_BUTTON_LABELS } from '../actor/constants';
  import ActiveEffectFormModal from '../actor/tabs/ActiveEffectFormModal.vue';
  import ConditionBadge from './ConditionBadge.vue';
  import {
    CONDITION_EFFECT_MODAL_ID,
    CONDITION_FORM_ICONS,
    CONDITION_FORM_LABELS,
    CONDITION_ICON_CHOICES,
  } from './conditionConsts';

  const props = defineProps<{
    /** Открыто ли окно */
    open: boolean;
    /** Правимая запись состояния (`null` — создание) */
    item: DnDGameItem | null;
    /** Сокет мира — нужен для сброса правки канона */
    socket?: TypedWebSocketClient | null;
    /** Скрытые пропсы менеджера окон — чтобы не было предупреждений */
    modalId?: string;
    savedPosition?: unknown;
    savedSize?: unknown;
    /** Z-index окна (управляется менеджером окон) */
    zIndex?: number;
  }>();

  const emit = defineEmits<{
    'close': [];
    'save': [item: DnDGameItem];
    /**
     * Окно просят поднять поверх других. Событие ОБЯЗАНО быть объявлено: окно
     * открывает менеджер окон и вешает обработчик, а компонент рисует фрагмент
     * (окно формы + окно эффекта) — необъявленный обработчик наследовать не на
     * что, и Vue ругается «Extraneous non-emits event listeners».
     */
    'bring-to-front': [];
  }>();

  const itemsStore = useItemsStore();
  const worldStore = useWorldStore();
  const { getNextZIndex } = useModalManager();

  const name = ref('');
  const nameEn = ref('');
  const description = ref('');
  const image = ref('');
  const icon = ref(DEFAULT_CONDITION_ICON);
  const overlay = ref(false);
  const effect = ref<ActiveEffect | null>(null);
  const isEffectModalOpen = ref(false);
  const effectModalZIndex = ref<number | undefined>(undefined);
  const isAssetBrowserOpen = ref(false);

  /** Выбор в файловом менеджере мира — переносится в поле значка. */
  const pickedAsset = ref('');

  watch(pickedAsset, (asset) => {
    if (asset) {
      image.value = asset;
    }
  });

  /**
   * Ключ канонного состояния, взятого пресетом. Канон в мире не хранится, и
   * взять его пресетом — единственный способ его перекрыть: ключ сохраняется, а
   * значит запись встанет ПОВЕРХ канонного состояния, а не рядом с ним.
   */
  const presetKey = ref<string | null>(null);

  /**
   * Ключ правимого состояния: у правки записи — её собственный, у взятого
   * пресета — канонный, у нового состояния чеканится при сохранении.
   */
  const conditionKey = computed(
    () => readConditionSystemData(props.item)?.conditionKey ?? presetKey.value,
  );

  /** Правка канонного состояния (своя запись мира поверх канона системы). */
  const isCanonEdit = computed(() =>
    conditionKey.value ? isCanonConditionKey(conditionKey.value) : false,
  );

  /**
   * Правка канона УЖЕ сохранена в мире: у формы есть своя запись и её ключ —
   * канонный. У взятого пресета записи ещё нет, и сбрасывать нечего.
   */
  const hasSavedOverride = computed(
    () => Boolean(props.item) && isCanonEdit.value,
  );

  /** Эффект правке не подлежит (Истощение считается по степеням). */
  const isTemplateLocked = computed(() =>
    conditionKey.value ? isConditionTemplateLocked(conditionKey.value) : false,
  );

  /** Порт сервера мира — нужен файловому менеджеру (AssetBrowser). */
  const worldPort = computed(() => {
    const worldId = worldStore.connectionState.currentWorldId;

    return worldId ? worldStore.getWorldById(worldId)?.port : undefined;
  });

  /**
   * Пункты меню «Взять из пресета»: канон системы, который в этом мире ещё не
   * перекрыт. Перекрытый не предлагаем — его запись уже лежит в мастерской, и
   * править надо именно её.
   */
  const presetMenuItems = computed(() => [
    listRuntimeConditions()
      .filter((condition) => condition.isCanon && !condition.isOverridden)
      .map((condition) => ({
        label: condition.entry.nameRu,
        icon: condition.entry.icon,
        onSelect: () => applyPreset(condition.entry.key),
      })),
  ]);

  /**
   * Наполняет форму канонным состоянием и запоминает его ключ.
   *
   * @param conditionPresetKey - ключ канонного состояния
   */
  function applyPreset(conditionPresetKey: string): void {
    const record = buildRuntimeConditionRecord(conditionPresetKey);

    if (!record) {
      return;
    }

    presetKey.value = conditionPresetKey;
    name.value = record.name;
    nameEn.value = record.nameEn ?? '';
    description.value = record.description;
    image.value = record.image ?? '';

    icon.value =
      readConditionSystemData(record)?.icon ?? DEFAULT_CONDITION_ICON;

    overlay.value = readConditionSystemData(record)?.overlay ?? false;
    effect.value = record.activeEffects?.[0] ?? null;
  }

  /** Разбор эффекта человеческим языком — тот же, что в карточке эффекта. */
  const effectSummary = computed(() =>
    effect.value ? describeActiveEffect(effect.value) : '',
  );

  const canSave = computed(() => name.value.trim().length > 0);

  /** Заголовок окна: правка записи или создание новой. */
  const modalTitle = computed(() =>
    props.item
      ? CONDITION_FORM_LABELS.editTitle
      : CONDITION_FORM_LABELS.createTitle,
  );

  /** Подпись кнопки подтверждения: у новой записи — «Создать». */
  const submitLabel = computed(() =>
    props.item ? MODAL_BUTTON_LABELS.save : MODAL_BUTTON_LABELS.create,
  );

  /** Пояснение у кнопки пресетов: до выбора и после него оно разное. */
  const presetHint = computed(() =>
    presetKey.value
      ? CONDITION_FORM_LABELS.presetTakenHint
      : CONDITION_FORM_LABELS.fromPresetHint,
  );

  /** Значок кнопки файлового менеджера: раскрыт он или свёрнут. */
  const assetBrowserIcon = computed(() =>
    isAssetBrowserOpen.value
      ? CONDITION_FORM_ICONS.collapseAssets
      : CONDITION_FORM_ICONS.expandAssets,
  );

  /** Наполняет форму правимой записью (или очищает под создание). */
  function hydrate(): void {
    const systemData = readConditionSystemData(props.item);

    name.value = props.item?.name ?? '';
    nameEn.value = props.item?.nameEn ?? '';
    description.value = props.item?.description ?? '';
    image.value = props.item?.image ?? '';
    pickedAsset.value = '';
    isAssetBrowserOpen.value = false;
    presetKey.value = null;
    icon.value = systemData?.icon ?? DEFAULT_CONDITION_ICON;
    overlay.value = systemData?.overlay ?? false;
    effect.value = props.item?.activeEffects?.[0] ?? null;
  }

  watch(
    () => props.open,
    (isOpen) => {
      if (isOpen) {
        hydrate();
      }
    },
    { immediate: true },
  );

  /** Открывает редактор эффекта состояния поверх формы. */
  function openEffectForm(): void {
    effectModalZIndex.value = getNextZIndex();
    isEffectModalOpen.value = true;
  }

  /**
   * Принимает эффект из редактора эффектов.
   *
   * @param saved - собранный эффект
   */
  function saveEffect(saved: ActiveEffect): void {
    effect.value = saved;
  }

  /** Убирает эффект: состояние станет чистой меткой. */
  function clearEffect(): void {
    effect.value = null;
  }

  /** Убирает картинку-значок: останется иконка из набора. */
  function clearImage(): void {
    image.value = '';
  }

  /**
   * Сбрасывает правку канона: удаляет запись мира, и состояние снова берётся из
   * системы.
   */
  function resetToCanon(): void {
    if (!props.socket || !props.item) {
      return;
    }

    itemsStore.deleteItem(props.socket, props.item.id);
    emit('close');
  }

  /** Собирает запись состояния из полей формы и отдаёт её на сохранение. */
  function handleSave(): void {
    if (!canSave.value) {
      return;
    }

    const key =
      conditionKey.value ?? mintConditionKey(name.value, nameEn.value);

    emit(
      'save',
      buildConditionRecord({
        // Правка КАНОНА заводит новую запись мира: у пресета своей записи нет, а
        // его идентификатор — выдумка системы, и мир по нему ничего не найдёт.
        id:
          hasSavedOverride.value || !isCanonEdit.value
            ? (props.item?.id ?? '')
            : '',
        conditionKey: key,
        name: name.value,
        nameEn: nameEn.value,
        description: description.value,
        image: image.value,
        icon: icon.value,
        overlay: overlay.value,
        effect: effect.value,
      }),
    );

    emit('close');
  }

  /**
   * Обрабатывает закрытие окна крестиком или кликом мимо: правки не
   * досохраняются — так же, как в остальных формах записей.
   *
   * @param value - новое состояние открытости окна
   */
  function handleOpenChange(value: boolean): void {
    if (!value) {
      emit('close');
    }
  }
</script>

<template>
  <UDraggableModal
    :open="open"
    :title="modalTitle"
    :subtitle="name || undefined"
    :initial-width="720"
    :min-width="560"
    :resizable="false"
    :z-index="zIndex"
    @update:open="handleOpenChange"
    @bring-to-front="emit('bring-to-front')"
  >
    <template #body>
      <div class="flex flex-col gap-4 py-2">
        <!-- Пресеты канона: показываются только при создании — у своей записи
          ключ уже есть, и подмена его пресетом оборвала бы связь с эффектами,
          которые уже висят на сущностях -->
        <div
          v-if="!item"
          class="flex items-center gap-2"
        >
          <UDropdownMenu
            :items="presetMenuItems"
            :ui="{ content: 'max-h-75 overflow-y-auto' }"
          >
            <UButton
              icon="tabler:template"
              :label="CONDITION_FORM_LABELS.fromPreset"
              color="neutral"
              variant="outline"
              size="xs"
            />
          </UDropdownMenu>

          <span class="text-xs text-dimmed italic">
            {{ presetHint }}
          </span>
        </div>

        <!-- Названия -->
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <UFormField :label="CONDITION_FORM_LABELS.name">
            <UInput
              v-model="name"
              :placeholder="CONDITION_FORM_LABELS.namePlaceholder"
              class="w-full"
            />
          </UFormField>

          <UFormField :label="CONDITION_FORM_LABELS.nameEn">
            <UInput
              v-model="nameEn"
              :placeholder="CONDITION_FORM_LABELS.nameEnPlaceholder"
              class="w-full"
            />
          </UFormField>
        </div>

        <!-- Значок -->
        <UFormField :label="CONDITION_FORM_LABELS.icon">
          <div class="flex flex-col gap-2">
            <div class="flex items-center gap-3">
              <div
                class="flex size-10 shrink-0 items-center justify-center rounded-lg border border-default/50 bg-elevated/30 text-primary"
              >
                <ConditionBadge
                  :icon="icon"
                  :image="image"
                  :size="24"
                />
              </div>

              <UInput
                v-model="image"
                icon="tabler:link"
                :placeholder="CONDITION_FORM_LABELS.pickImage"
                class="flex-1"
              />

              <UButton
                v-if="image"
                icon="tabler:x"
                color="neutral"
                variant="ghost"
                :label="CONDITION_FORM_LABELS.clearImage"
                @click.left.exact.prevent="clearImage"
              />
            </div>

            <p class="text-xs text-dimmed">
              {{ CONDITION_FORM_LABELS.imageHint }}
            </p>

            <!-- Набор значков коллекции -->
            <div class="flex flex-wrap gap-1.5">
              <UButton
                v-for="choice in CONDITION_ICON_CHOICES"
                :key="choice"
                :icon="choice"
                size="sm"
                square
                :color="icon === choice ? 'primary' : 'neutral'"
                :variant="icon === choice ? 'solid' : 'ghost'"
                @click.left.exact.prevent="icon = choice"
              />
            </div>

            <!-- Файлы мира: раскрываются по кнопке -->
            <UButton
              v-if="worldPort"
              :icon="assetBrowserIcon"
              size="xs"
              color="neutral"
              variant="ghost"
              class="self-start"
              :label="CONDITION_FORM_LABELS.pickFromWorld"
              @click.left.exact.prevent="
                isAssetBrowserOpen = !isAssetBrowserOpen
              "
            />

            <div
              v-if="worldPort && isAssetBrowserOpen"
              class="max-h-60 overflow-y-auto rounded-lg border border-default/50"
            >
              <!-- Своя модель, а не `image`: в поле значка может лежать картинка
                   ПРИЛОЖЕНИЯ (у канонных состояний это `/assets/status/…`), а
                   файловый менеджер ходит по файлам МИРА — открыть такую папку он
                   не может и падал бы на 404 при каждом открытии формы канона -->
              <AssetBrowser
                v-model="pickedAsset"
                :world-port="worldPort"
              />
            </div>
          </div>
        </UFormField>

        <!-- Описание -->
        <UFormField :label="CONDITION_FORM_LABELS.description">
          <RichTextEditor v-model="description" />
        </UFormField>

        <!-- Значок поверх фишки -->
        <div
          class="flex items-center justify-between rounded-lg border border-default/50 bg-elevated/30 p-3"
        >
          <div class="space-y-0.5 pr-3">
            <span class="text-sm font-medium text-toned">
              {{ CONDITION_FORM_LABELS.overlay }}
            </span>

            <p class="text-xs text-dimmed">
              {{ CONDITION_FORM_LABELS.overlayHint }}
            </p>
          </div>

          <USwitch v-model="overlay" />
        </div>

        <!-- Эффект -->
        <div class="rounded-lg border border-default/50 bg-elevated/30 p-3">
          <div class="flex items-center justify-between gap-3">
            <span class="text-sm font-medium text-toned">
              {{ CONDITION_FORM_LABELS.effect }}
            </span>

            <div
              v-if="!isTemplateLocked"
              class="flex items-center gap-2"
            >
              <UButton
                icon="tabler:sparkles"
                size="xs"
                color="primary"
                variant="soft"
                :label="CONDITION_FORM_LABELS.editEffect"
                @click.left.exact.prevent="openEffectForm"
              />

              <UButton
                v-if="effect"
                icon="tabler:trash"
                size="xs"
                color="neutral"
                variant="ghost"
                :label="CONDITION_FORM_LABELS.clearEffect"
                @click.left.exact.prevent="clearEffect"
              />
            </div>
          </div>

          <p
            v-if="isTemplateLocked"
            class="mt-1.5 text-xs text-dimmed"
          >
            {{ CONDITION_FORM_LABELS.lockedTemplateHint }}
          </p>

          <p
            v-else-if="effectSummary"
            class="mt-1.5 text-xs text-muted"
          >
            {{ effectSummary }}
          </p>

          <p
            v-else
            class="mt-1.5 text-xs text-dimmed"
          >
            {{ CONDITION_FORM_LABELS.noEffect }}
          </p>

          <p
            v-if="!isTemplateLocked"
            class="mt-1.5 text-xs text-dimmed italic"
          >
            {{ CONDITION_FORM_LABELS.effectHint }}
          </p>
        </div>

        <!-- Сброс правки канона -->
        <div
          v-if="hasSavedOverride"
          class="flex items-center justify-between gap-3 rounded-lg border border-warning/40 bg-warning/5 p-3"
        >
          <p class="text-xs text-muted">
            {{ CONDITION_FORM_LABELS.resetHint }}
          </p>

          <UButton
            icon="tabler:rotate"
            size="xs"
            color="warning"
            variant="soft"
            :label="CONDITION_FORM_LABELS.resetToCanon"
            @click.left.exact.prevent="resetToCanon"
          />
        </div>

        <!-- Кнопки -->
        <div class="flex justify-end gap-2">
          <UButton
            :label="MODAL_BUTTON_LABELS.cancel"
            color="neutral"
            variant="ghost"
            @click.left.exact.prevent="emit('close')"
          />

          <UButton
            :label="submitLabel"
            color="primary"
            :disabled="!canSave"
            @click.left.exact.prevent="handleSave"
          />
        </div>
      </div>
    </template>
  </UDraggableModal>

  <!-- Редактор эффекта состояния -->
  <ActiveEffectFormModal
    v-model:open="isEffectModalOpen"
    :modal-id="CONDITION_EFFECT_MODAL_ID"
    :z-index="effectModalZIndex"
    :effect="effect ?? undefined"
    hide-aura
    hide-condition-preset
    @save="saveEffect"
  />
</template>
