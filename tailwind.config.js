/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./_pages/**/*.html",
    "./_includes/**/*.html",
    "./_layouts/**/*.html",
    "./_posts/*.md",
    "./_drafts/*.md",
    "./*.md",
    "./*.html",
  ],
  darkMode: "media",
  theme: {
    fontFamily: {
      sans: ["IBM Plex Sans"],
      mono: ["Iosevka Custom Web"],
    },
    extend: {},
  },
  plugins: ["@tailwindcss/typography"],
};
