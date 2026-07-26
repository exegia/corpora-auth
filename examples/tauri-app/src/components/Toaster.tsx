import { Toast } from "@base-ui/react/toast";

/**
 * Base UI toast viewport. Mount inside `<Toast.Provider>`; anything under that
 * provider can then call `Toast.useToastManager().add(...)`.
 */
export function Toaster(): React.ReactElement {
  const { toasts } = Toast.useToastManager();

  return (
    <Toast.Portal>
      <Toast.Viewport className="fixed bottom-4 right-4 z-50 flex w-72 flex-col gap-2">
        {toasts.map((toast) => (
          <Toast.Root
            className="bg-popover text-popover-foreground data-[ending-style]:opacity-0 data-[starting-style]:opacity-0 flex flex-col gap-1 rounded-lg border p-3 shadow-lg transition-opacity"
            key={toast.id}
            toast={toast}
          >
            <Toast.Title className="text-sm font-medium" />
            <Toast.Description className="text-muted-foreground text-xs" />
            <Toast.Close
              aria-label="Dismiss"
              className="text-muted-foreground hover:text-foreground absolute right-2 top-2 text-xs"
            >
              ✕
            </Toast.Close>
          </Toast.Root>
        ))}
      </Toast.Viewport>
    </Toast.Portal>
  );
}
