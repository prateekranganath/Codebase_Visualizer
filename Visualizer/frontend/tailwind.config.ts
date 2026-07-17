import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        slate: {
          950: '#05070d',
        },
      },
    },
  },
  plugins: [],
} satisfies Config;
