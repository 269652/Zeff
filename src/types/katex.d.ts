// KaTeX ships no types (and @types/katex is a dependency more); the one function Zeff uses.
declare module "katex" {
  type Options = { displayMode?: boolean; throwOnError?: boolean; trust?: boolean; strict?: boolean | "ignore" | "warn" | "error"; output?: "html" | "mathml" | "htmlAndMathml" };
  const katex: { renderToString(tex: string, options?: Options): string };
  export default katex;
}
