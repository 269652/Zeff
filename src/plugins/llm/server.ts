import { apiPoint } from "@/lib/plugins/api-point";
import { LLM_API } from "./api";

/** What the LLM plugin registers for other plugins (loaded through plugins/contributions). */
apiPoint.contribute("llm", LLM_API);
