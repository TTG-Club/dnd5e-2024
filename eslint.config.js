/**
 * Линтер системы — тот же, что в приложении VTTG (`vttg/eslint.config.js`).
 *
 * Один и тот же пресет `@svifty7/eslint-config` по обе стороны границы: код
 * системы пишется в стиле хоста, из монорепо сюда переносятся файлы целиком,
 * и расхождение в правилах превращало бы каждый такой перенос в diff из
 * форматирования. Отличия от конфига приложения — только пути: наш
 * tailwind-вход и наши игнор-листы.
 */

import { configure } from '@svifty7/eslint-config';

export default configure(
  {
    // Единственное отличие от приложения по смыслу, а не по путям: пресет сам
    // определяет «меня запустили из редактора» и глушит часть правил, чтобы не
    // мигать ошибками во время набора. Проверка обязательная, и её результат не
    // должен зависеть от того, откуда её позвали, — поэтому режим выключен.
    isInEditor: false,
    stylistic: {
      semi: true,
    },
    vue: {
      a11y: true,
    },
    ignores: [
      '.agents',
      'AGENTS.md',
      // Сборка и генерируемые файлы
      'dist',
      'auto-imports.d.ts',
      'src/client/hostClasses.txt',
      // Вендоренная копия @vtt/shared: правится только синком с апстримом
      // (Rule #0 в AGENTS.md), поэтому и замечания линтера тут неисполнимы
      'sdk',
    ],
    prettier: {
      tailwindStylesheet: './src/client/system.css',
    },
  },
  {
    ignores: ['**/*.md', '**/*.json'],
  },
  {
    files: ['**/*.vue'],
    rules: {
      // В <script setup> computed/ref переменные используются в callbacks
      // до их определения — это стандартный паттерн Vue (hoisting)
      'ts/no-use-before-define': 'off',
      // Проект использует inline styles для динамических элементов
      'vue/no-static-inline-styles': 'off',
      // Декоративные изображения не требуют alt
      'vue-a11y/alt-text': 'off',
      // Проект использует camelCase events (defineEmits convention)
      'vue/custom-event-name-casing': 'off',
      // v-html используется намеренно для SVG-иконок и markdown-контента
      'vue/no-v-html': 'off',
    },
  },
);
