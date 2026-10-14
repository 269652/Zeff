# App automation: adapters, contracts, self-test

Zeff reads WhatsApp Web (in the automation Chrome) and Signal Desktop (over its debug port) from the
inside. Neither promises a stable interface, so the drivers are built so that **an update of the app is
fixed in a data file**, not in the code that reads the messages.

```
src/plugins/<app>/
  driver.mjs      MCP tools (status, selftest, messages, chats, history, send) and result shaping
  adapter.mjs     everything that knows the app's insides: the functions that run IN the app
  contract.json   what the adapter expects of the app (the part that changes)
scripts/automation/
  probe.mjs       runs in the app: finds modules/globals/selectors by name, else by what they can do
  contract.mjs    loads contract.json + the override file, builds the self-test report
  mcp-stdio.mjs   the stdio MCP loop the drivers share
```

## The contract

`contract.json` is data. Sections (all optional):

| Section     | Meaning |
|-------------|---------|
| `modules`   | Members of the app's module registry (WhatsApp Web's `require`): `names` (known names), `has` (members the module must have, `"loadEarlierMsgs:function"`), `optional` |
| `globals`   | Values on the global object (Signal): `paths` (first is the current one, others alternatives), `type`, `has`, `optional` |
| `states`    | A state object (Signal's redux): `from` (a function path), `has` |
| `paths`     | Alternative paths of one value, e.g. which chat is open (Signal 8 moved it) |
| `selectors` | DOM: `any` (CSS alternatives, joined with a comma), `optional`, `transient` (only there in some states: the QR code), `when` (needs another selector) |
| `texts`     | Words or patterns the app's interface shows (regex sources, any language) |

### How a module is found

1. By its known **name** (`require("WAWebChatLoadMessages")`) — exact and cheap.
2. If that fails or the module lacks the wanted members: the registry (`require("__debug").modulesMap`)
   is scanned for a module that **has** the members. Only already-initialised modules are looked at, so
   nothing is run; it takes ~300 ms.

A module found by 2 still works, and is reported as **drift**: the contract wants an update (put the new
name first in `names`). A module found by neither is a **failure**.

## After an update of WhatsApp Web / Signal Desktop

1. Run the self-test (read-only; types and counts only, never a name or a text):
   `whatsapp_selftest` / `signal_selftest` (MCP tools of the drivers — any MCP client calls them), or
   look at the login status on the Connections page.
2. The report says, per item, `ok`, `drift` (works through a fallback), `warn` (optional, missing),
   `fail` (breaks a sync) or `skip` (only in some states), with what it found instead.
3. Fix `contract.json` — or, for a quick fix without a new Zeff, put the changed entries in
   `data/automation/<app>.json` (the folder of `ZEFF_AUTOMATION_DIR`). It is merged over the defaults,
   id by id; `null` removes an entry:

   ```json
   {
     "modules": { "load": { "names": ["WAWebChatLoadMessagesV2", "WAWebChatLoadMessages"], "has": ["loadEarlierMsgs:function"] } },
     "selectors": { "rowTick": null }
   }
   ```
4. Run the self-test again.

`whatsapp_status` / `signal_status` run the same check when the app is linked: a drift shows up in the
login status (Connections page) before it breaks a sync.

A change of what the app's data **looks like** (a field renamed on a chat or message) is not a contract
entry: it is code in `adapter.mjs`. The self-test's `data` checks (types of the fields the readers use)
name the field, so the fix is small.

## Not a DSL

The contract says *what is expected*, the adapter says *what to do with it*. A DSL for the steps
(paginate, wait for unread loads, fall back) would end up as a worse JavaScript; the parts that change
with the apps are the names, and those are data.

## Tests

`tests/automation-probe.test.ts` (probe, contract merge, MCP loop) and `tests/automation-adapters.test.ts`
(the adapters' real in-page functions against a fake WhatsApp Web / Signal Desktop: renamed module found
by scan, moved state path, broken shape reported by name). To keep a real app's shape as a fixture, take
the types from the self-test report and build the fake from them.
