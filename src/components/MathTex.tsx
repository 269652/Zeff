import katex from "katex";
import "katex/dist/katex.min.css";

/**
 * A TeX formula, typeset by KaTeX (inline, or displayed on its own line). KaTeX's own HTML — `trust` off, so no links,
 * classes or styles from the formula; a formula it can't read is shown as written, in red.
 */
export function MathTex({ tex, display = false }: { tex: string; display?: boolean }) {
  const html = katex.renderToString(tex, { displayMode: display, throwOnError: false, trust: false, strict: "ignore", output: "htmlAndMathml" });
  return display ? (
    <div className="overflow-x-auto overflow-y-hidden py-1" dangerouslySetInnerHTML={{ __html: html }} />
  ) : (
    <span dangerouslySetInnerHTML={{ __html: html }} />
  );
}
