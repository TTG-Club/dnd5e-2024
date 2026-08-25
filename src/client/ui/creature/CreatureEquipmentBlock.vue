<script setup lang="ts">
  import type {
    DnDCreature,
    DnDCurrency,
    DnDGameItem,
  } from '@vtt/shared/system/dnd.js';

  import ActorEquipmentTab from '../actor/tabs/ActorEquipmentTab.vue';

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
  />
</template>
