//! Borderless fullscreen for Minecraft (Settings > General > "Borderless fullscreen").
//!
//! Minecraft Java only has exclusive fullscreen, which flickers and stalls when you Alt+Tab out, and a normal
//! window with a title bar. With this setting the launcher starts the game windowed and, once its window
//! appears, takes the title bar and edges off and stretches it over the monitor it's on.
//!
//! The window is made one pixel taller than the monitor on purpose. NVIDIA's and Intel's OpenGL drivers treat
//! a window that exactly covers a monitor as exclusive fullscreen, which brings back what borderless is meant
//! to avoid: Alt+Tab and the Windows key stop working and the game keeps itself on top. One pixel off the
//! bottom edge can't be seen, and keeps it an ordinary window that Windows can switch away from.
//!
//! It only changes the window's style and size, from outside the game, so it works on every version and mod
//! loader. Pressing F11 in game still switches to Minecraft's own fullscreen and back.

/// Watch the game process `pid` and make its window borderless when it appears. Gives up quietly after a
/// while (a game that never opens a window, or isn't on Windows).
pub fn make_game_window_borderless(pid: u32) {
    #[cfg(windows)]
    tokio::spawn(async move {
        // Holding the process open keeps Windows from giving its id to another program while this watches.
        let Some(process) = win::Process::open(pid) else { return };
        // Minecraft can take a while to open its window on a slow PC or with a big modpack.
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(180);
        let mut applied_at: Option<std::time::Instant> = None;
        while std::time::Instant::now() < deadline {
            tokio::time::sleep(std::time::Duration::from_millis(if applied_at.is_some() { 2000 } else { 500 })).await;
            if process.exited() {
                return;
            }
            let Some(window) = win::game_window(pid) else {
                if applied_at.is_some() {
                    return; // The game closed.
                }
                continue;
            };
            // Loading screens and mod loaders sometimes put the frame back; keep it off for a short while.
            if win::has_frame(window) {
                win::go_borderless(window);
                applied_at.get_or_insert_with(std::time::Instant::now);
            }
            if applied_at.is_some_and(|at| at.elapsed() > std::time::Duration::from_secs(45)) {
                return;
            }
        }
    });
    #[cfg(not(windows))]
    let _ = pid;
}

#[cfg(windows)]
mod win {
    use std::ffi::c_void;

    type Hwnd = isize;
    type Bool = i32;

    #[repr(C)]
    #[derive(Default, Clone, Copy)]
    struct Rect {
        left: i32,
        top: i32,
        right: i32,
        bottom: i32,
    }

    #[repr(C)]
    struct MonitorInfo {
        size: u32,
        monitor: Rect,
        work: Rect,
        flags: u32,
    }

    const GWL_STYLE: i32 = -16;
    const WS_CAPTION: isize = 0x00C0_0000;
    const WS_THICKFRAME: isize = 0x0004_0000;
    const WS_MAXIMIZEBOX: isize = 0x0001_0000;
    /// The title bar and resizable edges. The minimize box and system menu stay: without them the taskbar
    /// button and Windows+D can't minimize the game.
    const FRAME: isize = WS_CAPTION | WS_THICKFRAME | WS_MAXIMIZEBOX;
    const MONITOR_DEFAULTTONEAREST: u32 = 2;
    const SWP_NOZORDER: u32 = 0x0004;
    const SWP_FRAMECHANGED: u32 = 0x0020;
    const SWP_NOOWNERZORDER: u32 = 0x0200;
    const SWP_NOACTIVATE: u32 = 0x0010;

    const SYNCHRONIZE: u32 = 0x0010_0000;
    const WAIT_TIMEOUT: u32 = 0x0000_0102;

    #[link(name = "kernel32")]
    extern "system" {
        fn OpenProcess(access: u32, inherit: Bool, pid: u32) -> isize;
        fn WaitForSingleObject(handle: isize, millis: u32) -> u32;
        fn CloseHandle(handle: isize) -> Bool;
    }

    /// An open handle on the game's process.
    pub struct Process(isize);

