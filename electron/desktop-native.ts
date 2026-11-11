import koffi from "koffi";
import { screen, type BrowserWindow, type Rectangle } from "electron";

// Keep the widget above the shell icon view, inside its desktop host. We only
// reparent our own window; Explorer and its icon/list windows are never modified.
let native: ReturnType<typeof load> | undefined;
function load() {
  const lib = koffi.load("user32.dll");
  const rect = koffi.struct("FeiDesktopRect", {
    left: "long",
    top: "long",
    right: "long",
    bottom: "long",
  });
  const point = koffi.struct("FeiDesktopPoint", { x: "long", y: "long" });
  const proc = koffi.proto(
    "int __stdcall FeiEnumWindow(uintptr_t hwnd, intptr_t param)",
  );
  return {
    enumWindows: lib.func("EnumWindows", "int", [
      koffi.pointer(proc),
      "intptr_t",
    ]),
    findChild: lib.func(
      "uintptr_t __stdcall FindWindowExW(uintptr_t parent, uintptr_t after, str16 className, str16 title)",
    ),
    getParent: lib.func("uintptr_t __stdcall GetParent(uintptr_t hwnd)"),
    setParent: lib.func(
      "uintptr_t __stdcall SetParent(uintptr_t hwnd, uintptr_t parent)",
    ),
    getStyle: lib.func(
      "intptr_t __stdcall GetWindowLongPtrW(uintptr_t hwnd, int index)",
    ),
    setStyle: lib.func(
      "intptr_t __stdcall SetWindowLongPtrW(uintptr_t hwnd, int index, intptr_t value)",
    ),
    position: lib.func(
      "int __stdcall SetWindowPos(uintptr_t hwnd, uintptr_t after, int x, int y, int width, int height, uint flags)",
    ),
    rectangle: lib.func("GetWindowRect", "int", [
      "uintptr_t",
      koffi.out(koffi.pointer(rect)),
    ]),
    client: lib.func("ScreenToClient", "int", [
      "uintptr_t",
      koffi.inout(koffi.pointer(point)),
    ]),
    valid: lib.func("int __stdcall IsWindow(uintptr_t hwnd)"),
  };
}

export class DesktopHost {
  private handle: bigint;
  private parent = 0n;
  constructor(private window: BrowserWindow) {
    this.handle = window.getNativeWindowHandle().readBigUInt64LE();
  }
  get embedded() {
    return Boolean(
      native &&
        this.parent &&
        native.valid(this.parent) &&
        BigInt(native.getParent(this.handle)) === this.parent,
    );
  }
  attach(): boolean {
    if (process.platform !== "win32" || this.window.isDestroyed()) return false;
    try {
      native ||= load();
      let parent = 0n;
      native.enumWindows((hwnd: number | bigint) => {
        if (native!.findChild(hwnd, 0, "SHELLDLL_DefView", null)) {
          parent = BigInt(hwnd);
          return 0;
        }
        return 1;
      }, 0);
      if (!parent) return false;
      const bounds = this.window.getBounds();
      const style = BigInt(native.getStyle(this.handle, -16));
      native.setStyle(this.handle, -16, (style & ~0x80000000n) | 0x40000000n);
      native.setParent(this.handle, parent);
      this.parent = parent;
      if (!this.embedded) {
        native.setStyle(this.handle, -16, style);
        this.parent = 0n;
        return false;
      }
      this.place(bounds);
      return true;
    } catch {
      return false;
    }
  }
  place(bounds: Rectangle) {
    if (!this.embedded) {
      this.window.setBounds(bounds);
      return;
    }
    const physical = screen.dipToScreenRect(null, bounds);
    const point = { x: physical.x, y: physical.y };
    native!.client(this.parent, point);
    // HWND_TOP, SWP_NOACTIVATE | SWP_FRAMECHANGED. No global topmost window.
    native!.position(
      this.handle,
      0,
      point.x,
      point.y,
      physical.width,
      physical.height,
      0x30,
    );
  }
  bounds(): Rectangle {
    if (!this.embedded) return this.window.getBounds();
    const rect = { left: 0, top: 0, right: 0, bottom: 0 };
    if (!native!.rectangle(this.handle, rect)) return this.window.getBounds();
    return screen.screenToDipRect(null, {
      x: rect.left,
      y: rect.top,
      width: rect.right - rect.left,
      height: rect.bottom - rect.top,
    });
  }
}
