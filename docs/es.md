# EnOcean para Gladys Assistant

Esta integración conecta Gladys con los dispositivos EnOcean — interruptores
sin pilas, sensores de temperatura, humedad, CO2, presencia y luminosidad,
contactos de puerta, manillas de ventana, relés y reguladores — mediante una
**pasarela ESP3**: la llave EnOcean USB 300, un módulo TCM 310 o cualquier
pasarela basada en ellos.

## 1. Lo que necesita

- Gladys **5.3 o posterior**.
- Una pasarela ESP3 (USB 300, USB 310, placa TCM 310...) con la frecuencia de
  su país: 868 MHz en Europa, 902 MHz en Norteamérica.
- Una máquina de su red donde conectarla: la propia máquina de Gladys o una
  Raspberry Pi más cerca de los dispositivos.
- **ser2net** en esa máquina.

¿Por qué ser2net? La integración se ejecuta en un contenedor aislado que no ve
los dispositivos USB. ser2net comparte el puerto serie de la llave como puerto
TCP, y la integración se conecta a él. También permite colocar la llave donde
la recepción es mejor, lejos del servidor de Gladys.

## 2. Compartir la llave con ser2net

Instálelo (`apt install ser2net` en Debian, Ubuntu y Raspberry Pi OS) y busque
el nombre estable de la llave:

```bash
ls -l /dev/serial/by-id/
```

ser2net 4 (`/etc/ser2net.yaml`):

```yaml
connection: &enocean
  accepter: tcp,9999
  enable: on
  options:
    kickolduser: true
  connector: serialdev,/dev/serial/by-id/usb-EnOcean_GmbH_EnOcean_USB_300_DC_XXXXXXXX-if00-port0,57600n81,local
```

ser2net 3 (`/etc/ser2net.conf`):

```text
9999:raw:0:/dev/serial/by-id/usb-EnOcean_GmbH_EnOcean_USB_300_DC_XXXXXXXX-if00-port0:57600 8DATABITS NONE 1STOPBIT
```

Después `systemctl restart ser2net`. A tener en cuenta:

- **57600 baudios, 8N1, modo raw** (no telnet): ESP3 es binario.
- **`kickolduser: true`**: el puerto acepta un solo cliente. Cuando la
  integración se reconecta (actualización, reinicio de Gladys), la sesión
  anterior debe ceder su lugar.
- **El puerto no tiene contraseña.** Ábralo solo a la máquina de Gladys:
  vincúlelo a una dirección (`accepter: tcp,192.168.1.50,9999`) y/o fíltrelo
  con su cortafuegos.

## 3. Configurar la integración

En **Integraciones → EnOcean → Configuración**:

| Campo                               | Qué indicar                                                                   |
| ----------------------------------- | ----------------------------------------------------------------------------- |
| Host de la pasarela                 | Dirección IP de la máquina con ser2net. **No 127.0.0.1** (contenedor propio). |
| Puerto TCP de la pasarela           | El puerto de ser2net (9999 arriba).                                           |
| Dispositivos                        | Sus dispositivos, ver abajo.                                                  |
| Avisar de dispositivos desconocidos | Activa «dispositivo desconocido oído». Desactívelo si los vecinos inundan.    |
| Registros detallados (depuración)   | Registra cada telegrama oído. Solo para diagnóstico.                          |

Guarde y pulse **Probar la conexión**: muestra el módulo, su **base id** y
cuántos telegramas se han oído.

## 4. Declarar sus dispositivos

EnOcean no tiene descubrimiento: un sensor dice «soy 0194E3B2», nunca lo que
mide. Cada dispositivo se declara una vez, como lista JSON en el campo
**Dispositivos**:

```json
[
  { "id": "0194E3B2", "eep": "A5-02-05", "name": "Salón" },
  { "id": "FEF1A2B3", "eep": "F6-02-01", "name": "Interruptor entrada" },
  { "id": "01A1B2C3", "eep": "F6-10-00", "name": "Ventana cocina" },
  { "eep": "A5-38-08", "channel": 1, "name": "Regulador cocina", "dimmable": true },
  { "eep": "F6-02-01", "channel": 2, "rocker": "a", "name": "Relé jardín" },
  { "id": "05123456", "eep": "D2-01-12", "channel": 3, "name": "Enchufe" }
]
```

| Clave      | Significado                                                                                          |
| ---------- | ---------------------------------------------------------------------------------------------------- |
| `id`       | El id EnOcean del dispositivo, 8 dígitos hexadecimales (impreso en él). Necesario para lo que emite. |
| `eep`      | Su perfil (EEP), ver la tabla abajo. Figura en su manual.                                            |
| `name`     | El nombre mostrado en Gladys.                                                                        |
| `channel`  | Solo actuadores: el canal de la pasarela (0-127) desde el que emite Gladys. Uno por actuador/grupo.  |
| `dimmable` | `true` para un regulador (A5-38-08, D2-01): añade la luminosidad.                                    |
| `rocker`   | Relés de balancín virtual: `a` (por defecto) o `b`, el lado aprendido por el relé.                   |
| `io`       | D2-01 con varias salidas: el número de la salida (0 = la primera).                                   |

No hace falta leer los id usted mismo: abra el **modo de aprendizaje**, pulse
el botón del dispositivo y luego **Dispositivos oídos**. Muestra las líneas
que hay que pegar, con el perfil cuando el dispositivo lo envía.

Tras guardar, los dispositivos aparecen en **Descubrimiento**: añádalos a
Gladys desde allí.

