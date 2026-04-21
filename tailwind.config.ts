import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './lib/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        cream: '#F5EDDC',
        creamLight: '#FAF4E6',
        creamEdge: '#E5DAC3',
        green: '#0F5132',
        greenDeep: '#0A3A23',
        gold: '#C8A04B',
        goldSoft: '#E8D5A8',
        burgundy: '#8B2635',
        ink: '#1A1F1A',
        inkSoft: '#5B6155',
        stone: '#A89D85',
      },
      fontFamily: {
        display: ['Fraunces', 'Georgia', 'serif'],
        mono: ['JetBrains Mono', 'Menlo', 'monospace'],
      },
      maxWidth: {
        mobile: '480px',
      },
    },
  },
  plugins: [],
};

export default config;
