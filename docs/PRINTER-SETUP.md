# Receipt printer setup

## USB printers on Windows

1. Install the operating system driver appropriate for the printer model.
   Confirm that a Windows test page prints through the correct USB port/queue.
2. In Puntovivo **Company > Devices**, choose **System (OS print dialog)**.
   A device display name does not select or detect an OS printer.
3. In **System printer on this computer**, refresh and select the actual queue.
   The same controls are available in the company's receipt print settings.
   This preference is local to this business on this installation, not synced.
4. Set the driver's paper dimensions to the roll, such as 58 mm, and choose a
   matching receipt template for new sales. Historical reprints retain their
   saved template; changing the default does not rewrite them.
5. Choose **Print a test ticket**, select the printer in the native dialog,
   and inspect the physical output. **Check registration** only checks the
   peripheral record. A successful OS submission does not prove paper emerged.
6. Enable automatic printing if desired. Silent printing uses the explicitly
   selected local queue. Existing profiles without a selection open a dialog;
   missing selected queues fail instead of sending to a different printer.

Cancellation does not schedule a retry. After a failure or timeout, inspect
Windows' queue and the printer before trying again; a late OS completion can
otherwise produce a duplicate. Use **Refresh printers** after reconnecting.

## Network ESC/POS printers

Choose **ESC/POS thermal > Network (TCP)** only for a printer that is actually
reachable over the local network. Enter its real private address and supported
raw-print port (9100–9103). Connecting a USB cable does not supply a TCP address.
No example IP is prefilled. Select 58 or 80 mm to match the physical roll.

Direct USB and serial ESC/POS transports are not implemented. Changing the
advanced JSON to USB or installing a Node dependency does not enable them.
Use the System route and the OS driver for a USB-attached printer.

Changing between System and ESC/POS preserves the automatic-print choice,
removes incompatible fields, and retains the network draft while the form is
open. Saving a changed method invalidates the old test result. Failed tests
show the error details rather than only a failed badge.

## Queue recovery

An ESC/POS failure can have a durable retry queued. It never automatically
opens a second System print. Check **Operations** before deliberately printing
another copy. Switching a queued printer to System leaves a diagnostic dead
letter with the original content; the System registration acknowledgement
cannot complete an ESC/POS job. After correcting ESC/POS, explicitly retry the
same job rather than enqueueing another copy.

## Physical acceptance

Software tests and macOS simulations cannot certify a Windows driver or a
physical printer. Windows 11 with Xprinter XP-58IIIT requires operator acceptance
on a future installed release: Windows test page, named OS queue selection,
58 mm synthetic ticket, complete long text/totals, new receipt and historical
reprint, cancellation, disconnect/reconnect, silent mode, and queue recovery
without duplicate copies. No physical-printer or Windows acceptance is implied
by unit tests, PDF output, intercepted native calls, or CI success.
