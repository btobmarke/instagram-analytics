import type { Config } from 'tailwindcss'
import typography from '@tailwindcss/typography'

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        brand: { Default: '#e1306c', dark: '#c41858', light: '#f5527c' },
      },
    },
  },
  plugins: [typography],
}

export default config
