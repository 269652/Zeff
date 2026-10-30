import { t } from "@/lib/i18n/server";
import { signalAutostart } from "./autostart";
import { SIGNAL_PORT, signalRunning, signalUp } from "./endpoint";
import { SignalButton } from "./SignalButton";
import { setupSignalAutostartAction, startSignalAction } from "./server-actions";

/** Whether Signal Desktop is reachable (its debug port), a button to start it, and its autostart with the port — the inbox's Signal filter shows it. */
export async function SignalStatus() {
  const [up, running, autostart] = await Promise.all([signalUp(), signalRunning(), signalAutostart()]);
  return (
    <section className="space-y-2 rounded border border-zinc-200 p-2 text-xs dark:border-zinc-800" aria-label={t("Signal Desktop")}>
      <p className="flex items-center gap-2">
        <span className={`size-2 shrink-0 rounded-full ${up ? "bg-emerald-500" : running ? "bg-amber-500" : "bg-zinc-400"}`} aria-hidden />
        {up ? t("Signal Desktop is running with its debug port ({port}).", { port: SIGNAL_PORT }) : running ? t("Signal Desktop is running without its debug port — quit it once (tray icon → Quit), then start it here.") : t("Signal Desktop isn't running.")}
      </p>
      {!up && !running && <SignalButton run={startSignalAction} label={t("Start Signal")} busy={t("Starting Signal …")} title={t("Starts Signal Desktop in the tray, with its debug port")} primary />}
      {autostart.supported && (
        <>
          <p className="text-zinc-500">
            {autostart.withPort
              ? t("Autostart: Signal starts with its debug port after every login.")
              : autostart.entry
                ? t("Autostart: Signal starts after login, but without its debug port.")
                : t("Autostart: Signal doesn't start after login.")}
          </p>
          {!autostart.withPort && (
            <SignalButton
              run={setupSignalAutostartAction}
              label={t("Set up autostart with the port")}
              busy={t("Setting up …")}
              title={t("Signal's own autostart entry (Windows) gets the debug port added — Signal writes it anew when you change its tray or autostart setting")}
            />
          )}
        </>
      )}
      <p className="text-zinc-400">{t("The debug port is local only (127.0.0.1) — but any program on this computer could read Signal through it, as with the automation Chrome.")}</p>
    </section>
  );
}
