<script setup lang="ts">
  import type { LightEmitter, TypedWebSocketClient } from '@vtt/shared';
  import type { DnDCreature, HpDisplayMode } from '@vtt/shared/system/dnd.js';

  import { useToast } from '@nuxt/ui/composables';
  import { computed, onMounted, ref, watch } from 'vue';

  import {
    DEFAULT_TOKEN_FRAME_URL,
    TOKEN_DARKVISION_DEFAULT,
    TOKEN_DARKVISION_MIN,
    TOKEN_DARKVISION_STEP,
    TOKEN_SCALE_DEFAULT,
    TOKEN_SIZE_OPTIONS,
    TOKEN_VISION_RANGE_DEFAULT,
    TOKEN_VISION_RANGE_MIN,
    TOKEN_VISION_RANGE_STEP,
  } from '@/core/tokenConsts';
  import AssetBrowser from '@/shared_ui/components/AssetBrowser.vue';
  import LightEmitterEditor from '@/shared_ui/components/LightEmitterEditor.vue';
  import TokenMediaPreview from '@/shared_ui/components/TokenMediaPreview.vue';
  import UDraggableModal from '@/shared_ui/components/UDraggableModal.vue';
  import { useImageFallback } from '@/shared_ui/composables';
  import { useWorldStore } from '@/stores/worldStore';
  import { createDefaultLightEmitter, getServerBaseUrl } from '@vtt/shared';
  import {
    CREATURE_CATEGORIES,
    CREATURE_SIZE_LABELS,
    getAlignmentLabel,
    resolveCreatureTokenScale,
    TOKEN_SCALE_TO_CREATURE_SIZE,
  } from '@vtt/shared/system/dnd.js';

  import {
    TOKEN_TINT_DEFAULT,
    useTokenPreview,
  } from '../../composables/useTokenPreview';
  import {
    clampVisionAngle,
    MODAL_BUTTON_LABELS,
    TOAST_TITLES,
    TOKEN_IMAGE_ROTATION_DEFAULT,
    TOKEN_IMAGE_ROTATION_MAX,
    TOKEN_IMAGE_ROTATION_MIN,
    TOKEN_IMAGE_ROTATION_STEP,
    TOKEN_SETTINGS_LABELS,
    TOKEN_VISION_ANGLE_DEFAULT,
    TOKEN_VISION_ANGLE_MAX,
    TOKEN_VISION_ANGLE_MIN,
    TOKEN_VISION_ANGLE_PRESETS,
    TOKEN_VISION_ANGLE_STEP,
  } from '../actor/constants';
  import { CREATURE_NO_ALIGNMENT, CREATURE_SETTINGS_LABELS } from './constants';
  import CreatureDeleteConfirmModal from './CreatureDeleteConfirmModal.vue';

  interface Props {
    open: boolean;
    zIndex?: number;
    modalId?: string;
    creatureId?: string;
    creatureData?: DnDCreature;
    onSave?: (updates: Partial<DnDCreature>) => void;
    onDelete?: () => void;
    isAdmin?: boolean;
    users?: Array<{ id: string; username: string; role: string }>;
    socket?: TypedWebSocketClient | null;
    worldPort?: number;
    worldId?: string;
    savedPosition?: { x: number; y: number };
    savedSize?: { width: number; height: number };
  }

  const props = defineProps<Props>();

  const emit = defineEmits<{
    'update:open': [value: boolean];
    'close': [];
    'bring-to-front': [];
  }>();

  const worldStore = useWorldStore();
  const toast = useToast();

  /** Путь к папке существа в проводнике файлов (data/creatures/<id>) */
  const creatureFolderPath = computed(() => {
    const entityId = props.creatureId || props.creatureData?.id;

    if (!entityId) {
      return '';
    }

    return `data/creatures/${entityId}`;
  });

  const currentWorld = computed(() => {
    if (props.worldId) {
      return worldStore.getWorldById(props.worldId);
    }

    if (worldStore.connectionState.currentWorldId) {
      return worldStore.getWorldById(worldStore.connectionState.currentWorldId);
    }

    return (
      worldStore.worlds.find((world) => world.isRunning) || worldStore.worlds[0]
    );
  });

  const isSaving = ref(false);
  const autoSaves = ref(true);
  const selectedOwner = ref<string | undefined>(undefined);
  const isPublic = ref(false);

  const currentUser = computed(() => {
    if (!currentWorld.value || !worldStore.connectionState.loggedAsUserId) {
      return null;
    }

    return currentWorld.value.users.find(
      (user) => user.id === worldStore.connectionState.loggedAsUserId,
    );
  });

  const userOptions = computed(() => {
    let users: Array<{ id: string; username: string; role: string }> | null =
      null;

    if (props.users && props.users.length > 0) {
      users = props.users;
    } else if (
      currentWorld.value?.users
      && currentWorld.value.users.length > 0
    ) {
      users = currentWorld.value.users;
    }

    if (!users) {
      return [{ value: undefined, label: TOKEN_SETTINGS_LABELS.ownerNone }];
    }

    const mappedUsers = users.map((user) => ({
      value: user.id,
      label: `${user.username} (${
        user.role === 'admin'
          ? TOKEN_SETTINGS_LABELS.roleGm
          : TOKEN_SETTINGS_LABELS.rolePlayer
      })`,
    }));

    return [
      { value: undefined, label: TOKEN_SETTINGS_LABELS.ownerNone },
      ...mappedUsers,
    ];
  });

  function getOwnerName(userId?: string) {
    if (!userId) {
      return TOKEN_SETTINGS_LABELS.ownerNone;
    }

    const entry = currentWorld.value?.users.find(
      (worldUser) => worldUser.id === userId,
    );

    return entry ? entry.username : TOKEN_SETTINGS_LABELS.ownerUnknown;
  }

  // Настройки токена
  type Disposition = 'friendly' | 'neutral' | 'hostile';

  interface TokenSettingsLocal {
    imageUrl: string;
    frameUrl: string;
    scale: number;
    textureScale: number;
    textureX: number;
    textureY: number;
    rotation: number;
    tint: string;
    disposition: Disposition;
    showName: boolean;
    hpDisplayMode: HpDisplayMode;
  }

  const tokenSettings = ref<TokenSettingsLocal>({
    imageUrl: '',
    frameUrl: '',
    scale: TOKEN_SCALE_DEFAULT,
    textureScale: 1,
    textureX: 0.5,
    textureY: 0.5,
    rotation: 0,
    tint: TOKEN_TINT_DEFAULT,
    disposition: 'hostile',
    showName: false,
    hpDisplayMode: 'text',
  });

  const showFrame = ref(true);

  // Настройки зрения
  const visionSettings = ref({
    enabled: false,
    range: TOKEN_VISION_RANGE_DEFAULT,
    darkvision: TOKEN_DARKVISION_DEFAULT,
    angle: TOKEN_VISION_ANGLE_DEFAULT,
  });

  // Настройки света токена (тот же механизм, что у источников света)
  const lightSettings = ref<LightEmitter>(createDefaultLightEmitter());

  // Computed
  const isOpen = computed({
    get: () => props.open,
    set: (value) => emit('update:open', value),
  });

  const isAdmin = computed(() => {
    if (props.isAdmin === true) {
      return true;
    }

    return worldStore.isGM;
  });

  const isDeleteConfirmOpen = ref(false);

  const creature = computed(() => {
    return props.creatureData ?? null;
  });

  watch(
    () => creature.value,
    (newCreature, oldCreature) => {
      // Если актера удалили, закрываем модалку
      if (oldCreature && !newCreature) {
        isOpen.value = false;
        emit('close');
      }
    },
  );

  const isOwner = computed(() => {
    if (!creature.value || !currentUser.value) {
      return false;
    }

    // Существо передано игроку под контроль (ownerId совпадает)
    return creature.value.ownerId === currentUser.value.id;
  });

  // Может ли текущий пользователь редактировать токен
  const canEditToken = computed(() => isAdmin.value || isOwner.value);

  /** Подпись угла обзора: полный круг называем словом, а не числом */
  const visionAngleLabel = computed(() =>
    visionSettings.value.angle >= TOKEN_VISION_ANGLE_MAX
      ? TOKEN_SETTINGS_LABELS.visionAngleFull
      : `${visionSettings.value.angle}°`,
  );

  /**
   * Обрезает введённый вручную угол обзора по границам.
   *
   * Делается по потере фокуса, а не на каждый символ: иначе набор «130»
   * схлопывался бы в минимум сразу после первой цифры.
   */
  function normalizeVisionAngle(): void {
    visionSettings.value.angle = clampVisionAngle(visionSettings.value.angle);
  }

  /**
   * Цвет кнопки-предустановки угла обзора.
   *
   * Вынесено из шаблона: в `v-for` computed не принимает аргумент, а тернарники
   * классов прямо в разметке правилами проекта запрещены.
   *
   * @param preset - угол предустановки в градусах
   * @returns цвет кнопки Nuxt UI
   */
  function getVisionAnglePresetColor(preset: number): 'primary' | 'neutral' {
    return visionSettings.value.angle === preset ? 'primary' : 'neutral';
  }

  /**
   * Вариант отрисовки кнопки-предустановки угла обзора.
   *
   * @param preset - угол предустановки в градусах
   * @returns вариант кнопки Nuxt UI
   */
  function getVisionAnglePresetVariant(preset: number): 'solid' | 'subtle' {
    return visionSettings.value.angle === preset ? 'solid' : 'subtle';
  }

  // Превью токена: размер, стиль изображения, перетаскивание и зум
  const {
    previewTokenSize,
    tokenImageStyle,
    handleTokenMouseDown,
    handleTokenWheel,
  } = useTokenPreview(tokenSettings, canEditToken);

  // Вкладки
  const tabs = [
    {
      key: 'general',
      label: TOKEN_SETTINGS_LABELS.tabGeneral,
      icon: 'tabler:settings-filled',
      slot: 'general',
    },
    {
      key: 'token',
      label: TOKEN_SETTINGS_LABELS.tabToken,
      icon: 'tabler:photo',
      slot: 'token',
    },
    {
      key: 'vision',
      label: TOKEN_SETTINGS_LABELS.tabVision,
      icon: 'tabler:eye',
      slot: 'vision',
    },
    {
      key: 'light',
      label: TOKEN_SETTINGS_LABELS.tabLighting,
      icon: 'tabler:bulb',
      slot: 'light',
    },
  ];

  const hasChanges = computed(() => {
    if (!creature.value) {
      return false;
    }

    const tokenChanged =
      tokenSettings.value.imageUrl !== (creature.value.token?.imageUrl || '')
      || tokenSettings.value.frameUrl !== (creature.value.token?.frameUrl || '')
      || tokenSettings.value.scale !== resolveCreatureTokenScale(creature.value)
      || tokenSettings.value.textureScale
        !== (creature.value.token?.textureScale ?? 1)
      || tokenSettings.value.textureX
        !== (creature.value.token?.textureX ?? 0.5)
      || tokenSettings.value.textureY
        !== (creature.value.token?.textureY ?? 0.5)
      || tokenSettings.value.rotation !== (creature.value.token?.rotation ?? 0)
      || tokenSettings.value.tint
        !== (creature.value.token?.tint || TOKEN_TINT_DEFAULT)
      || tokenSettings.value.disposition
        !== (creature.value.token?.disposition || 'hostile')
      || tokenSettings.value.showName
        !== (creature.value.token?.showName ?? false)
      || tokenSettings.value.hpDisplayMode
        !== (creature.value.token?.hpDisplayMode ?? 'text');

    const visionChanged =
      visionSettings.value.enabled
        !== (creature.value.token?.vision?.enabled || false)
      || visionSettings.value.range
        !== (creature.value.token?.vision?.range ?? TOKEN_VISION_RANGE_DEFAULT)
      || visionSettings.value.darkvision
        !== (creature.value.token?.vision?.darkvision
          ?? TOKEN_DARKVISION_DEFAULT)
      || visionSettings.value.angle
        !== (creature.value.token?.vision?.angle ?? TOKEN_VISION_ANGLE_DEFAULT);

    const autoSavesChanged =
      autoSaves.value !== (creature.value.autoSaves ?? true);

    const ownerChanged = selectedOwner.value !== creature.value.ownerId;
    const publicChanged = isPublic.value !== (creature.value.isPublic || false);

    const lightChanged =
      JSON.stringify(lightSettings.value)
      !== JSON.stringify(
        creature.value.token?.light ?? createDefaultLightEmitter(),
      );

    return (
      tokenChanged
      || visionChanged
      || autoSavesChanged
      || ownerChanged
      || publicChanged
      || lightChanged
    );
  });

  // Methods
  const PUBLIC_PREFIX_REGEX = /^public\//;

  function getAssetUrl(url: string) {
    if (!url) {
      return '';
    }

    if (
      url.startsWith('http://')
      || url.startsWith('https://')
      || url.startsWith('blob:')
      || url.startsWith('data:')
    ) {
      return url;
    }

    if (url.includes('token-frames/')) {
      const withoutLeadingSlash = url.startsWith('/') ? url.slice(1) : url;
      const cleanUrl = withoutLeadingSlash.replace(PUBLIC_PREFIX_REGEX, '');

      const framePath = cleanUrl.startsWith('assets/')
        ? cleanUrl
        : `assets/${cleanUrl}`;

      return `/${framePath}`;
    }

    const port = currentWorld.value?.port || props.worldPort;

    if (port) {
      let cleanUrl = url.startsWith('/') ? url.slice(1) : url;

      if (cleanUrl.startsWith('public/')) {
        cleanUrl = cleanUrl.replace('public/', 'world-assets/');

        return `${getServerBaseUrl(port)}/${cleanUrl}`;
      }

      // Голые имена файлов из корня мира — раздаются через /world/
      return `${getServerBaseUrl(port)}/world/${cleanUrl}`;
    }

    // Fallback без порта
    if (url.startsWith('public/')) {
      return `/world-assets/${url.slice('public/'.length)}`;
    }

    return `/world/${url}`;
  }

  function toggleFrame() {
    if (showFrame.value) {
      tokenSettings.value.frameUrl = DEFAULT_TOKEN_FRAME_URL;
    } else {
      tokenSettings.value.frameUrl = '';
    }
  }

  // Превью токена: показывать картинку, пока путь непустой и загрузка не упала
  const { showImage: showTokenImage, handleImageError: onTokenImageError } =
    useImageFallback(() => tokenSettings.value.imageUrl);

  function initData() {
    if (creature.value) {
      tokenSettings.value = {
        imageUrl: creature.value.token?.imageUrl || '',
        frameUrl: creature.value.token?.frameUrl || '',
        scale: resolveCreatureTokenScale(creature.value),
        textureScale: creature.value.token?.textureScale ?? 1,
        textureX: creature.value.token?.textureX ?? 0.5,
        textureY: creature.value.token?.textureY ?? 0.5,
        rotation: creature.value.token?.rotation ?? 0,
        tint: creature.value.token?.tint || TOKEN_TINT_DEFAULT,
        disposition: creature.value.token?.disposition || 'hostile',
        showName: creature.value.token?.showName ?? false,
        hpDisplayMode: creature.value.token?.hpDisplayMode ?? 'text',
      };

      if (tokenSettings.value.frameUrl) {
        showFrame.value = true;
      } else {
        showFrame.value = false;
      }

      visionSettings.value = {
        enabled: creature.value.token?.vision?.enabled || false,
        range:
          creature.value.token?.vision?.range ?? TOKEN_VISION_RANGE_DEFAULT,
        darkvision:
          creature.value.token?.vision?.darkvision ?? TOKEN_DARKVISION_DEFAULT,
        angle:
          creature.value.token?.vision?.angle ?? TOKEN_VISION_ANGLE_DEFAULT,
      };

      lightSettings.value = creature.value.token?.light
        ? { ...creature.value.token.light }
        : createDefaultLightEmitter();

      autoSaves.value = creature.value.autoSaves ?? true;
      selectedOwner.value = creature.value.ownerId;
      isPublic.value = creature.value.isPublic || false;
    }
  }

  function saveSettings() {
    if (!creature.value) {
      return;
    }

    isSaving.value = true;

    try {
      const updatedToken = {
        ...creature.value.token,
        imageUrl: tokenSettings.value.imageUrl,
        frameUrl: tokenSettings.value.frameUrl,
        scale: tokenSettings.value.scale,
        textureScale: tokenSettings.value.textureScale,
        textureX: tokenSettings.value.textureX,
        textureY: tokenSettings.value.textureY,
        rotation: tokenSettings.value.rotation,
        tint: tokenSettings.value.tint,
        disposition: tokenSettings.value.disposition,
        showName: tokenSettings.value.showName,
        hpDisplayMode: tokenSettings.value.hpDisplayMode,
        vision: {
          enabled: visionSettings.value.enabled,
          range: visionSettings.value.range,
          darkvision: visionSettings.value.darkvision,
          angle: visionSettings.value.angle,
        },
        light: { ...lightSettings.value },
      };

      // Синхронизация размера существа с масштабом токена. Произвольный
      // масштаб (токен растянут на сцене вручную) в таблицу не попадает —
      // тогда оставляем размер существа как есть, а не понижаем до среднего.
      const updatedSystem = {
        ...creature.value.system,
        size:
          TOKEN_SCALE_TO_CREATURE_SIZE[tokenSettings.value.scale]
          ?? creature.value.system.size,
      };

      if (props.onSave) {
        props.onSave({
          token: updatedToken,
          system: updatedSystem,
          autoSaves: autoSaves.value,
          // Владельца меняет только ГМ
          ...(isAdmin.value
            ? { ownerId: selectedOwner.value, isPublic: isPublic.value }
            : {}),
        });
      }

      toast.add({
        title: TOKEN_SETTINGS_LABELS.savedTitle,
        description: isAdmin.value
          ? `${TOKEN_SETTINGS_LABELS.savedOwnerPrefix}${getOwnerName(
              selectedOwner.value,
            )}`
          : CREATURE_SETTINGS_LABELS.savedForPlayer,
        color: 'success',
      });

      isOpen.value = false;
    } catch (error) {
      console.error(error);

      toast.add({
        title: TOAST_TITLES.error,
        description: TOKEN_SETTINGS_LABELS.errorSave,
        color: 'error',
      });
    } finally {
      isSaving.value = false;
    }
  }

  /**
   * Вызывается после успешного удаления персонажа через CreatureDeleteConfirmModal
   */
  function handleCreatureDeleted(): void {
    isOpen.value = false;

    if (props.onDelete) {
      props.onDelete();
    }
  }

  watch(
    () => props.open,
    (val) => {
      if (val) {
        initData();
      }
    },
  );

  onMounted(() => {
    if (props.open) {
      initData();
    }
  });

  /** Классы для кнопки режима отображения ХП */
  const HP_MODE_ACTIVE_CLASS =
    'border-primary/50 bg-primary/10 text-highlighted';

  const HP_MODE_INACTIVE_CLASS =
    'border-default/50 bg-elevated/20 text-toned hover:bg-elevated/40';

  /** Классы для кнопки размера токена */
  const TOKEN_SIZE_ACTIVE_CLASS = 'border-primary bg-primary/20 text-primary';

  const TOKEN_SIZE_INACTIVE_CLASS =
    'border-default/50 bg-elevated/30 text-muted hover:border-accented hover:text-toned';

  const hpBarModeClass = computed(() =>
    tokenSettings.value.hpDisplayMode === 'bar'
      ? HP_MODE_ACTIVE_CLASS
      : HP_MODE_INACTIVE_CLASS,
  );

  const hpTextModeClass = computed(() =>
    tokenSettings.value.hpDisplayMode === 'text'
      ? HP_MODE_ACTIVE_CLASS
      : HP_MODE_INACTIVE_CLASS,
  );

  function getTokenSizeClass(sizeValue: number): string {
    return tokenSettings.value.scale === sizeValue
      ? TOKEN_SIZE_ACTIVE_CLASS
      : TOKEN_SIZE_INACTIVE_CLASS;
  }
