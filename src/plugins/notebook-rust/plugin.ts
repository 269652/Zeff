import { definePlugin } from "../define";

/** Notebook · Rust: Rust code blocks that run (its manifest). */
export default definePlugin({
  id: "notebook-rust",
  order: 137,
  name: "Notebook · Rust",
  description:
    "Rust for the Notebook: code blocks in pages run Rust. Each cell is compiled and run (a few seconds); functions, types and imports stay for the cells after it, a last expression is printed. By default in a Docker container (the image rust:1-slim); with this computer's rustc when Docker is not there or you choose so.",
  category: "app",
  defaultInstalled: true,
  requires: "Docker (the default), or rustc on this computer (rustup.rs).",
  dependsOn: ["notebook"],
});
