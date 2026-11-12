import { kernelLanguages } from "@/plugins/notebook/languages";
import { nodejs } from "./node";

// The language of this plugin, offered to the Notebook while the plugin is installed.
kernelLanguages.contribute("notebook-node", nodejs);
