<!--
  Значок состояния: картинка-силуэт либо иконка коллекции.

  Картинка рисуется МАСКОЙ под текущий цвет — ровно так же, как её рисует сцена
  на токене (`SceneTokenLabels`). Значок обязан выглядеть одинаково в списке, в
  карточке и на фишке, иначе выбранная в форме картинка на токене оказывалась бы
  другой.
-->
<script setup lang="ts">
  withDefaults(
    defineProps<{
      /** Иконка коллекции (`tabler:*`) */
      icon: string;
      /** Картинка-значок; имеет приоритет над иконкой */
      image?: string;
      /** Размер значка в пикселях */
      size?: number;
    }>(),
    { image: undefined, size: 20 },
  );
</script>

<template>
  <span
    v-if="image"
    class="inline-block shrink-0"
    :style="{
      width: `${size}px`,
      height: `${size}px`,
      maskImage: `url('${image}')`,
      WebkitMaskImage: `url('${image}')`,
      maskSize: 'contain',
      WebkitMaskSize: 'contain',
      maskPosition: 'center',
      WebkitMaskPosition: 'center',
      maskRepeat: 'no-repeat',
      WebkitMaskRepeat: 'no-repeat',
      backgroundColor: 'currentColor',
    }"
  />

  <UIcon
    v-else
    :name="icon"
    :style="{ width: `${size}px`, height: `${size}px` }"
    class="shrink-0"
  />
</template>
