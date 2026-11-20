# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) and to human contributors
working in this repository.

## What this is

A Gladys Assistant **external integration** (Node 22+, ESM, no build step, one runtime
dependency: `@gladysassistant/integration-sdk`) for **EnOcean** devices, through an ESP3
gateway (USB 300, TCM 310...) that ser2net shares as a raw TCP port. Requires Gladys
5.3+ (`keywords`, `countries`). Started from the official JavaScript template; CI and
release workflows are the same as `prohand/gladys-devmel`.

The container sees no USB device: the gateway is **always** reached over TCP.

## Commands

```bash
npm install
npm test                                  # node --test (built-in runner)
node --test test/eep.test.js              # one file
node --test --test-name-pattern "rocker"  # tests whose name matches
npm run lint                              # eslint .
npm run format:check                      # prettier --check . (CI gate)
npm run format                            # prettier --write .
npx github:GladysAssistant/integration-store --skip-image-check .   # store checks
```

CI runs `format:check`, `lint` and `test` on Node 22 and 24; pull requests also run
the store checks and build the image. Run the three commands before pushing.

## Architecture

```
index.js                     SDK wiring only, handlers registered before connect()
src/config.js                DEFAULT_CONFIG (mirrors the manifest) + the device list parser
src/runtime.js               telegram -> states / scene events; Gladys order -> telegrams; learn mode
src/devices.js               declared device -> Gladys device (external ids, transport badges)
src/actions.js               Configuration screen buttons (manifest `actions`)
src/capabilities/scenes.js   scene actions (manifest `scene_actions`)
src/capabilities/widget.js   "EnOcean radio" widget (manifest `widgets`)
src/enocean/esp3.js          ESP3 framing, CRC8, stream parser
src/enocean/telegram.js      ERP1 telegrams, ids, teach-in (4BS, 1BS, UTE)
src/enocean/eep.js           profiles: decode telegrams, build commands, features
src/enocean/gateway.js       TCP connection, reconnection, one request at a time
src/enocean/heard.js         emitters heard, for "Devices heard" and the widget
src/enocean/rocker.js        press/release -> click / long click
src/i18n.js, src/logging.js  en/fr/de/es helpers, debug switch
docs/{en,fr,de,es}.md        user documentation, re-hosted by Gladys (mandatory)
```

### Invariants worth knowing

- **External ids are forever.** A device is keyed on its EnOcean `id` (sensors and
  addressed D2-01 actuators, `-io<n>` suffix for outputs > 0) or on its `channel`
  (`ch<n>`, actuators that only listen to Gladys). Changing that rule orphans every
  device. Manifest keys (config, actions, triggers, scene actions, widget, feature
  keys like `ao`/`ai`/`bo`/`bi`) are stored by users too.
- **Every feature carries `name`, `min`, `max`, `read_only`, `has_feedback`** (Gladys
  stores them NOT NULL). `test/eep.test.js` checks every profile.
- **One ESP3 request in flight**: the module answers every packet in order;
  `gateway.js` queues them. A radio telegram is sent from `base id + channel`.
- **F6-02-01 is two profiles**: a rocker Gladys listens to (`id`, no `channel`) or a
  virtual rocker Gladys presses (`channel`). `findProfile` decides on the channel.
- **Rocker buttons**: O is the upper side (Eltako: top = on, confirmations 0x70 on /
  0x50 off). A release can be lost: the press counts as long after 5 s.
- **Gladys' opening sensor reads 1 as closed**, like D5-00-01.
- **UTE teach-in** (D2-01) is answered only in learn mode or for a declared id.
- No polling: EnOcean devices push. The D2-01 actuators are asked their state when
  the gateway connects.
- Never log a token or a password. The ser2net port has no authentication: say so in
  docs, never weaken it.
- The container rootfs is read-only: write only under `/data` (nothing does today).

## Rules

- **Versions belong to the Release workflow** (Actions → Release): never edit
  `version` in `package.json` / the manifest, nor the `docker_image` tag, by hand.
  `test/manifest.test.js` checks they agree.
- **Changelog**: every user-visible change adds a line under `## [Unreleased]` in
  `CHANGELOG.md` (`Added`, `Changed`, `Fixed`, `Removed`, `Security`). Never write a
  version heading.
- **Manifest**: every `label`, `description` and `placeholder` is `{ en, fr, de, es }`;
  the catalog description holds 10-100 characters per language; `gladys_version` stays
  `>=5.3.0` while `keywords` / `countries` are declared. `test/manifest.test.js` ties
  the manifest to the code: change both sides together.
- **User-facing text** is written in English, French, German and Spanish (messages,
  manifest, `docs/*.md`), kept in sync.
- **Style**: Prettier formats, ESLint catches mistakes. Comments explain why, in
  English. Tests never touch the network: `test/helpers/fakes.js` fakes the module
  and the gateway, the SDK's `createFakeGladys()` fakes Gladys.
