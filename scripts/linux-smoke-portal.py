#!/usr/bin/env python3
"""Minimal XDG portal used by the packaged Linux runtime smoke.

Electron 42's Chromium runtime initializes the portal at startup to read the
desktop color scheme. ubuntu-latest currently ships a portal older than the
host Registry API that Chromium expects, so using the runner's ambient service
adds unrelated warnings to the packaged-app evidence. This service implements
only the standards-based interfaces the smoke actually consumes.
"""

from __future__ import annotations

import argparse
import signal

import dbus
import dbus.service
from dbus.mainloop.glib import DBusGMainLoop
from gi.repository import GLib


PORTAL_BUS_NAME = "org.freedesktop.portal.Desktop"
PORTAL_OBJECT_PATH = "/org/freedesktop/portal/desktop"
PROPERTIES_INTERFACE = "org.freedesktop.DBus.Properties"
REGISTRY_INTERFACE = "org.freedesktop.host.portal.Registry"
SETTINGS_INTERFACE = "org.freedesktop.portal.Settings"
FILE_CHOOSER_INTERFACE = "org.freedesktop.portal.FileChooser"
APPEARANCE_NAMESPACE = "org.freedesktop.appearance"
COLOR_SCHEME_KEY = "color-scheme"
CONTRACT_OK_LINE = "[linux-smoke-portal] contract OK"


class SmokePortal(dbus.service.Object):
    """Deterministic portal contract for Electron startup, not a UI backend."""

    def __init__(self, bus: dbus.bus.BusConnection) -> None:
        super().__init__(bus, PORTAL_OBJECT_PATH)
        self._registered_senders: set[str] = set()

    @dbus.service.method(
        REGISTRY_INTERFACE,
        in_signature="sa{sv}",
        out_signature="",
        sender_keyword="sender",
    )
    def Register(
        self,
        _app_id: str,
        _options: dict[str, object],
        sender: str | None = None,
    ) -> None:
        if sender is None:
            raise dbus.exceptions.DBusException(
                "The smoke portal could not identify the registering client",
                name="org.freedesktop.DBus.Error.InvalidArgs",
            )
        if sender in self._registered_senders:
            raise dbus.exceptions.DBusException(
                "The smoke client is already registered",
                name="org.freedesktop.portal.Error.Exists",
            )
        self._registered_senders.add(sender)

    @dbus.service.method(
        SETTINGS_INTERFACE,
        in_signature="ss",
        out_signature="v",
    )
    def Read(self, namespace: str, key: str) -> dbus.UInt32:
        if namespace == APPEARANCE_NAMESPACE and key == COLOR_SCHEME_KEY:
            # Settings.Read is a historical protocol exception: although its
            # declared output is `v`, the value is returned inside a second
            # variant. Chromium unwraps both layers before reading the uint32.
            return dbus.UInt32(0, variant_level=2)
        raise dbus.exceptions.DBusException(
            f"Unsupported smoke setting: {namespace}.{key}",
            name="org.freedesktop.portal.Error.NotFound",
        )

    @dbus.service.method(
        SETTINGS_INTERFACE,
        in_signature="as",
        out_signature="a{sa{sv}}",
    )
    def ReadAll(self, namespaces: list[str]) -> dict[str, dict[str, dbus.UInt32]]:
        if not namespaces or APPEARANCE_NAMESPACE in namespaces:
            return {
                APPEARANCE_NAMESPACE: {
                    COLOR_SCHEME_KEY: dbus.UInt32(0, variant_level=1)
                }
            }
        return {}

    @dbus.service.signal(SETTINGS_INTERFACE, signature="ssv")
    def SettingChanged(self, _namespace: str, _key: str, _value: object) -> None:
        pass

    @dbus.service.method(
        PROPERTIES_INTERFACE,
        in_signature="ss",
        out_signature="v",
    )
    def Get(self, interface: str, property_name: str) -> dbus.UInt32:
        versions = {
            REGISTRY_INTERFACE: 1,
            SETTINGS_INTERFACE: 1,
            FILE_CHOOSER_INTERFACE: 3,
        }
        if property_name == "version" and interface in versions:
            return dbus.UInt32(versions[interface], variant_level=1)
        raise dbus.exceptions.DBusException(
            f"Unknown smoke portal property: {interface}.{property_name}",
            name="org.freedesktop.DBus.Error.UnknownProperty",
        )

    @dbus.service.method(
        PROPERTIES_INTERFACE,
        in_signature="s",
        out_signature="a{sv}",
    )
    def GetAll(self, interface: str) -> dict[str, dbus.UInt32]:
        versions = {
            REGISTRY_INTERFACE: 1,
            SETTINGS_INTERFACE: 1,
            FILE_CHOOSER_INTERFACE: 3,
        }
        if interface in versions:
            return {"version": dbus.UInt32(versions[interface], variant_level=1)}
        return {}

    @dbus.service.method(
        PROPERTIES_INTERFACE,
        in_signature="ssv",
        out_signature="",
    )
    def Set(self, interface: str, property_name: str, _value: object) -> None:
        raise dbus.exceptions.DBusException(
            f"Smoke portal property is read-only: {interface}.{property_name}",
            name="org.freedesktop.DBus.Error.PropertyReadOnly",
        )


