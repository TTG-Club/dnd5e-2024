<script setup lang="ts">
  // Корневой вход `@nuxt/ui` — это Nuxt-модуль, типы компонентов он не отдаёт
  import type { DropdownMenuItem } from '@nuxt/ui/components/DropdownMenu.vue';

  import type { DnDGameItem } from '@vtt/shared/system/dnd.js';

  import type { SheetRowStat } from './sheetRowTypes';

  import { computed } from 'vue';

  import { getEquipmentCategoryIcon } from '@vtt/shared/system/dnd.js';

  import {
    DEFAULT_EQUIPMENT_ICON,
    EQUIPMENT_BADGE_HINTS,
    EQUIPMENT_BADGE_LABELS,
    EQUIPMENT_EQUIP_ACTION_LABELS,
    EQUIPMENT_TYPE_ICONS,
    SHEET_ROW_ARIA_LABELS,
  } from './constants';
  import SheetRowStats from './SheetRowStats.vue';
  import WeaponIcon from './WeaponIcon.vue';

  interface Props {
    /** Предмет снаряжения */
    item: DnDGameItem;
    /** Подпись под названием: категория и вид предмета */
    subtitle?: string;
    /** Плитки параметров: атака и урон оружия, КД доспеха, цена, вес */
    stats?: SheetRowStat[];
    /** Пункты меню строки — общие для правой кнопки мыши и «⋮» */
    menuItems?: DropdownMenuItem[][];
    /** Надеть нельзя: на персонаже уже другой доспех */
    isEquipBlocked?: boolean;
    /** Лист в режиме правки: нажатие по строке описание не открывает */
    isEditMode?: boolean;
  }

  const props = withDefaults(defineProps<Props>(), {
    subtitle: '',
    stats: () => [],
    menuItems: () => [],
    isEquipBlocked: false,
    isEditMode: false,
  });

  const emit = defineEmits<{
    /** Открыть описание предмета */
    'open': [];
    /** Надеть или снять предмет */
    'toggle-equip': [];
    /** Бросок с плитки параметра (атака и урон катятся вместе) */
    'roll': [];
    /** Новое количество предмета */
    'update:quantity': [quantity: number];
    /** Начало перетаскивания строки (хотбар и передача предмета) */
    'dragstart': [event: DragEvent];
  }>();

  /** Значок предмета для не-оружия: у оружия его рисует `WeaponIcon` */
  const itemIcon = computed(() =>
    props.item.type === 'equipment'
      ? getEquipmentCategoryIcon(props.item.equipmentCategory)
      : (EQUIPMENT_TYPE_ICONS[props.item.type] ?? DEFAULT_EQUIPMENT_ICON),
  );

  /** Универсальное оружие: хват меняется пунктом меню */
  const isVersatile = computed(
    () =>
      props.item.type === 'weapon'
      && Boolean(props.item.weaponProperties?.includes('versatile')),
  );

  const isTwoHanded = computed(
    () => isVersatile.value && Boolean(props.item.twoHandedGrip),
  );

  /**
   * Настройки ждёт предмет, который её требует, но ещё не получил: его свойства
   * не работают, и значок об этом предупреждает. У необязательной настройки
   * (`optional`) предупреждения нет — предмет работает и без неё.
   */
  const isAttunementRequired = computed(
    () => props.item.magicAttunement === 'required' && !props.item.isAttuned,
  );

  const isAttuned = computed(
    () =>
      Boolean(props.item.isAttuned)
      && props.item.magicAttunement !== undefined
      && props.item.magicAttunement !== 'none',
  );

  const equipActionLabel = computed(() =>
    props.item.equipped
      ? EQUIPMENT_EQUIP_ACTION_LABELS.unequip
      : EQUIPMENT_EQUIP_ACTION_LABELS.equip,
  );

  /**
   * Заблокированная кнопка объясняет подсказкой, почему она не нажимается;
   * подпись для скринридера остаётся действием — недоступность он читает по
   * `aria-disabled`.
   */
  const equipTooltip = computed(() =>
    props.isEquipBlocked
      ? EQUIPMENT_EQUIP_ACTION_LABELS.blocked
      : equipActionLabel.value,
  );

  const equipButtonClass = computed(() => {
    if (props.isEquipBlocked) {
      return 'cursor-not-allowed border-default/40 bg-default/20 text-dimmed';
    }

    return props.item.equipped
      ? 'cursor-pointer border-primary/60 bg-primary/15 text-primary'
      : 'cursor-pointer border-default/50 bg-default/40 text-muted hover:border-primary/60';
  });

  /** Надетый предмет виден в списке издалека — по тёплой обводке строки */
  const rowClass = computed(() =>
    props.item.equipped ? 'bg-primary/5 ring-1 ring-primary/50 ring-inset' : '',
  );

  const quantity = computed(() => props.item.quantity ?? 1);

  const isDecreaseDisabled = computed(() => quantity.value <= 1);

  /** Нажатие по строке открывает описание — вне режима правки листа */
  function handleOpen(): void {
    if (props.isEditMode) {
      return;
    }

    emit('open');
  }

  function handleEquipToggle(): void {
    if (props.isEquipBlocked) {
      return;
    }

    emit('toggle-equip');
  }

  function handleDecrease(): void {
    emit('update:quantity', quantity.value - 1);
  }

  function handleIncrease(): void {
    emit('update:quantity', quantity.value + 1);
  }

  /**
   * Количество, вписанное от руки: у стопки в полсотни стрел «+» нажимают не
   * пятьдесят раз.
   *
   * @param event - событие изменения поля ввода
   */
  function handleQuantityInput(event: Event): void {
    if (!(event.target instanceof HTMLInputElement)) {
      return;
    }

    emit('update:quantity', Number(event.target.value));
  }

  function handleDragStart(event: DragEvent): void {
    emit('dragstart', event);
  }

  /**
   * Бросок с плитки: у листа он один на попадание и урон, поэтому обе плитки
   * оружия открывают одну и ту же модалку — какую нажали, неважно.
   */
  function handleRoll(): void {
    emit('roll');
  }
