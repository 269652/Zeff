import { Fragment, type ReactNode } from "react";

/**
 * A translated sentence with markup inside (client- and server-safe): the whole sentence is one key,
 * the marked words are tags — so a language can put the link where its grammar wants it.
 *   rich(t("Working hours are on the <link>Schedule</link> page."), { link: (s) => <Link href="/schedule">{s}</Link> })
 * A tag without a renderer, or one a translation dropped, shows its words plain.
 */
export function rich(text: string, tags: Record<string, (chunk: string) => ReactNode>): ReactNode {
  const out: ReactNode[] = [];
  const re = /<(\w+)>(.*?)<\/\1>/g;
  let at = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > at) out.push(text.slice(at, m.index));
    const render = tags[m[1]];
    out.push(<Fragment key={m.index}>{render ? render(m[2]) : m[2]}</Fragment>);
    at = m.index + m[0].length;
  }
  if (at < text.length) out.push(text.slice(at));
  return out;
}
