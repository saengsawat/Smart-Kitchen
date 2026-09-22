/**
 * Metro (Expo's bundler) resolves a static asset import to a numeric module
 * id at bundle time. TypeScript has no built-in knowledge of that, so this
 * ambient declaration types `import x from "./file.ttf"` the same way
 * `expo-font`'s `useFonts` expects to receive it.
 */
declare module "*.ttf" {
  const value: number;
  export default value;
}
