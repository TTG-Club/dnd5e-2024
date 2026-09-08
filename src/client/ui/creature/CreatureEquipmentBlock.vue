<script setup lang="ts">
  import type {
    DnDCreature,
    DnDCurrency,
    DnDGameItem,
  } from '@vtt/shared/system/dnd.js';

  import { computed } from 'vue';

  import FieldsetLabel from '@/shared_ui/components/FieldsetLabel.vue';

  import ActorEquipmentTab from '../actor/tabs/ActorEquipmentTab.vue';
  import { getSheetBlockClass } from '../actor/utils/sheetBlockClass';
  import { CREATURE_SHEET_LABELS } from './constants';

  interface Props {
    creature: DnDCreature;
    isEditMode: boolean;
    /** Подсвечивать зону приёма, пока предмет тащат на лист */
    isDragOver?: boolean;
    /**
     * Лист только для чтения: запись компендиума и чужой монстр без контроля.
     * Инвентарь тогда виден, но не правится — как заклинания и особенности.
     */
    isReadOnly?: boolean;
  }

  const props = defineProps<Props>();

  const emit = defineEmits<{
    'update:creature': [updates: Partial<DnDCreature>];
  }>();

  /**
   * Ссылка на карточку сайта в строке снаряжения: `[Секира](https://…)`.
   * Разметка приходит только в старом списке позиций — по ней он и отличается
   * от свободной строки.
   */
  const GEAR_LINK_PATTERN = /\]\(https?:\/\//u;

  /**
   * Строка «Снаряжение» статблока — только свободная, набранная в мастерской.
   *
   * Поле `system.gear` несёт две разные вещи: у перезаполненных существ это
   * свободная строка, а у остальных — старый список позиций со ссылками на
   * сайт. Старый список заменяет разбор `gearItems`: позиции из него уже лежат
   * в инвентаре, и дублировать их адресами карточек незачем. Отличаем по
   * разметке ссылки: перезаполнят существо — строка появится сама.
   */
  const gearNote = computed<string | undefined>(() => {
    const gear = props.creature.system.gear?.trim();

    if (!gear || GEAR_LINK_PATTERN.test(gear)) {
      return undefined;
    }

    return gear;
  });

  /**
   * Приписку правят только на своей записи в режиме правки. Признак отдельный,
   * потому что режим правки сам по себе доступа не даёт: лист открывают и на
   * записи компендиума, и на чужом монстре — там блок только читают.
   */
  const isNoteEditable = computed<boolean>(
    () => props.isEditMode && !props.isReadOnly,
  );

  /**
   * Оформление блока приписки — по общему правилу блоков листа: приглушённая
   * рамка, а когда приписку правят — тёплая, цветом настройки. Своих цветов у
   * блока нет намеренно: он стоит в одном ряду с остальными блоками листа.
   */
  const noteBlockClass = computed<string>(() =>
    getSheetBlockClass({ isEditMode: isNoteEditable.value }),
  );

  /**
   * Записывает приписку в блок `system` существа.
   *
   * Пустая строка стирает поле целиком: пустая приписка и её отсутствие для
   * листа одно и то же, а хранить пустую строку — значит показывать блок ни с
   * чем вне правки.
   *
   * @param value - текст приписки из поля ввода
   */
  function handleGearUpdate(value: string): void {
    const gear = value.trim() ? value : undefined;

    emit('update:creature', {
      system: { ...props.creature.system, gear },
    });
  }

  /**
   * Записывает новый инвентарь в существо.
   *
   * Отдельного «сохранить сейчас» тут нет намеренно: лист существа сохраняет
   * запись прямо в `update:creature` (вне режима правки), и второй сигнал дал
   * бы двойную отправку на сервер. У листа персонажа иначе — там обновление и
   * сохранение разведены, поэтому панель шлёт оба события.
   *
   * @param equipment - новый инвентарь существа
   */
  function handleEquipmentUpdate(equipment: DnDGameItem[]): void {
    emit('update:creature', { equipment });
  }

  /**
   * Записывает новый кошелёк в блок `system` существа.
   *
   * @param currency - новый кошелёк
   */
  function handleCurrencyUpdate(currency: DnDCurrency): void {
    emit('update:creature', {
      system: { ...props.creature.system, currency },
    });
  }
</script>

<template>
  <!--
    Панель та же, что у листа персонажа: механика снаряжения общая, и
    расхождение двух копий было бы вопросом времени. Выключены ровно те части,
    которых у существа нет: настройка предела переносимого веса (он считается по
    правилам от Силы и размера, менять там нечего) и перетаскивание на панель
    быстрого доступа — макрос атаки ищет владельца среди актёров и на существе
    дал бы мёртвую кнопку.
  -->
  <ActorEquipmentTab
    :entity="creature"
    :is-edit-mode="isEditMode"
    :is-drag-over="isDragOver"
    :is-read-only="isReadOnly"
    show-currency
    @update:equipment="handleEquipmentUpdate"
    @update:currency="handleCurrencyUpdate"
  >
    <!--
      Свободная строка снаряжения — блоком под кошельком, над списком
      экипировки: сами предметы уже разложены по позициям, а здесь остаётся
      приписка мастерской (количества словами, то, чему карточки не нашлось).
      Блок с рамкой, как остальные подписанные блоки листа; в режиме правки
      он же служит полем ввода.
    -->
    <template #note>
      <FieldsetLabel
        v-if="isNoteEditable || gearNote"
        :label="CREATURE_SHEET_LABELS.gearNote"
        class="mb-5 bg-default/20 transition-colors"
        :class="noteBlockClass"
      >
        <!--
          В правке поле показывает `system.gear` как есть, без отбора: у не
          перезаполненных существ там ещё старый список со ссылками, и прятать
          его от того, кто правит запись, нельзя — иначе сохранение молча
          затрёт то, чего он не видел.
        -->
        <UTextarea
          v-if="isNoteEditable"
          :model-value="creature.system.gear ?? ''"
          :rows="2"
          autoresize
          variant="none"
          :placeholder="CREATURE_SHEET_LABELS.gearNotePlaceholder"
          class="w-full"
          :ui="{ base: 'text-xs px-3 pt-1 pb-2' }"
          @update:model-value="handleGearUpdate"
        />

        <p
          v-else
          class="px-3 pt-1 pb-2 text-xs wrap-break-word text-toned"
        >
          {{ gearNote }}
        </p>
      </FieldsetLabel>
    </template>
  </ActorEquipmentTab>
</template>