    // SAFETY: a process handle may be used and closed from any thread.
    unsafe impl Send for Process {}

    impl Process {
        pub fn open(pid: u32) -> Option<Self> {
            let handle = unsafe { OpenProcess(SYNCHRONIZE, 0, pid) };
            (handle != 0).then_some(Self(handle))
        }

        pub fn exited(&self) -> bool {
            unsafe { WaitForSingleObject(self.0, 0) != WAIT_TIMEOUT }
        }
    }

    impl Drop for Process {
        fn drop(&mut self) {
            unsafe { CloseHandle(self.0) };
        }
    }

    #[link(name = "user32")]
    extern "system" {
        fn EnumWindows(callback: extern "system" fn(Hwnd, isize) -> Bool, data: isize) -> Bool;
        fn GetWindowThreadProcessId(window: Hwnd, pid: *mut u32) -> u32;
        fn IsWindowVisible(window: Hwnd) -> Bool;
        fn GetWindowRect(window: Hwnd, rect: *mut Rect) -> Bool;
        fn GetWindowLongPtrW(window: Hwnd, index: i32) -> isize;
        fn SetWindowLongPtrW(window: Hwnd, index: i32, value: isize) -> isize;
        fn SetWindowPos(window: Hwnd, after: Hwnd, x: i32, y: i32, cx: i32, cy: i32, flags: u32) -> Bool;
        fn MonitorFromWindow(window: Hwnd, flags: u32) -> *mut c_void;
        fn GetMonitorInfoW(monitor: *mut c_void, info: *mut MonitorInfo) -> Bool;
    }

    struct Search {
        pid: u32,
        best: Option<(Hwnd, i64)>,
    }

    extern "system" fn visit(window: Hwnd, data: isize) -> Bool {
        // SAFETY: `data` is the `Search` passed to EnumWindows below, alive for the whole enumeration.
        let search = unsafe { &mut *(data as *mut Search) };
        let mut owner = 0u32;
        unsafe { GetWindowThreadProcessId(window, &mut owner) };
        if owner == search.pid && unsafe { IsWindowVisible(window) } != 0 {
            let mut rect = Rect::default();
            unsafe { GetWindowRect(window, &mut rect) };
            let area = i64::from(rect.right - rect.left) * i64::from(rect.bottom - rect.top);
            if area > 0 && search.best.map_or(true, |(_, best)| area > best) {
                search.best = Some((window, area));
            }
        }
        1
    }

    /// The game's main window: the largest visible top-level window owned by the Java process.
    pub fn game_window(pid: u32) -> Option<Hwnd> {
        let mut search = Search { pid, best: None };
        unsafe { EnumWindows(visit, &mut search as *mut Search as isize) };
        search.best.map(|(window, _)| window)
    }

    pub fn has_frame(window: Hwnd) -> bool {
        unsafe { GetWindowLongPtrW(window, GWL_STYLE) & WS_CAPTION != 0 }
    }

    /// Take the frame off and cover the monitor the window is on (taskbar included).
    pub fn go_borderless(window: Hwnd) {
        unsafe {
            let style = GetWindowLongPtrW(window, GWL_STYLE);
            SetWindowLongPtrW(window, GWL_STYLE, style & !FRAME);
            let mut info = MonitorInfo { size: std::mem::size_of::<MonitorInfo>() as u32, monitor: Rect::default(), work: Rect::default(), flags: 0 };
            let monitor = MonitorFromWindow(window, MONITOR_DEFAULTTONEAREST);
            if GetMonitorInfoW(monitor, &mut info) == 0 {
                return;
            }
            let r = info.monitor;
            // One pixel taller than the monitor (see the top of this file), and never pulled to the front: the
            // player may already have switched to another window.
            SetWindowPos(
                window,
                0,
                r.left,
                r.top,
                r.right - r.left,
                r.bottom - r.top + 1,
                SWP_NOZORDER | SWP_NOOWNERZORDER | SWP_FRAMECHANGED | SWP_NOACTIVATE,
            );
        }
    }
}
