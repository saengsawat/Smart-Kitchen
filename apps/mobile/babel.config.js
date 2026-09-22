// Standard Expo Babel config. babel-preset-expo already includes expo-router's
// Babel plugin (file-based routing needs no separate plugin entry here).
module.exports = function (api) {
  api.cache(true);
  return {
    presets: ["babel-preset-expo"],
  };
};
