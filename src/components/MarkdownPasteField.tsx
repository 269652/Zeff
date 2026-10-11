"use client";

import { useState } from "react";
import { isRemoteImage } from "@/lib/contexts-shared";
import { htmlToMarkdown } from "@/lib/html-to-markdown";
import { imageTargets } from "@/lib/markdown";
import { useT } from "@/components/I18nProvider";
import { Markdown } from "./Markdown";

/** An image pasted into the message, kept until the form is saved (then stored as a file). */
export type PastedImage = { token: string; file: File; url: string };

/** A fresh token for a pasted image's ![…](paste:token) reference. */
export const pasteToken = () => Math.random().toString(36).slice(2, 10);

/** Base64 data as a File. */
export function base64File(data: string, name: string, mime: string): File {
  const bin = atob(data);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new File([bytes], name, { type: mime });
}

/** A data: image as a File, or null. */
function dataUrlFile(src: string): File | null {
  const m = /^data:(image\/[\w.+-]+);base64,(.*)$/i.exec(src);
  if (!m) return null;
  try {
    return base64File(m[2], "image", m[1]);
  } catch {
    return null;
  }
}

/**
 * The message, in Markdown. Pasting formatted text (Teams, Jira, Outlook, GitLab, a web page)
 * turns it into Markdown — lists, bold, links, headings stay; pasted pictures (screenshots,
 * images in the paste) are kept as `![image](paste:…)` until saved, when they become the
 * item's files. Pictures that come as links are handed to `onRemoteImages` to be fetched.
 * Preview shows it as it will look.
 */
export function MarkdownPasteField({
  id,
  name,
  value,
  onChange,
  pasted,
  onPasted,
  onRemoteImages,
}: {
  id: string;
  name: string;
  value: string;
  onChange: (v: string) => void;
  pasted: PastedImage[];
  onPasted: (images: PastedImage[]) => void;
  /** Pictures pasted as links (http/https), as they stand in the message. */
  onRemoteImages?: (urls: string[]) => void;
}) {
  const t = useT();
  const [preview, setPreview] = useState(false);

  const show = (target: string) => {
    if (target.startsWith("paste:")) return pasted.find((p) => `paste:${p.token}` === target)?.url ?? null;
    if (/^attachment:\d+$/.test(target)) return `/api/contexts/files/${target.slice(11)}`;
    return /^https?:/i.test(target) ? target : null;
  };

  const onPaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const dt = e.clipboardData;
    const html = dt.getData("text/html");
    const files = [...dt.files].filter((f) => f.type.startsWith("image/"));
    const linked = (md: string) => imageTargets(md).filter(isRemoteImage);
    if (!html && !files.length) {
      // Plain text: the browser pastes it — Markdown pictures with web addresses in it get fetched.
      const urls = linked(dt.getData("text/plain"));
      if (urls.length) onRemoteImages?.(urls);
      return;
    }
    const added: PastedImage[] = [];
    const keep = (file: File) => {
      const token = pasteToken();
      const ext = ((file.type.split("/")[1] || "png").replace("jpeg", "jpg").match(/^[a-z0-9]+/) ?? ["png"])[0];
      const named = new File([file], `pasted-${token}.${ext}`, { type: file.type });
      added.push({ token, file: named, url: URL.createObjectURL(named) });
      return `paste:${token}`;
    };
    let md: string;
    if (html) {
      let next = 0;
      md = htmlToMarkdown(html, ({ src }) => {
        if (/^data:image\//i.test(src)) {
          const f = dataUrlFile(src);
          return f ? keep(f) : null;
        }
        if (next < files.length) return keep(files[next++]); // the clipboard's own copy of the picture
        return /^https?:/i.test(src) ? src : null;
      });
      for (; next < files.length; next++) md += `\n\n![image](${keep(files[next])})`;
    } else {
      md = files.map((f) => `![image](${keep(f)})`).join("\n\n");
    }
    if (!md.trim()) return;
    e.preventDefault();
    const ta = e.currentTarget;
    const start = ta.selectionStart;
    const before = value.slice(0, start);
    const after = value.slice(ta.selectionEnd);
    // Lists, images, several lines: their own block, on lines of their own.
    const block = md.includes("\n") || /^(!\[|\s*([*+-]|\d+\.)\s|#{1,6}\s|>)/.test(md);
    const pre = block && before && !before.endsWith("\n\n") ? (before.endsWith("\n") ? "\n" : "\n\n") : "";
    const post = block && after && !after.startsWith("\n") ? "\n\n" : "";
    const insert = pre + md + post;
    onChange(before + insert + after);
    if (added.length) onPasted(added);
    const urls = linked(md);
    if (urls.length) onRemoteImages?.(urls);
    requestAnimationFrame(() => {
      ta.selectionStart = ta.selectionEnd = start + insert.length;
    });
  };

  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2">
        <label className="label mb-0" htmlFor={id}>
          {t("Message")}
        </label>
        <span
          className="ml-auto cursor-help text-xs text-zinc-400"
          title={t("**bold**, *italic*, * lists, [links](https://…) — pasted formatting and pictures are converted")}
        >
          Markdown
        </span>
        <div className="flex rounded-md border border-zinc-200 p-0.5 text-xs dark:border-zinc-700" role="tablist">
          {(["Write", "Preview"] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={(tab === "Preview") === preview}
              onClick={() => setPreview(tab === "Preview")}
              className={`rounded px-2 py-0.5 ${(tab === "Preview") === preview ? "bg-zinc-200 font-medium dark:bg-zinc-700" : "text-zinc-500"}`}
            >
              {tab === "Preview" ? t("Preview") : t("Write")}
            </button>
          ))}
        </div>
      </div>
      <textarea
        id={id}
        name={name}
        rows={6}
        className={`input font-mono text-[13px] ${preview ? "hidden" : ""}`}
        placeholder={t("Paste what your colleague wrote — formatting and pictures from Teams, Jira or Outlook are kept")}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onPaste={onPaste}
      />
      {preview && (
        <div className="min-h-24 rounded-md border border-zinc-200 p-3 dark:border-zinc-700">
          {value.trim() ? <Markdown text={value} image={show} /> : <p className="text-sm text-zinc-400">{t("Nothing to preview.")}</p>}
        </div>
      )}
    </div>
  );
}
