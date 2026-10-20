import { documentTexts } from "@/plugins/documents/text-point";
import { statementNote } from "./statement";

/** What Revolut registers for other plugins (loaded through plugins/contributions): a statement among the documents is a note, not its bookings. */
documentTexts.contribute("revolut", statementNote);
