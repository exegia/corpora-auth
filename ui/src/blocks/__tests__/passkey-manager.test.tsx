import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { axe } from "vitest-axe";

vi.mock("@exegia/plugin-supabase-auth", () => import("@/test/mocks"));

import { PasskeyManager } from "@/blocks/passkey-manager";
import * as bindings from "@/test/mocks";

const macPasskey = bindings.testPasskey("pk-mac", "iCloud Keychain");
const keyPasskey = bindings.testPasskey("pk-key", "YubiKey 5");

beforeEach(() => {
  bindings.resetAuthMocks();
});

function signedIn(): void {
  bindings.getSession.mockResolvedValue(bindings.testSession);
}

describe("PasskeyManager", () => {
  it("renders a signed-out notice instead of an empty manager", async () => {
    render(<PasskeyManager />);

    expect(
      await screen.findByText(/sign in to manage the passkeys/i),
    ).toBeInTheDocument();
    expect(bindings.listPasskeys).not.toHaveBeenCalled();
  });

  it("renders an unavailable notice when the device cannot run passkeys", async () => {
    signedIn();
    bindings.mockPasskeysUnavailable();
    render(<PasskeyManager />);

    expect(
      await screen.findByText(/aren't available on this device/i),
    ).toBeInTheDocument();
  });

  it("lists passkeys with names and dates", async () => {
    signedIn();
    bindings.listPasskeys.mockResolvedValue([macPasskey, keyPasskey]);
    render(<PasskeyManager />);

    expect(await screen.findByText("iCloud Keychain")).toBeInTheDocument();
    expect(screen.getByText("YubiKey 5")).toBeInTheDocument();
    expect(screen.getAllByText(/added/i).length).toBe(2);
    expect(screen.getAllByText(/last used/i).length).toBe(2);
  });

  it("registers a passkey and opens the rename affordance on the new row", async () => {
    const user = userEvent.setup();
    const onRegistered = vi.fn();
    signedIn();
    bindings.listPasskeys.mockResolvedValue([]);
    // Mirror the real plugin: registration adds the passkey server-side and
    // emits PASSKEYS_CHANGED, which refreshes the list.
    bindings.registerPasskey.mockImplementation(async () => {
      bindings.listPasskeys.mockResolvedValue([macPasskey]);
      queueMicrotask(() => {
        bindings.emitAuthStateChange({
          event: "PASSKEYS_CHANGED",
          session: bindings.testSession,
        });
      });
      return { status: "completed", passkey: macPasskey };
    });
    render(<PasskeyManager onRegistered={onRegistered} />);

    await user.click(
      await screen.findByRole("button", { name: /add a passkey/i }),
    );

    await waitFor(() => {
      expect(onRegistered).toHaveBeenCalledWith(macPasskey);
    });
    // Rename input pre-filled with the server-derived name (research R3).
    expect(
      await screen.findByRole("textbox", { name: /passkey name/i }),
    ).toHaveValue("iCloud Keychain");
  });

  it("stays quiet when registration is cancelled (SC-003)", async () => {
    const user = userEvent.setup();
    signedIn();
    bindings.listPasskeys.mockResolvedValue([]);
    bindings.registerPasskey.mockResolvedValue({ status: "cancelled" });
    render(<PasskeyManager />);

    await user.click(
      await screen.findByRole("button", { name: /add a passkey/i }),
    );

    await waitFor(() => {
      expect(bindings.registerPasskey).toHaveBeenCalled();
    });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("validates rename length before calling the plugin", async () => {
    const user = userEvent.setup();
    signedIn();
    bindings.listPasskeys.mockResolvedValue([macPasskey]);
    render(<PasskeyManager />);

    await user.click(await screen.findByRole("button", { name: /rename/i }));
    const input = await screen.findByRole("textbox", {
      name: /passkey name/i,
    });
    await user.clear(input);
    await user.click(screen.getByRole("button", { name: /save/i }));

    expect(
      await screen.findByText(/between 1 and 120 characters/i),
    ).toBeInTheDocument();
    expect(bindings.renamePasskey).not.toHaveBeenCalled();
  });

  it("renames through the plugin and closes the editor", async () => {
    const user = userEvent.setup();
    signedIn();
    bindings.listPasskeys.mockResolvedValue([macPasskey]);
    bindings.renamePasskey.mockResolvedValue(
      bindings.testPasskey("pk-mac", "Work MacBook"),
    );
    render(<PasskeyManager />);

    await user.click(await screen.findByRole("button", { name: /rename/i }));
    const input = await screen.findByRole("textbox", {
      name: /passkey name/i,
    });
    await user.clear(input);
    await user.type(input, "Work MacBook");
    await user.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => {
      expect(bindings.renamePasskey).toHaveBeenCalledWith({
        passkeyId: "pk-mac",
        friendlyName: "Work MacBook",
      });
    });
    await waitFor(() => {
      expect(
        screen.queryByRole("textbox", { name: /passkey name/i }),
      ).not.toBeInTheDocument();
    });
  });

  it("deletes only after explicit confirmation", async () => {
    const user = userEvent.setup();
    const onDeleted = vi.fn();
    signedIn();
    bindings.listPasskeys.mockResolvedValue([macPasskey, keyPasskey]);
    render(<PasskeyManager onDeleted={onDeleted} />);

    await user.click(
      await screen.findByRole("button", { name: "Delete iCloud Keychain" }),
    );
    expect(bindings.deletePasskey).not.toHaveBeenCalled();

    const dialog = await screen.findByRole("alertdialog");
    // Two passkeys — no last-passkey warning.
    expect(
      within(dialog).queryByText(/last passkey/i),
    ).not.toBeInTheDocument();

    await user.click(
      within(dialog).getByRole("button", { name: /delete passkey/i }),
    );
    await waitFor(() => {
      expect(bindings.deletePasskey).toHaveBeenCalledWith({
        passkeyId: "pk-mac",
      });
    });
    expect(onDeleted).toHaveBeenCalledWith("pk-mac");
  });

  it("warns when deleting the last passkey but allows it (US3-AS4)", async () => {
    const user = userEvent.setup();
    signedIn();
    bindings.listPasskeys.mockResolvedValue([macPasskey]);
    render(<PasskeyManager />);

    await user.click(
      await screen.findByRole("button", { name: "Delete iCloud Keychain" }),
    );

    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(/last passkey/i)).toBeInTheDocument();

    await user.click(
      within(dialog).getByRole("button", { name: /delete passkey/i }),
    );
    await waitFor(() => {
      expect(bindings.deletePasskey).toHaveBeenCalledWith({
        passkeyId: "pk-mac",
      });
    });
  });

  it("keeps the passkey when the confirmation is dismissed", async () => {
    const user = userEvent.setup();
    signedIn();
    bindings.listPasskeys.mockResolvedValue([macPasskey]);
    render(<PasskeyManager />);

    await user.click(
      await screen.findByRole("button", { name: "Delete iCloud Keychain" }),
    );
    await user.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: /keep it/i,
      }),
    );

    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(bindings.deletePasskey).not.toHaveBeenCalled();
  });

  it("surfaces action errors through the alert with overrides", async () => {
    const user = userEvent.setup();
    signedIn();
    bindings.listPasskeys.mockResolvedValue([]);
    bindings.registerPasskey.mockRejectedValue(
      bindings.makeAuthError("configuration"),
    );
    render(
      <PasskeyManager
        errorMessages={{ configuration: "Enable passkeys first." }}
      />,
    );

    await user.click(
      await screen.findByRole("button", { name: /add a passkey/i }),
    );
    expect(
      await screen.findByText("Enable passkeys first."),
    ).toBeInTheDocument();
  });

  it("has no axe violations with a populated list", async () => {
    signedIn();
    bindings.listPasskeys.mockResolvedValue([macPasskey, keyPasskey]);
    const { container } = render(<PasskeyManager />);
    await screen.findByText("iCloud Keychain");
    expect(await axe(container)).toHaveNoViolations();
  });
});
