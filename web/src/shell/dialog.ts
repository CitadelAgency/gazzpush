// A modal <dialog> whose "open" lives in React state (the palette, the shortcuts sheet). Esc closes the dialog at once,
// but `close` only arrives about 20 ms later and `cancel` is not always fired. In that window the state still says
// "open", and the key that reopens it (⌘K, ?) is lost. So Esc changes the state on the key itself, and the late `close`
// only counts if the dialog is still closed: if the person already reopened it, it belongs to the earlier close and
// would close it again.
import type { KeyboardEvent, RefObject } from "react";

export const closesTogether = (dlg: RefObject<HTMLDialogElement | null>, close: () => void) => ({
  onClose: () => { if (!dlg.current?.open) close(); },
  onCancel: () => close(),
  onKeyDown: (e: KeyboardEvent) => { if (e.key === "Escape") close(); },
});
