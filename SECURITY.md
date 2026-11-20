# Security policy

## Supported versions

Only the latest release of the EnOcean integration receives security fixes.
Update the integration from the Gladys store before reporting an issue.

| Version      | Supported |
| ------------ | --------- |
| 1.x (latest) | Yes       |
| older        | No        |

## Reporting a vulnerability

Please do **not** open a public issue for a security problem.

Report it privately through GitHub: open the **Security** tab of
[prohand/gladys-enocean](https://github.com/prohand/gladys-enocean/security), then
**Report a vulnerability**.

No such button? Private reporting is not enabled yet: open an issue that only asks
the maintainers for a private contact, without any detail of the problem.

Include, when you can:

- the version of the integration and of Gladys;
- what an attacker can do, and the steps to reproduce it;
- any log line that helps (remove tokens, passwords and addresses first).

You should get a first answer within 7 days. A fix is released as a new version of
the integration, and the advisory is published once users can update.

## Scope

In scope: the code of this repository and the Docker image it publishes.

Out of scope: Gladys Assistant itself (report to
[GladysAssistant/Gladys](https://github.com/GladysAssistant/Gladys/security)),
ser2net, the EnOcean gateway firmware and the devices.

## Good practices for users

- **The ser2net port has no authentication.** Anyone who reaches it can listen to
  your EnOcean radio and send orders to your actuators. Bind it to one address and
  open it to the Gladys host only (firewall), never to the Internet.
- EnOcean radio telegrams are not encrypted by the profiles this integration
  supports: do not drive locks or alarms with them.
- Keep Gladys, the integration and ser2net up to date.