**Los id son definitivos.** Gladys guarda el historial, las escenas y los
paneles bajo el `id` (sensores, D2-01) o el `channel` (otros actuadores).
Cambiarlos crea un dispositivo nuevo.

## 5. Perfiles compatibles

| EEP                       | Dispositivo                                      | En Gladys                                  |
| ------------------------- | ------------------------------------------------ | ------------------------------------------ |
| A5-02-01 a 1B, 20, 30     | Sensores de temperatura                          | Temperatura                                |
| A5-04-01, A5-04-02        | Sensores de temperatura y humedad                | Temperatura, humedad                       |
| A5-06-01, A5-06-02        | Sensores de luminosidad                          | Luminosidad (lx)                           |
| A5-07-01, 02, 03          | Detectores de presencia (03: con luminosidad)    | Movimiento (+ luminosidad)                 |
| A5-09-04                  | Sensores de CO2                                  | CO2, temperatura, humedad                  |
| D5-00-01                  | Contactos de puerta y ventana                    | Sensor de apertura (1 = cerrado)           |
| F6-10-00                  | Manillas de ventana (Hoppe...)                   | Sensor de apertura + disparador «manilla»  |
| F6-02-01, F6-02-02 + `id` | Interruptores de balancín (PTM 215, Eltako FT55) | 4 botones (clic / clic largo) + disparador |
| F6-02-01 + `channel`      | Relés que aprenden un balancín (Eltako FSR...)   | Interruptor encendido/apagado              |
| A5-38-08 + `channel`      | Relés y reguladores Eltako (orden central)       | Encendido/apagado (+ luminosidad)          |
| D2-01-00 a 14             | Interruptores y reguladores electrónicos (NodOn) | Encendido/apagado (+ luminosidad)          |

Los botones de un interruptor siguen el EEP: `ao` / `ai` para arriba / abajo
del balancín A, `bo` / `bi` para el balancín B. Una pulsación de menos de un
segundo es un clic, una más larga un clic largo.

## 6. Emparejar un actuador

Los actuadores se controlan desde un **canal** de la pasarela: Gladys emite
desde el base id de la pasarela + el canal. El actuador debe aprender ese
emisor una vez.

- **Relé que aprende un balancín (F6-02-01 + channel)** y **orden central
  Eltako (A5-38-08)**: ponga el actuador en posición de aprendizaje (LRN) y
  después en Gladys pulse **Emparejar un actuador** y elíjalo. Vuelva a
  ponerlo en posición de funcionamiento. Añada el `id` del actuador a su
  entrada para que Gladys siga sus confirmaciones (Eltako las envía).
- **D2-01 (NodOn...)**: se emparejan desde su lado. Pulse **Abrir el modo de
  aprendizaje** en Gladys (o el botón del widget) y luego el botón de
  emparejamiento del dispositivo: Gladys responde a su petición desde el canal
  0, o desde el canal ya declarado para su `id`. Declárelo con su `id` y ese
  canal (`0` si aún no estaba declarado).

El base id está grabado en la llave. Conserve la llave: con otra, los
actuadores deben aprender de nuevo el emisor.

## 7. Escenas

Disparadores:

- **Se pulsa un interruptor EnOcean**: filtro por interruptor, botón y
  pulsación (corta, larga). Variables: `device_name`, `button`, `press`,
  `duration_ms`.
- **Se gira una manilla de ventana**: filtro por manilla y posición (cerrada,
  abierta, abatible). Variables: `device_name`, `position`.
- **Se oye un dispositivo EnOcean desconocido**: como máximo una vez por hora
  y dispositivo. Variables: `sender_id`, `eep`, `rorg`, `dbm`, `teach_in`.
- **Se pierde la pasarela EnOcean**: la conexión TCP se cayó (la integración
  reintenta sola). Variables: `address`, `reason`.

Acciones:

- **Pulsar un interruptor EnOcean virtual**: emite una pulsación de balancín
  desde un canal, como un interruptor real. Todo actuador que la haya
  aprendido reacciona — práctico para grupos. Salida: `sent`.
- **Enviar un aprendizaje EnOcean**: el telegrama de aprendizaje de un
  actuador declarado. Salida: `sent`.

## 8. Widget del panel

El widget **Radio EnOcean** muestra el estado de la pasarela, su base id y su
módulo, el modo de aprendizaje y los últimos dispositivos oídos (con su
señal), con los desconocidos señalados. Su botón abre el modo de aprendizaje
durante 60 segundos.

## 9. Diagnóstico

- **«Pasarela inaccesible»**: compruebe desde la máquina de Gladys que el
  puerto responde (`nc -vz 192.168.1.50 9999`), que ser2net funciona y que
  ningún otro programa (otra central domótica) ocupa el puerto.
- **Conectada pero no se oye nada**: velocidad incorrecta (57600), modo telnet
  en vez de raw, o una llave de frecuencia equivocada.
- **Se oye un dispositivo pero nada cambia en Gladys**: `eep` incorrecto en su
  entrada, o el dispositivo no se añadió desde Descubrimiento. Active los
  registros detallados: cada telegrama aparece con su emisor y sus bytes.
- **Un actuador no reacciona**: no ha aprendido el canal (vuelva a
  emparejarlo), o **Probar la conexión** indica un base id desconocido.
- **Alcance de radio**: el hormigón y el metal bloquean los 868 MHz. Mueva la
  llave (un alargador USB ayuda) o añada un repetidor EnOcean.