def verify_contract() -> None:
    """Prove the wire-level shapes consumed by Chromium before launching it."""

    bus = dbus.SessionBus()
    portal = bus.get_object(PORTAL_BUS_NAME, PORTAL_OBJECT_PATH)
    settings = dbus.Interface(portal, SETTINGS_INTERFACE)
    properties = dbus.Interface(portal, PROPERTIES_INTERFACE)
    registry = dbus.Interface(portal, REGISTRY_INTERFACE)

    color_scheme = settings.Read(APPEARANCE_NAMESPACE, COLOR_SCHEME_KEY)
    if not isinstance(color_scheme, dbus.UInt32) or color_scheme.variant_level != 2:
        raise RuntimeError(
            "Settings.Read must return uint32 inside two variants; "
            f"received {type(color_scheme).__name__} at level "
            f"{getattr(color_scheme, 'variant_level', None)}"
        )

    all_settings = settings.ReadAll([APPEARANCE_NAMESPACE])
    read_all_color_scheme = all_settings[APPEARANCE_NAMESPACE][COLOR_SCHEME_KEY]
    if (
        not isinstance(read_all_color_scheme, dbus.UInt32)
        or read_all_color_scheme.variant_level != 1
    ):
        raise RuntimeError(
            "Settings.ReadAll values must use one variant layer; "
            f"received {type(read_all_color_scheme).__name__} at level "
            f"{getattr(read_all_color_scheme, 'variant_level', None)}"
        )

    settings_version = properties.Get(SETTINGS_INTERFACE, "version")
    if not isinstance(settings_version, dbus.UInt32) or settings_version.variant_level != 1:
        raise RuntimeError(
            "Properties.Get must return uint32 inside one variant; "
            f"received {type(settings_version).__name__} at level "
            f"{getattr(settings_version, 'variant_level', None)}"
        )

    registry.Register(
        "org.puntovivo.SmokeContract",
        dbus.Dictionary({}, signature="sv"),
    )
    print(CONTRACT_OK_LINE, flush=True)


def serve() -> None:
    DBusGMainLoop(set_as_default=True)
    bus = dbus.SessionBus()
    bus_name = dbus.service.BusName(
        PORTAL_BUS_NAME,
        bus=bus,
        allow_replacement=False,
        replace_existing=False,
        do_not_queue=True,
    )
    portal = SmokePortal(bus)
    loop = GLib.MainLoop()

    def stop(_signum: int, _frame: object) -> None:
        GLib.idle_add(loop.quit)

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    print("[linux-smoke-portal] ready", flush=True)
    loop.run()

    # Keep the D-Bus objects alive through the last loop iteration.
    _ = (bus_name, portal)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--verify-contract",
        action="store_true",
        help="verify the running smoke portal's wire-level D-Bus contract",
    )
    args = parser.parse_args()

    if args.verify_contract:
        verify_contract()
        return
    serve()


if __name__ == "__main__":
    main()
