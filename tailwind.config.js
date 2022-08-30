/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./_drafts/**/*.html",
    "./_includes/**/*.html",
    "./_layouts/**/*.html",
    "./_posts/*.md",
    "./*.md",
    "./*.html",
  ],
  theme: {
    fontFamily: {
      sans: ["IBM Plex Sans"],
    },
    extend: {},
  },
  plugins: ["@tailwindcss/typography"],
};
