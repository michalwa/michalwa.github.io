module.exports = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
    ...(process.env.JEKYLL_ENV == "production"
      ? { cssnano: { preset: "default" } }
      : {}),
  },
};
