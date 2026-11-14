# Contributing to Zeff

Thank you for wanting to improve Zeff. Bug reports, ideas and pull requests are welcome.

## Before you start

- Open an issue first for anything bigger than a small fix, so we can agree on the approach.
- Development setup, tests and conventions are in the [README](README.md#develop) and [AGENTS.md](AGENTS.md).
- Plugins can often do what you want without touching Zeff's core: see [docs/plugins](docs/plugins/README.md).

## Licence of contributions (Contributor Licence Agreement)

Zeff is dual-licensed under the AGPL-3.0 and a commercial licence (see [LICENSING.md](LICENSING.md)). For that to
stay possible, every contribution needs this agreement. By opening a pull request you confirm it; add this line to the
pull request's description:

> I agree to the Zeff Contributor Licence Agreement in CONTRIBUTING.md.

**The agreement:**

1. You keep the copyright in your contribution.
2. You grant Moritz Roessler (the "Licensor") a perpetual, worldwide, non-exclusive, royalty-free, irrevocable licence
   to use, reproduce, modify, publish, sublicense and distribute your contribution, as part of Zeff or otherwise,
   under the AGPL-3.0, under the Zeff Commercial Licence and under any other licence, including proprietary ones.
3. You grant everyone who receives Zeff a patent licence for your contribution on the terms of section 11 of the
   AGPL-3.0.
4. You confirm that the contribution is your own work, or that you have the right to submit it under these terms, and
   that, if your employer has rights in it, your employer allows you to.
5. The Licensor promises that every version of Zeff that contains your contribution and is published by the Licensor
   will also be available under the AGPL-3.0 or a later version of it.
6. You provide your contribution "as is", without warranty.

## Pull requests

- One topic per pull request, with tests for what changes.
- Keep the text of the interface in English inside `t()`; translations live in the language packs of the zeff-plugins repository
  (`plugins/lang-de/bundle.json`, `plugins/lang-es/bundle.json`) — `npm run i18n` checks them against the code.
- No formatting-only changes to files you don't otherwise touch.