</script>

<template>
  <UContextMenu :items="menuItems">
    <!-- Свой @container: строка перестраивается по ширине самого списка, а не
      окна — лист персонажа бывает узким и на широком экране -->
    <div
      class="@container flex flex-col rounded-lg border border-default/50 bg-elevated/20 transition-colors hover:border-primary/60"
      :class="rowClass"
      :draggable="true"
      @dragstart="handleDragStart"
    >
      <!-- Перестроение по ступени контейнера, а не по факту переполнения: до
        @xl (36rem) значок с названием занимают всю первую строку, а плитки,
        количество и меню уходят на вторую. Иначе раскладка зависела бы от длины
        названия и соседние строки выглядели бы по-разному -->
      <div class="relative flex flex-wrap items-center gap-x-3 gap-y-2 p-3">
        <div
          class="flex w-full min-w-0 items-center gap-3 @xl:w-auto @xl:flex-1"
        >
          <UTooltip :text="equipTooltip">
            <button
              type="button"
              class="relative z-10 flex size-10 shrink-0 items-center justify-center rounded-lg border transition-colors"
              :class="equipButtonClass"
              :aria-disabled="isEquipBlocked"
              :aria-pressed="item.equipped"
              :aria-label="`${equipActionLabel}: ${item.name}`"
              @click.left.exact.prevent.stop="handleEquipToggle"
            >
              <WeaponIcon
                v-if="item.type === 'weapon'"
                :base-type="item.baseType"
                class="size-5"
              />

              <UIcon
                v-else
                :name="itemIcon"
                class="size-5"
              />
            </button>
          </UTooltip>

          <!-- Подложка `after:inset-0` делает нажимаемой всю строку, а не одно
            название: попасть в неё мышью проще, а порядок обхода с клавиатуры
            остаётся прежним -->
          <button
            type="button"
            class="flex min-w-0 grow cursor-pointer flex-col text-left after:absolute after:inset-0 after:cursor-pointer"
            :aria-label="`${SHEET_ROW_ARIA_LABELS.openItem}: ${item.name}`"
            @click.left.exact.prevent="handleOpen"
          >
            <!-- Значки переносятся под название на узкой строке; на широкой
              стоят рядом с ним, а длинное название обрезается -->
            <span
              class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 @xl:flex-nowrap"
            >
              <span
                class="text-sm font-medium wrap-break-word text-highlighted @xl:truncate"
              >
                {{ item.name }}
              </span>

              <UBadge
                v-if="item.equipped"
                color="primary"
                variant="subtle"
                size="sm"
                class="shrink-0"
              >
                {{ EQUIPMENT_BADGE_LABELS.equipped }}
              </UBadge>

              <!-- Хват стоит рядом с «Надет»: своего значка у оружия нет, а без
                него выросшая кость урона выглядела бы ошибкой листа -->
              <UTooltip
                v-if="isTwoHanded"
                :text="EQUIPMENT_BADGE_HINTS.twoHanded"
              >
                <UBadge
                  color="primary"
                  variant="subtle"
                  size="sm"
                  class="relative z-10 shrink-0"
                >
                  {{ EQUIPMENT_BADGE_LABELS.twoHanded }}
                </UBadge>
              </UTooltip>

              <UTooltip
                v-if="isAttuned"
                :text="EQUIPMENT_BADGE_HINTS.attuned"
              >
                <UBadge
                  color="primary"
                  variant="subtle"
                  size="sm"
                  class="relative z-10 shrink-0"
                >
                  {{ EQUIPMENT_BADGE_LABELS.attuned }}
                </UBadge>
              </UTooltip>

              <UTooltip
                v-else-if="isAttunementRequired"
                :text="EQUIPMENT_BADGE_HINTS.attunementRequired"
              >
                <UBadge
                  color="warning"
                  variant="subtle"
                  size="sm"
                  class="relative z-10 shrink-0"
                >
                  {{ EQUIPMENT_BADGE_LABELS.attunementRequired }}
                </UBadge>
              </UTooltip>
            </span>

            <span
              v-if="subtitle"
              class="text-xs wrap-break-word text-dimmed @xl:truncate"
            >
              {{ subtitle }}
            </span>
          </button>
        </div>

        <!-- Плитки параметров — общий кирпич со строкой заклинаний: атака и
          урон оружия катятся по нажатию, цена и вес просто показаны -->
        <SheetRowStats
          :stats="stats"
          :roll-aria-label="`${SHEET_ROW_ARIA_LABELS.roll}: ${item.name}`"
          @roll="handleRoll"
        />

        <!-- Количество и меню держатся вместе и прижимаются вправо. Слой z-10
          поднимает их над подложкой названия, накрывающей всю строку -->
        <div class="relative z-10 ml-auto flex shrink-0 items-center gap-1">
          <UButton
            icon="tabler:minus"
            color="neutral"
            variant="ghost"
            size="xs"
            square
            :disabled="isDecreaseDisabled"
            :aria-label="`${SHEET_ROW_ARIA_LABELS.decreaseQuantity}: ${item.name}`"
            @click.left.exact.prevent.stop="handleDecrease"
          />

          <!-- Поле без рамки читается тем же числом, что и подпись рядом, но
            принимает количество, вписанное от руки -->
          <input
            type="number"
            :value="quantity"
            min="1"
            :aria-label="`${SHEET_ROW_ARIA_LABELS.quantity}: ${item.name}`"
            class="w-8 [appearance:textfield] rounded border border-transparent bg-transparent text-center text-sm font-medium text-default focus:border-primary focus:outline-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            @change="handleQuantityInput"
            @click.stop
          />

          <UButton
            icon="tabler:plus"
            color="neutral"
            variant="ghost"
            size="xs"
            square
            :aria-label="`${SHEET_ROW_ARIA_LABELS.increaseQuantity}: ${item.name}`"
            @click.left.exact.prevent.stop="handleIncrease"
          />

          <!-- Правка, настройка и удаление живут под «⋮»: строка и без них
            плотная, а отдельные кнопки ломали бы её ритм -->
          <UDropdownMenu
            :items="menuItems"
            :content="{ align: 'end' }"
          >
            <UButton
              icon="tabler:dots-vertical"
              color="neutral"
              variant="ghost"
              size="xs"
              square
              :aria-label="`${SHEET_ROW_ARIA_LABELS.itemActions}: ${item.name}`"
            />
          </UDropdownMenu>
        </div>
      </div>
    </div>
  </UContextMenu>
</template>
