import { Toast } from "@base-ui/react/toast";

/**
 * Base UI toast viewport. Mount inside `<Toast.Provider>`; anything under that
 * provider can then call `Toast.useToastManager().add(...)`.
 */
export function Toaster(): React.ReactElement {
  const { toasts } = Toast.useToastManager();

  return (
    <Toast.Portal>
      <Toast.Viewport className="toast-viewport">
        {toasts.map((toast) => (
          <Toast.Root className="toast" key={toast.id} toast={toast}>
            <Toast.Title style={{ fontWeight: 500 }} />
            <Toast.Description className="small muted" />
            <Toast.Close aria-label="Dismiss" className="toast-close">
              ✕
            </Toast.Close>
          </Toast.Root>
        ))}
      </Toast.Viewport>
    </Toast.Portal>
  );
}