</script>

<template>
  <UDraggableModal
    v-model:open="isOpen"
    :draggable="true"
    :resizable="true"
    :z-index="props.zIndex"
    :title="CREATURE_SETTINGS_LABELS.title"
    :ui="{
      content: 'max-w-2xl',
      body: 'min-h-100',
    }"
    @bring-to-front="emit('bring-to-front')"
  >
    <template #body>
      <div v-if="creature">
        <!-- Информация о существе -->
        <div
          class="mb-4 flex items-center gap-3 rounded-lg border border-default bg-elevated/50 p-3"
        >
          <UAvatar
            :src="getAssetUrl(creature.token?.imageUrl || '')"
            :alt="creature.name"
            size="md"
          />

          <div class="min-w-0">
            <h3 class="font-medium text-highlighted">
              {{ creature.name }}
            </h3>

            <p class="text-xs text-muted">
              {{ CREATURE_SIZE_LABELS[creature.system.size] }},
              {{ CREATURE_CATEGORIES[creature.system.type] }}
              —
              {{
                getAlignmentLabel(creature.system.alignment)
                || CREATURE_NO_ALIGNMENT
              }}
            </p>
          </div>

          <!-- Выбор владельца -->
          <div class="ml-auto shrink-0 space-y-1">
            <label class="block text-xs text-muted">
              {{ TOKEN_SETTINGS_LABELS.owner }}
            </label>

            <USelect
              v-if="isAdmin"
              v-model="selectedOwner"
              :items="userOptions"
              value-key="value"
              :placeholder="TOKEN_SETTINGS_LABELS.ownerNone"
              :portal="false"
              class="w-40"
            />

            <div
              v-else
              class="flex items-center gap-1.5 text-xs text-muted"
            >
              <UIcon
                name="tabler:user"
                class="size-3.5"
              />

              <span>
                {{
                  getOwnerName(creature.ownerId)
                  || TOKEN_SETTINGS_LABELS.ownerNone
                }}
              </span>
            </div>
          </div>
        </div>

        <!-- Вкладки -->
        <UTabs
          :items="tabs"
          class="w-full"
        >
          <!-- Вкладка "Общее" -->
          <template #general>
            <div class="space-y-4 py-4">
              <div class="grid grid-cols-2 gap-3">
                <!-- Видимость для всех -->
                <div
                  class="flex items-center justify-between rounded border border-default/50 bg-elevated/30 p-3"
                >
                  <div class="space-y-0.5">
                    <label class="text-sm font-medium text-toned">
                      {{ TOKEN_SETTINGS_LABELS.visibleToAll }}
                    </label>

                    <p class="text-xs text-dimmed">
                      {{ CREATURE_SETTINGS_LABELS.visibleToAllHint }}
                    </p>
                  </div>

                  <USwitch
                    v-model="isPublic"
                    :disabled="!isAdmin"
                  />
                </div>

                <!-- Авто-спасброски -->
                <div
                  class="flex items-center justify-between rounded border border-default/50 bg-elevated/30 p-3"
                >
                  <div class="space-y-0.5">
                    <label class="text-sm font-medium text-toned">
                      {{ TOKEN_SETTINGS_LABELS.autoSaves }}
                    </label>

                    <p class="text-xs text-dimmed">
                      {{ TOKEN_SETTINGS_LABELS.autoSavesHint }}
                    </p>
                  </div>

                  <USwitch
                    v-model="autoSaves"
                    :disabled="!(isAdmin || isOwner)"
                  />
                </div>
              </div>

              <div class="grid grid-cols-2 gap-3">
                <div
                  class="flex items-center justify-between rounded border border-default/50 bg-elevated/30 p-3"
                >
                  <div class="space-y-0.5">
                    <label class="text-sm font-medium text-toned">
                      {{ TOKEN_SETTINGS_LABELS.showName }}
                    </label>

                    <p class="text-xs text-dimmed">
                      {{ TOKEN_SETTINGS_LABELS.showNameHint }}
                    </p>
                  </div>

                  <USwitch
                    v-model="tokenSettings.showName"
                    :disabled="!(isAdmin || isOwner)"
                  />
                </div>

                <!-- Отображение ХП -->
                <div
                  class="rounded border border-default/50 bg-elevated/30 p-3"
                >
                  <div class="mb-2 flex items-center gap-2">
                    <UIcon
                      name="tabler:heart"
                      class="size-4 text-muted"
                    />

                    <label class="flex-1 text-sm font-medium text-toned">
                      {{ TOKEN_SETTINGS_LABELS.hpDisplay }}
                    </label>
                  </div>

                  <div class="grid grid-cols-2 gap-2">
                    <button
                      class="flex items-center gap-2 rounded border p-2 text-left text-sm transition-colors"
                      :class="hpBarModeClass"
                      :disabled="!(isAdmin || isOwner)"
                      @click.left.exact.prevent="
                        tokenSettings.hpDisplayMode = 'bar'
                      "
                    >
                      <UIcon
                        name="tabler:chart-bar"
                        class="size-4 shrink-0"
                      />

                      <div>
                        <div class="font-medium">
                          {{ TOKEN_SETTINGS_LABELS.hpBar }}
                        </div>
                      </div>
                    </button>

                    <button
                      class="flex items-center gap-2 rounded border p-2 text-left text-sm transition-colors"
                      :class="hpTextModeClass"
                      :disabled="!(isAdmin || isOwner)"
                      @click.left.exact.prevent="
                        tokenSettings.hpDisplayMode = 'text'
                      "
                    >
                      <UIcon
                        name="tabler:text-size"
                        class="size-4 shrink-0"
                      />

                      <div>
                        <div class="font-medium">
                          {{ TOKEN_SETTINGS_LABELS.hpState }}
                        </div>
                      </div>
                    </button>
                  </div>
                </div>
              </div>

              <!-- Размер токена -->
              <div class="rounded border border-default/50 bg-elevated/30 p-3">
                <div class="mb-2 flex items-center gap-2">
                  <UIcon
                    name="tabler:arrows-maximize"
                    class="size-4 text-muted"
                  />

                  <label class="text-sm font-medium text-toned">
                    {{ TOKEN_SETTINGS_LABELS.tokenSize }}
                  </label>
                </div>

                <div class="grid grid-cols-3 gap-1.5">
                  <button
                    v-for="sizeOption in TOKEN_SIZE_OPTIONS"
                    :key="sizeOption.value"
                    class="rounded-md border px-2 py-1.5 text-center text-sm transition-all"
                    :class="getTokenSizeClass(sizeOption.value)"
                    :disabled="!(isAdmin || isOwner)"
                    @click.left.exact.prevent="
                      tokenSettings.scale = sizeOption.value
                    "
                  >
                    <span class="font-medium">{{ sizeOption.label }}</span>

                    <span class="ml-1 opacity-60">{{
                      sizeOption.description
                    }}</span>
                  </button>
                </div>
              </div>

              <!-- Отношение к игрокам (Disposition) -->
              <div class="rounded border border-default/50 bg-elevated/30 p-3">
                <div class="mb-3 flex items-center gap-2">
                  <UIcon
                    name="tabler:mood-smile"
                    class="h-4 w-4 text-muted"
                  />

                  <label class="text-sm font-medium text-toned">
                    {{ TOKEN_SETTINGS_LABELS.disposition }}
                  </label>
                </div>

                <div class="grid grid-cols-3 gap-2">
                  <button
                    class="flex flex-col items-center gap-1 rounded-lg border p-2 transition-all"
                    :class="[
                      tokenSettings.disposition === 'friendly'
                        ? 'border-success bg-success/20 text-success-muted'
                        : 'border-default/50 bg-elevated/30 text-muted hover:border-accented hover:text-toned',
                    ]"
                    :disabled="!(isAdmin || isOwner)"
                    @click.left.exact.prevent="
                      tokenSettings.disposition = 'friendly'
                    "
                  >
                    <span class="text-sm font-medium">
                      {{ TOKEN_SETTINGS_LABELS.dispositionFriendly }}
                    </span>
                  </button>

                  <button
                    class="flex flex-col items-center gap-1 rounded-lg border p-2 transition-all"
                    :class="[
                      tokenSettings.disposition === 'neutral'
                        ? 'border-warning bg-warning/20 text-warning-muted'
                        : 'border-default/50 bg-elevated/30 text-muted hover:border-accented hover:text-toned',
                    ]"
                    :disabled="!(isAdmin || isOwner)"
                    @click.left.exact.prevent="
                      tokenSettings.disposition = 'neutral'
                    "
                  >
                    <span class="text-sm font-medium">
                      {{ TOKEN_SETTINGS_LABELS.dispositionNeutral }}
                    </span>
                  </button>

                  <button
                    class="flex flex-col items-center gap-1 rounded-lg border p-2 transition-all"
                    :class="[
                      tokenSettings.disposition === 'hostile'
                      || !tokenSettings.disposition
                        ? 'border-danger bg-danger/20 text-danger-muted'
                        : 'border-default/50 bg-elevated/30 text-muted hover:border-accented hover:text-toned',
                    ]"
                    :disabled="!(isAdmin || isOwner)"
                    @click.left.exact.prevent="
                      tokenSettings.disposition = 'hostile'
                    "
                  >
                    <span class="text-sm font-medium">
                      {{ TOKEN_SETTINGS_LABELS.dispositionHostile }}
                    </span>
                  </button>
                </div>

                <p class="mt-2 text-xs text-dimmed">
                  {{ TOKEN_SETTINGS_LABELS.dispositionHint }}
                </p>
              </div>
            </div>
          </template>

          <!-- Вкладка "Токен" -->
          <template #token>
            <div class="flex h-full flex-col gap-4 overflow-hidden pt-4">
              <!-- 1. Превью (Сверху) -->
              <div class="flex h-70 flex-none flex-col">
                <div class="mb-2 flex items-center justify-between">
                  <div class="text-sm font-medium text-toned">
                    {{ TOKEN_SETTINGS_LABELS.preview }}
                  </div>

                  <div class="flex gap-2 text-xs text-dimmed">
                    <span class="flex items-center gap-1">
                      <UIcon name="tabler:click" />
                      {{ TOKEN_SETTINGS_LABELS.previewMove }}
                    </span>

                    <span class="flex items-center gap-1">
                      <UIcon name="tabler:arrows-maximize" />
                      {{ TOKEN_SETTINGS_LABELS.previewZoom }}
                    </span>
                  </div>
                </div>

                <div
                  class="relative flex flex-1 items-center justify-center overflow-hidden rounded-lg border border-default bg-default/50 select-none"
                >
                  <!-- Тоггл рамки (верхний левый угол) -->
                  <div
                    class="absolute top-2 left-2 z-20 flex items-center gap-1.5 rounded-md bg-default/80 px-2 py-1"
                  >
                    <span class="text-xs text-muted">
                      {{ TOKEN_SETTINGS_LABELS.previewFrame }}
                    </span>

                    <USwitch
                      v-model="showFrame"
                      size="xs"
                      :disabled="!(isAdmin || isOwner)"
                      @change="toggleFrame"
                    />
                  </div>

                  <!-- Фон сетка для прозрачности -->
                  <div
                    class="absolute inset-0 opacity-20"
                    style="
                      background-image: radial-gradient(
                        var(--ui-text-muted) 1px,
                        transparent 1px
                      );
                      background-size: 10px 10px;
                    "
                  />

                  <!-- Контейнер токена -->
                  <div
                    class="relative transition-all duration-200"
                    :style="{
                      width: `${previewTokenSize}px`,
                      height: `${previewTokenSize}px`,
                    }"
                  >
                    <!-- С рамкой: круглая маска + рамка -->
                    <template v-if="tokenSettings.frameUrl">
                      <div
                        class="relative h-full w-full bg-elevated"
                        :class="{
                          'cursor-move': isAdmin || isOwner,
                          'cursor-not-allowed': !(isAdmin || isOwner),
                        }"
                        style="
                          clip-path: circle(44% at 50% 50%);
                          overflow: hidden;
                        "
                        @mousedown="handleTokenMouseDown"
                        @wheel.prevent="handleTokenWheel"
                      >
                        <TokenMediaPreview
                          v-if="showTokenImage"
                          :src="
                            getAssetUrl(tokenSettings.imageUrl) || undefined
                          "
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
                            name="tabler:alien"
                            class="h-1/2 w-1/2"
                          />
                        </div>
                      </div>

                      <img
                        :src="getAssetUrl(tokenSettings.frameUrl) || undefined"
                        class="pointer-events-none absolute inset-0 h-full w-full object-contain select-none"
                        draggable="false"
                      />
                    </template>

                    <!-- Без рамки: картинка свободно, квадрат ячейки поверх -->
                    <template v-else>
                      <!-- Картинка с трансформациями (может выходить за квадрат) -->
                      <div
                        class="flex h-full w-full items-center justify-center"
                        :class="{
                          'cursor-move': isAdmin || isOwner,
                          'cursor-not-allowed': !(isAdmin || isOwner),
                        }"
                        @mousedown="handleTokenMouseDown"
                        @wheel.prevent="handleTokenWheel"
                      >
                        <TokenMediaPreview
                          v-if="showTokenImage"
                          :src="
                            getAssetUrl(tokenSettings.imageUrl) || undefined
                          "
                          class="w-full max-w-none transition-none select-none"
                          :style="tokenImageStyle"
                          draggable="false"
                          @error="onTokenImageError"
                        />

                        <div
                          v-else
                          class="flex h-full w-full items-center justify-center text-dimmed"
                        >
                          <UIcon
                            name="tabler:alien"
                            class="h-1/2 w-1/2"
                          />
                        </div>
                      </div>
                      <!-- Граница ячейки ПОВЕРХ картинки -->
                      <div
                        class="pointer-events-none absolute inset-0 z-10 border-2 border-dashed border-primary/60"
                      />
                    </template>
                  </div>
                </div>
              </div>

              <!-- 1.5. Поворот изображения внутри токена -->
              <!-- Отступы обязательны: вкладка обрезает переполнение
                   (`overflow-hidden`), и без них круглый бегунок ползунка
                   срезался бы по обоим краям. -->
              <div
                class="flex-none rounded-lg border border-default/50 bg-elevated/50 p-4"
              >
                <div class="mb-2 flex items-center justify-between">
                  <label class="text-sm font-medium text-toned">
                    {{ TOKEN_SETTINGS_LABELS.imageRotation }}
                  </label>

                  <div class="flex items-center gap-2">
                    <span class="text-sm text-muted">
                      {{ Math.round(tokenSettings.rotation) }}°
                    </span>

                    <UButton
                      icon="tabler:rotate-clockwise"
                      color="neutral"
                      variant="ghost"
                      size="xs"
                      :title="TOKEN_SETTINGS_LABELS.imageRotationReset"
                      :disabled="!(isAdmin || isOwner)"
                      @click.left.exact.prevent="
                        tokenSettings.rotation = TOKEN_IMAGE_ROTATION_DEFAULT
                      "
                    />
                  </div>
                </div>

                <USlider
                  v-model.number="tokenSettings.rotation"
                  :min="TOKEN_IMAGE_ROTATION_MIN"
                  :max="TOKEN_IMAGE_ROTATION_MAX"
                  :step="TOKEN_IMAGE_ROTATION_STEP"
                  :disabled="!(isAdmin || isOwner)"
                />

                <p class="mt-2 text-xs text-dimmed">
                  {{ TOKEN_SETTINGS_LABELS.imageRotationHint }}
                </p>
              </div>

              <!-- 2. Изображение токена (по стилю EditSceneModal) -->
              <div
                class="flex min-h-0 flex-1 flex-col space-y-4 overflow-hidden rounded-lg border border-default/50 bg-elevated/50 p-4"
              >
                <h3
                  class="flex items-center gap-2 text-sm font-semibold text-highlighted"
                >
                  <UIcon
                    name="tabler:photo"
                    class="h-5 w-5 text-primary"
                  />
                  {{ TOKEN_SETTINGS_LABELS.tokenImage }}
                </h3>

                <UFormField :label="TOKEN_SETTINGS_LABELS.imageUrl">
                  <UInput
                    v-model="tokenSettings.imageUrl"
                    placeholder="https://..."
                    :disabled="!(isAdmin || isOwner)"
                    icon="tabler:link"
                    class="w-full"
                  />
                </UFormField>

                <!-- Asset Browser -->
                <div
                  v-if="props.worldPort"
                  class="min-h-0 flex-1 overflow-y-auto"
                >
                  <AssetBrowser
                    v-model="tokenSettings.imageUrl"
                    :world-port="props.worldPort"
                    :root-path="creatureFolderPath"
                    :initial-path="creatureFolderPath"
                  />
                </div>
              </div>
            </div>
          </template>

          <!-- Вкладка "Зрение" -->
          <template #vision>
            <div class="space-y-4 py-4">
              <div
                class="flex items-center justify-between rounded border border-default/50 bg-elevated/30 p-3"
              >
                <div class="space-y-0.5">
                  <label class="text-sm font-medium text-toned">
                    {{ TOKEN_SETTINGS_LABELS.visionEnabled }}
                  </label>

                  <p class="text-xs text-dimmed">
                    {{ TOKEN_SETTINGS_LABELS.visionEnabledHint }}
                  </p>
                </div>

                <USwitch
                  v-model="visionSettings.enabled"
                  :disabled="!(isAdmin || isOwner)"
                />
              </div>

              <template v-if="visionSettings.enabled">
                <div class="grid grid-cols-2 gap-3">
                  <div class="space-y-2">
                    <label class="block text-sm font-medium text-toned">
                      {{ TOKEN_SETTINGS_LABELS.vision }}
                    </label>

                    <UInput
                      v-model.number="visionSettings.range"
                      type="number"
                      :min="TOKEN_VISION_RANGE_MIN"
                      :step="TOKEN_VISION_RANGE_STEP"
                      :disabled="!(isAdmin || isOwner)"
                    />

                    <p class="text-xs text-dimmed">
                      {{ TOKEN_SETTINGS_LABELS.visionRangeHint }}
                    </p>
                  </div>

                  <div class="space-y-2">
                    <label class="block text-sm font-medium text-toned">
                      {{ TOKEN_SETTINGS_LABELS.darkvision }}
                    </label>

                    <UInput
                      v-model.number="visionSettings.darkvision"
                      type="number"
                      :min="TOKEN_DARKVISION_MIN"
                      :step="TOKEN_DARKVISION_STEP"
                      :disabled="!(isAdmin || isOwner)"
                    />

                    <p class="text-xs text-dimmed">
                      {{ TOKEN_SETTINGS_LABELS.darkvisionRangeHint }}
                    </p>
                  </div>
                </div>

                <div
                  class="mt-4 space-y-3 rounded border border-default/50 bg-elevated/30 p-4"
                >
                  <div class="flex items-center justify-between gap-3">
                    <label class="text-sm font-medium text-toned">
                      {{ TOKEN_SETTINGS_LABELS.visionAngle }}
                    </label>

                    <div class="flex items-center gap-2">
                      <span class="text-sm text-muted">
                        {{ visionAngleLabel }}
                      </span>

                      <UInput
                        v-model.number="visionSettings.angle"
                        type="number"
                        class="w-24"
                        :min="TOKEN_VISION_ANGLE_MIN"
                        :max="TOKEN_VISION_ANGLE_MAX"
                        :step="TOKEN_VISION_ANGLE_STEP"
                        :disabled="!(isAdmin || isOwner)"
                        @blur="normalizeVisionAngle"
                      />
                    </div>
                  </div>

                  <USlider
                    v-model.number="visionSettings.angle"
                    :min="TOKEN_VISION_ANGLE_MIN"
                    :max="TOKEN_VISION_ANGLE_MAX"
                    :step="TOKEN_VISION_ANGLE_STEP"
                    :disabled="!(isAdmin || isOwner)"
                  />

                  <div class="flex flex-wrap gap-2">
                    <UButton
                      v-for="preset in TOKEN_VISION_ANGLE_PRESETS"
                      :key="preset"
                      size="xs"
                      :color="getVisionAnglePresetColor(preset)"
                      :variant="getVisionAnglePresetVariant(preset)"
                      :disabled="!(isAdmin || isOwner)"
                      @click.left.exact.prevent="visionSettings.angle = preset"
                    >
                      {{ preset }}°
                    </UButton>
                  </div>

                  <p class="text-xs text-dimmed">
                    {{ TOKEN_SETTINGS_LABELS.visionAngleHint }}
                  </p>
                </div>

                <div
                  class="mt-6 rounded border border-default/50 bg-elevated/30 p-3 text-xs text-dimmed"
                >
                  <p class="mb-2 font-semibold">
                    {{ TOKEN_SETTINGS_LABELS.hintPrefix }}
                  </p>

                  <ul class="list-inside list-disc space-y-1">
                    <li>{{ TOKEN_SETTINGS_LABELS.hintVision }}</li>

                    <li>{{ TOKEN_SETTINGS_LABELS.hintDarkvision }}</li>

                    <li>{{ TOKEN_SETTINGS_LABELS.hintNoDarkvision }}</li>
                  </ul>
                </div>
              </template>
            </div>
          </template>

          <!-- Вкладка "Освещение" -->
          <template #light>
            <div class="space-y-4 py-4">
              <LightEmitterEditor
                v-model="lightSettings"
                :disabled="!(isAdmin || isOwner)"
              />
            </div>
          </template>
        </UTabs>
      </div>

      <div
        v-else
        class="flex items-center justify-center p-8"
      >
        <USpinner />
      </div>
    </template>

    <template #footer>
      <div class="flex w-full items-center justify-between">
        <div class="flex items-center gap-3">
          <span class="text-xs text-dimmed">ID: {{ creatureId }}</span>

          <UButton
            v-if="(isAdmin || isOwner) && creatureId"
            color="error"
            variant="ghost"
            size="xs"
            icon="tabler:trash"
            @click.left.exact.prevent="isDeleteConfirmOpen = true"
          >
            {{ MODAL_BUTTON_LABELS.remove }}
          </UButton>
        </div>

        <div class="flex gap-2">
          <UButton
            color="neutral"
            variant="soft"
            @click.left.exact.prevent="isOpen = false"
          >
            {{ MODAL_BUTTON_LABELS.cancel }}
          </UButton>

          <UButton
            v-if="isAdmin || isOwner"
            color="primary"
            :loading="isSaving"
            :disabled="!hasChanges"
            @click.left.exact.prevent="saveSettings"
          >
            {{ MODAL_BUTTON_LABELS.save }}
          </UButton>
        </div>
      </div>
    </template>
  </UDraggableModal>

  <CreatureDeleteConfirmModal
    v-model:open="isDeleteConfirmOpen"
    :creature="creature"
    :socket="props.socket ?? null"
    @deleted="handleCreatureDeleted"
  />
</template>
