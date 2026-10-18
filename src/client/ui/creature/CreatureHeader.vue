<script setup lang="ts">
  import type { CreatureSystem, DnDCreature } from '@vtt/shared/system/dnd.js';

  import type { NameEditResult } from '../actor/NameEditModal.vue';
  import type { CreatureKindResult } from './CreatureKindModal.vue';

  import { computed, reactive } from 'vue';

  import { useImageFallback } from '@/shared_ui/composables';
  import {
    getTokenTransformStyle,
    handleImageError,
  } from '@/shared_ui/utils/domUtils';
  import { getAssetUrl } from '@vtt/shared';
  import { CR_OPTIONS, getAlignmentLabel } from '@vtt/shared/system/dnd.js';

  import { resolveSheetPopOutButton } from '../../composables/useSheetMinimize';
  import {
    CREATURE_SIZE_LABELS,
    CREATURE_TYPE_LABELS,
    EDIT_MODE_TOGGLE_TITLE,
    HEADER_ROUND_BUTTON_CLASS,
    MODAL_BUTTON_LABELS,
    NAME_EDIT_LABELS,
    REST_LABELS,
    SHEET_HEADER_CLASSES,
    SHEET_INLINE_EDITABLE_CLASS,
  } from '../actor/constants';
  import NameEditModal from '../actor/NameEditModal.vue';
  import {
    CREATURE_HEADER_LABELS,
    CREATURE_ICON,
    CREATURE_NO_ALIGNMENT,
  } from './constants';
  import CreatureChallengeModal from './CreatureChallengeModal.vue';
  import CreatureKindModal from './CreatureKindModal.vue';

  interface Props {
    creature: DnDCreature;
    isEditMode: boolean;
    isCreating?: boolean;
    canEdit?: boolean;
    worldPort?: number;
    /** Показывать ли кнопку выноса листа в отдельное окно */
    canPopOut?: boolean;
    /** Вынесен ли лист в отдельное окно браузера */
    isPoppedOut?: boolean;
  }

  const props = withDefaults(defineProps<Props>(), {
    isCreating: false,
    canEdit: true,
    canPopOut: false,
    isPoppedOut: false,
    worldPort: undefined,
  });

  const emit = defineEmits<{
    'update': [updates: Partial<DnDCreature>];
    'update:system': [updates: Partial<CreatureSystem>];
    'toggle-edit-mode': [];
    'open-settings': [];
    'short-rest': [];
    'long-rest': [];
    'close': [];
    /** Свернуть лист в шторку — окно остаётся открытым */
    'minimize': [];
    /** Вынести лист в отдельное окно браузера или вернуть на стол */
    'toggle-pop-out': [];
    'save': [];
  }>();

  /** Подпись и иконка кнопки выноса: вынести лист или вернуть его на стол */
  const popOutButton = computed(() =>
    resolveSheetPopOutButton(props.isPoppedOut),
  );

  // Вычисляемые свойства для аватара/токена
  const tokenFrame = computed(() => {
    const frameUrl = props.creature.token?.frameUrl;

    if (!frameUrl) {
      return null;
    }

    return getAssetUrl(frameUrl, props.worldPort);
  });

  const tokenImageStyle = computed(() =>
    getTokenTransformStyle(props.creature.token),
  );

  // Показ картинки токена с фолбэком на иконку при пустом/битом пути
  const { showImage: showTokenImage, handleImageError: onTokenImageError } =
    useImageFallback(() => props.creature.token?.imageUrl);

  /** Название в шапке: у безымянного листа — заглушка, иначе нажимать не на что */
  const displayName = computed(
    () => props.creature.name || NAME_EDIT_LABELS.emptyName,
  );

  /** Правится ли шапка: только при снятом замке и правах на лист */
  const isHeaderEditable = computed(() => props.isEditMode && props.canEdit);

  /** Тег правимого значения: в режиме правки — кнопка, открывающая своё окно */
  const editableTag = computed(() =>
    isHeaderEditable.value ? 'button' : 'span',
  );

  /**
   * Классы названия. Пунктир и подсветка при наведении показывают, что оно
   * правится, не сдвигая при этом ни само название, ни шапку под ним.
   */
  const nameClass = computed(() =>
    isHeaderEditable.value
      ? `${SHEET_INLINE_EDITABLE_CLASS} underline-offset-8`
      : '',
  );

  /** Классы мелких строк шапки: вида существа и уровня опасности */
  const rowClass = computed(() =>
    isHeaderEditable.value
      ? `${SHEET_INLINE_EDITABLE_CLASS} underline-offset-4`
      : '',
  );

  /**
   * Подсказка правимого значения. Вне режима правки её нет: окно по нажатию
   * тогда не открывается, и обещать правку нечем.
   *
   * @param hint - подсказка значения в режиме правки
   * @returns подсказка либо ничего
   */
  function editableTitle(hint: string): string | undefined {
    return isHeaderEditable.value ? hint : undefined;
  }

  /**
   * Открытые окна шапки: у каждого правимого значения своё. Одним объектом —
   * чтобы открывались они одной функцией, а не тремя одинаковыми.
   */
  const openEditors = reactive({
    name: false,
    kind: false,
    challenge: false,
  });

  /** Открывает окно правки (вне режима правки шапка только показывает данные) */
  function openEditor(editor: keyof typeof openEditors): void {
    if (!isHeaderEditable.value) {
      return;
    }

    openEditors[editor] = true;
  }

  /**
   * Записывает названия из окна на лист. Русское и английское уходят одной
   * правкой: в окне они правятся вместе, и раздельные обновления перетирали бы
   * друг друга на общем объекте существа.
   */
  function onNameApply(result: NameEditResult) {
    emit('update', { name: result.name, nameEn: result.nameEn });
  }

  /** Записывает размер, вид и мировоззрение из окна на лист */
  function onKindApply(result: CreatureKindResult) {
    emit('update:system', {
      size: result.size,
      type: result.type,
      alignment: result.alignment,
    });
  }

  /** Записывает уровень опасности из окна на лист */
  function onChallengeApply(challengeRating: string) {
    emit('update:system', { challengeRating });
  }

  /**
   * Возвращает скрытый экземпляр существа в список бестиария: снимает флаг
   * isInstance, после чего копия перестаёт быть «эфемерной» (не удалится при
   * удалении токена) и снова показывается в списке существ.
   */
  function restoreInstanceToList(): void {
    emit('update', { isInstance: false });
  }

  const sizeLabel = computed(() => {
    return CREATURE_SIZE_LABELS[props.creature.system.size];
  });

  const typeLabel = computed(() => {
    return CREATURE_TYPE_LABELS[props.creature.system.type];
  });

  /** Мировоззрение: локализация, а без неё — сырой ключ либо пометка «нет» */
  const alignmentLabel = computed(
    () =>
      getAlignmentLabel(props.creature.system.alignment)
      || props.creature.system.alignment
      || CREATURE_NO_ALIGNMENT,
  );

  const challengeRatingLabel = computed(() => {
    const crValue = props.creature.system.challengeRating;
    const option = CR_OPTIONS.find((opt) => opt.value === crValue);

    return option ? option.label : crValue;
  });
