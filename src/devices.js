// -----------------------------------------------------------------------------
// From the declared device list to Gladys devices, and back.
//
// One Gladys device per entry of the `devices` field. Its external id is
// built from the entry `key` (see config.js): the radio id of a sensor or of
// an addressed actuator, the channel of a relay that only listens to Gladys.
// External ids are forever: Gladys keys the history, the scenes and the
// dashboards on them.
// -----------------------------------------------------------------------------

import { DEVICE_TRANSPORTS } from '@gladysassistant/integration-sdk';

export const DEVICE_TYPE = 'enocean';

/** The external ids of one declared device. */
export function deviceIds(gladys, device) {
  return gladys.externalIds(DEVICE_TYPE, device.key);
}

/** The discovery payload of one declared device. */
export function buildDevice(gladys, device) {
  const ids = deviceIds(gladys, device);
  return {
    name: device.name,
    external_id: ids.device,
    features: device.profile.features(device).map(({ key, ...feature }) => ({
      ...feature,
      external_id: ids.feature(key),
    })),
  };
}

export function buildDiscoveredDevices(gladys, devices) {
  return devices.map((device) => buildDevice(gladys, device));
}

/** The declared device a Gladys device stands for, or null. */
export function findDevice(gladys, devices, externalId) {
  return devices.find((device) => deviceIds(gladys, device).device === externalId) ?? null;
}

/** The feature key (as in eep.js) of a feature external id. */
export function featureKey(gladys, device, featureExternalId) {
  const prefix = `${deviceIds(gladys, device).device}:`;
  return featureExternalId.startsWith(prefix) ? featureExternalId.slice(prefix.length) : null;
}

/**
 * The transport badge of every device: everything goes through the one
 * gateway, so every device is local while it is connected, unreachable
 * otherwise.
 */
export function buildTransportEntries(gladys, devices, gatewayConnected) {
  const transport = gatewayConnected ? DEVICE_TRANSPORTS.LOCAL : DEVICE_TRANSPORTS.UNREACHABLE;
  return devices.map((device) => ({ external_id: deviceIds(gladys, device).device, transport }));
}
