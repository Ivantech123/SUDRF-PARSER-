/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        mono: ['"Space Mono"', "monospace"],
        display: ['"Anton SC"', "sans-serif"],
      },
      colors: {
        ink: "#000000",
        bone: "#f5f5f0",
      },
    },
  },
  plugins: [],
};
