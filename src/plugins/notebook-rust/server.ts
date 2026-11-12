import { kernelLanguages } from "@/plugins/notebook/languages";
import { rust } from "./rust-kernel";

// The language of this plugin, offered to the Notebook while the plugin is installed.
kernelLanguages.contribute("notebook-rust", rust);
