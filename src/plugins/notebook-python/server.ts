import { kernelLanguages } from "@/plugins/notebook/languages";
import { python } from "./python";

// The language of this plugin, offered to the Notebook while the plugin is installed.
kernelLanguages.contribute("notebook-python", python);
