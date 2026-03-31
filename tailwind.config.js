/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        parchment: {
          50: '#fdfaf5',
          100: '#faf4e8',
          200: '#f5e9d0',
          300: '#edd9b0',
        },
        ink: {
          DEFAULT: '#1c1917',
          light: '#44403c',
          muted: '#78716c',
        },
        gold: {
          DEFAULT: '#c49a3c',
          light: '#e8c574',
          dark: '#9a7828',
        },
      },
      fontFamily: {
        display: ['"Playfair Display"', 'Georgia', 'serif'],
        reading: ['"Lora"', 'Georgia', 'serif'],
        sans: ['"DM Sans"', 'system-ui', 'sans-serif'],
      },
      typography: {
        DEFAULT: {
          css: {
            fontFamily: '"Lora", Georgia, serif',
          },
        },
      },
    },
  },
  plugins: [],
}