</script>

<template>
  <header
    :class="SHEET_HEADER_CLASSES.root"
    :style="{ cursor: canEdit ? 'move' : 'default', userSelect: 'none' }"
  >
    <div :class="SHEET_HEADER_CLASSES.body">
      <!-- Аватар и Рамка -->
      <div :class="SHEET_HEADER_CLASSES.avatar">
        <div
          class="relative h-full w-full bg-elevated"
          style="clip-path: circle(44% at 50% 50%); overflow: hidden"
        >
          <img
            v-if="showTokenImage"
            :src="getAssetUrl(creature.token?.imageUrl, worldPort) || undefined"
            :alt="creature.name"
            class="absolute inset-0 h-full w-full max-w-none object-contain transition-none select-none"
            :style="tokenImageStyle"
            draggable="false"
            @error="onTokenImageError"
          />

          <div
            v-else
            class="absolute inset-0 flex items-center justify-center text-dimmed"
          >
            <UIcon
              :name="CREATURE_ICON"
              class="h-1/2 w-1/2"
            />
          </div>
        </div>

        <img
          v-if="tokenFrame"
          :src="tokenFrame"
          alt="Token frame"
          class="pointer-events-none absolute inset-0 h-full w-full object-contain drop-shadow-xl select-none"
          draggable="false"
          @error="handleImageError"
        />
      </div>

      <!-- Основная информация -->
      <div :class="SHEET_HEADER_CLASSES.info">
        <!-- Имя: в режиме правки подчёркнуто пунктиром и открывает окно -->
        <div :class="SHEET_HEADER_CLASSES.nameRow">
          <h2 :class="SHEET_HEADER_CLASSES.name">
            <component
              :is="editableTag"
              :class="nameClass"
              :title="editableTitle(NAME_EDIT_LABELS.editHint)"
              @click.left.exact.prevent="openEditor('name')"
            >
              {{ displayName }}
              <span
                v-if="creature.nameEn"
                class="text-xl text-muted @2xl:text-2xl"
              >
                / {{ creature.nameEn }}
              </span>
            </component>
          </h2>
        </div>

        <!-- Размер, вид и мировоззрение: в правке открывают своё окно -->
        <div
          class="flex min-h-7 flex-wrap items-center justify-center text-center text-toned @2xl:justify-start @2xl:text-left"
        >
          <component
            :is="editableTag"
            :class="rowClass"
            :title="editableTitle(CREATURE_HEADER_LABELS.editKind)"
            @click.left.exact.prevent="openEditor('kind')"
          >
            <span class="text-toned">{{ sizeLabel }}</span>

            <span class="mx-2 text-dimmed">—</span>

            <span class="text-toned">{{ typeLabel }}</span>

            <span class="mx-2 text-dimmed">—</span>

            <span class="text-toned">{{ alignmentLabel }}</span>
          </component>
        </div>

        <!-- Уровень опасности: в правке открывает своё окно -->
        <div
          class="flex items-center justify-center gap-2 pt-1 text-xs font-medium text-muted @2xl:justify-start"
        >
          <div class="whitespace-nowrap">
            {{ CREATURE_HEADER_LABELS.challengeRating }}
          </div>

          <div class="flex items-center whitespace-nowrap">
            <component
              :is="editableTag"
              class="font-bold text-highlighted"
              :class="rowClass"
              :title="editableTitle(CREATURE_HEADER_LABELS.editChallengeRating)"
              @click.left.exact.prevent="openEditor('challenge')"
            >
              {{ challengeRatingLabel }}
            </component>
          </div>
        </div>
      </div>

      <!-- Кнопки шапки: на узкой — верхним рядом, на широкой — по углам -->
      <div :class="SHEET_HEADER_CLASSES.actions">
        <!-- Кнопки отдыха (на широкой шапке — у золотой линии) -->
        <div
          v-if="canEdit && !isCreating"
          :class="SHEET_HEADER_CLASSES.rest"
        >
          <UTooltip :text="REST_LABELS.short">
            <UButton
              icon="tabler:campfire"
              color="neutral"
              variant="ghost"
              size="md"
              square
              class="border border-default/50 bg-elevated/30 text-muted hover:bg-accented/50 hover:text-highlighted"
              @click.left.exact.prevent="emit('short-rest')"
            />
          </UTooltip>

          <UTooltip :text="REST_LABELS.long">
            <UButton
              icon="tabler:moon"
              color="neutral"
              variant="ghost"
              size="md"
              square
              class="border border-default/50 bg-elevated/30 text-muted hover:bg-accented/50 hover:text-highlighted"
              @click.left.exact.prevent="emit('long-rest')"
            />
          </UTooltip>
        </div>

        <!-- Кнопки управления (правый верхний угол) -->
        <div :class="SHEET_HEADER_CLASSES.controls">
          <!-- Кнопка Создать (только при создании нового существа) -->
          <button
            v-if="isCreating"
            class="flex h-8 items-center gap-1.5 rounded-full border border-success/50 bg-success/80 px-3 text-sm font-medium text-highlighted transition-colors hover:bg-success/70"
            :title="CREATURE_HEADER_LABELS.create"
            @click.left.exact.prevent="emit('save')"
          >
            <UIcon
              name="tabler:check"
              class="h-4 w-4"
            />
            {{ MODAL_BUTTON_LABELS.create }}
          </button>

          <!-- Toggle Edit Mode -->
          <button
            v-else-if="canEdit"
            class="flex h-8 w-8 items-center justify-center rounded-full border border-default/50 bg-elevated/30 transition-colors hover:bg-accented/50"
            :class="
              isEditMode ? 'text-primary' : 'text-muted hover:text-highlighted'
            "
            :title="EDIT_MODE_TOGGLE_TITLE"
            @click.left.exact.prevent="emit('toggle-edit-mode')"
          >
            <UIcon
              :name="isEditMode ? 'tabler:lock-open' : 'tabler:lock-filled'"
              class="h-4 w-4"
            />
          </button>

          <!-- Вернуть скрытый экземпляр в список существ -->
          <button
            v-if="canEdit && !isCreating && creature.isInstance"
            :class="HEADER_ROUND_BUTTON_CLASS"
            :title="CREATURE_HEADER_LABELS.backToList"
            @click.left.exact.prevent="restoreInstanceToList"
          >
            <UIcon
              name="tabler:list-search"
              class="h-4 w-4"
            />
          </button>

          <!-- Settings Button -->
          <button
            v-if="canEdit && !isCreating"
            :class="HEADER_ROUND_BUTTON_CLASS"
            :title="CREATURE_HEADER_LABELS.tokenSettings"
            @click.left.exact.prevent="emit('open-settings')"
          >
            <UIcon
              name="tabler:settings-filled"
              class="h-4 w-4"
            />
          </button>

          <!-- Вынести в отдельное окно / вернуть на стол -->
          <button
            v-if="canPopOut"
            :class="HEADER_ROUND_BUTTON_CLASS"
            :title="popOutButton.label"
            @click.left.exact.prevent="emit('toggle-pop-out')"
          >
            <UIcon
              :name="popOutButton.icon"
              class="h-4 w-4"
            />
          </button>

          <!-- Minimize Button: вынесенный лист сворачивает сам браузер -->
          <button
            v-if="!isPoppedOut"
            :class="HEADER_ROUND_BUTTON_CLASS"
            :title="MODAL_BUTTON_LABELS.minimize"
            @click.left.exact.prevent="emit('minimize')"
          >
            <UIcon
              name="tabler:chevron-up"
              class="h-5 w-5"
            />
          </button>

          <!-- Close Button -->
          <button
            :class="HEADER_ROUND_BUTTON_CLASS"
            :title="MODAL_BUTTON_LABELS.close"
            @click.left.exact.prevent="emit('close')"
          >
            <UIcon
              name="tabler:x"
              class="h-5 w-5"
            />
          </button>
        </div>
      </div>
    </div>

    <!-- Декоративный разделитель шапки: цвет акцента приложения -->
    <div class="absolute bottom-0 left-0 mb-1 flex w-full items-center gap-3">
      <div class="h-px flex-1 bg-primary/50" />

      <div class="h-3 w-3 rotate-45 border border-primary opacity-80" />

      <div class="h-px flex-1 bg-primary/50" />
    </div>
  </header>

  <!-- Окно названия: русское и английское названия правятся вместе -->
  <NameEditModal
    v-model:open="openEditors.name"
    :title="NAME_EDIT_LABELS.creatureTitle"
    :name="creature.name"
    :name-en="creature.nameEn"
    :with-name-en="true"
    :name-placeholder="CREATURE_HEADER_LABELS.namePlaceholder"
    @apply="onNameApply"
  />

  <!-- Окно размера, вида и мировоззрения -->
  <CreatureKindModal
    v-model:open="openEditors.kind"
    :size="creature.system.size"
    :creature-type="creature.system.type"
    :alignment="creature.system.alignment"
    @apply="onKindApply"
  />

  <!-- Окно уровня опасности -->
  <CreatureChallengeModal
    v-model:open="openEditors.challenge"
    :challenge-rating="creature.system.challengeRating"
    @apply="onChallengeApply"
  />
</template>
