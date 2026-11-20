# EnOcean for Gladys Assistant

External integration for [Gladys Assistant](https://gladysassistant.com) that connects
EnOcean devices — battery-free switches, temperature, humidity, CO2, occupancy and light
sensors, contacts, window handles, relays and dimmers — through an **ESP3 gateway**
(EnOcean USB 300, TCM 310...) shared on the network by **ser2net**.

- **Transport**: local only (the radio never leaves your network).
- **Requires**: Gladys 5.3 or later.
- **Languages**: English, French, German, Spanish.

User documentation: [English](docs/en.md) · [Français](docs/fr.md) ·
[Deutsch](docs/de.md) · [Español](docs/es.md).

## How it works

```
EnOcean devices ))) USB 300 ── ser2net (raw TCP, 57600 8N1) ── LAN ── Gladys container
```

The integration runs in a sandboxed container that sees no USB device, so the stick is
shared as a TCP port by ser2net, on the Gladys host or on any machine closer to the
devices. The integration speaks ESP3 over that socket, and reconnects on its own.

## Features

| Surface          | What                                                                                        |
| ---------------- | ------------------------------------------------------------------------------------------- |
| Sensors          | A5-02 (temperature), A5-04, A5-06, A5-07, A5-09-04, D5-00-01, F6-10-00, F6-02 (rockers)     |
| Actuators        | F6-02-01 virtual rocker relays, A5-38-08 (Eltako), D2-01 switches and dimmers (UTE pairing) |
| Configuration    | Test the connection, Devices heard (lines to paste), Open the learn mode, Pair an actuator  |
| Scene triggers   | Switch pressed, window handle turned, unknown device heard, gateway lost                    |
| Scene actions    | Press a virtual switch, send a teach-in                                                     |
| Dashboard widget | "EnOcean radio": gateway, base id, learn mode, last devices heard                           |
| Transport badge  | `local` while the gateway is connected, `unreachable` otherwise                             |
| Countries        | Declared for the 868 MHz European markets plus US and CA (902 MHz sticks)                   |

## Quick start

1. Share the stick with ser2net (`/etc/ser2net.yaml`):

   ```yaml
   connection: &enocean
     accepter: tcp,9999
     enable: on
     options:
       kickolduser: true
     connector: serialdev,/dev/serial/by-id/usb-EnOcean_GmbH_EnOcean_USB_300_DC_XXXXXXXX-if00-port0,57600n81,local
   ```

2. Install the integration from the Gladys store, fill in the host and port of
   ser2net, press **Test the connection**.
3. Open the learn mode, press the button of each device, then **Devices heard**: paste
   the lines into the **Devices** field, rename, save, and add the devices from
   **Discovery**.

## Development

```bash
npm install
npm test               # node --test, no network, no hardware
npm run lint           # ESLint
npm run format:check   # Prettier, as the CI runs it
```

Run it against a real Gladys:

```bash
GLADYS_HOST_API_URL="http://localhost:1443" \
GLADYS_INTEGRATION_TOKEN="<token>" \
GLADYS_INTEGRATION_SELECTOR="enocean" \
LOG_LEVEL=debug \
npm start
```

Project rules for contributors and coding assistants: [CLAUDE.md](CLAUDE.md).

## Release

Describe the change under `## [Unreleased]` in [CHANGELOG.md](CHANGELOG.md), then run
**Actions → Release** and pick `patch`, `minor` or `major`. The workflow bumps
`package.json` and the manifest, tags `vX.Y.Z`, builds the `linux/amd64` +
`linux/arm64` image to `ghcr.io/prohand/gladys-enocean`, publishes the GitHub Release
and runs the store admission checks.

Before the first release: add the GitHub topic `gladys-assistant-integration`, make the
`ghcr.io` package public, and turn on **Private vulnerability reporting**
([SECURITY.md](SECURITY.md)).

## License

Apache-2.0
