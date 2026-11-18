//! Graphics card choice for the game (Settings > General > "Use the fast graphics card").
//!
//! On a laptop with two graphics cards Windows often runs Java on the slow, power-saving one, which can
//! halve Minecraft's frame rate. Windows keeps a per-program choice under
//! `HKEY_CURRENT_USER\Software\Microsoft\DirectX\UserGpuPreferences` (the same list as Settings > System >
//! Display > Graphics): this asks for "High performance" for the Java program that runs the game. Only that
//! one program's entry is written, never one the player already set themselves, and on a PC with one
//! graphics card it changes nothing.

/// Ask Windows to run `java` on the high-performance graphics card, unless the player already chose
/// something for it. Quiet on failure: the game runs either way.
pub fn prefer_fast_gpu(java: &std::path::Path) {
    #[cfg(windows)]
    {
        let program = java.to_string_lossy().to_string();
        match reg::read(&program) {
            // Only when Windows has no choice stored for it; anything already there (the player's choice, or
            // one too long to read here) is kept.
            Err(reg::NOT_FOUND) => {
                if let Err(code) = reg::write(&program, "GpuPreference=2;") {
                    log::warn!("gpu: couldn't set the graphics preference for {program} (error {code})");
                }
            }
            _ => {}
        }
    }
    #[cfg(not(windows))]
    let _ = java;
}

#[cfg(windows)]
mod reg {
    const HKEY_CURRENT_USER: isize = 0x8000_0001_u32 as i32 as isize;
    const KEY: &str = r"Software\Microsoft\DirectX\UserGpuPreferences";
    const REG_SZ: u32 = 1;
    const RRF_RT_REG_SZ: u32 = 0x0000_0002;

    #[link(name = "advapi32")]
    extern "system" {
        fn RegSetKeyValueW(key: isize, sub_key: *const u16, value_name: *const u16, kind: u32, data: *const u8, size: u32) -> i32;
        fn RegGetValueW(key: isize, sub_key: *const u16, value_name: *const u16, flags: u32, kind: *mut u32, data: *mut u8, size: *mut u32) -> i32;
    }

    fn wide(text: &str) -> Vec<u16> {
        text.encode_utf16().chain(std::iter::once(0)).collect()
    }

    /// ERROR_FILE_NOT_FOUND: no value with that name.
    pub const NOT_FOUND: i32 = 2;

    pub fn read(program: &str) -> Result<String, i32> {
        let (key, name) = (wide(KEY), wide(program));
        let mut buffer = vec![0u16; 256];
        let mut size = (buffer.len() * 2) as u32;
        let status = unsafe {
            RegGetValueW(HKEY_CURRENT_USER, key.as_ptr(), name.as_ptr(), RRF_RT_REG_SZ, std::ptr::null_mut(), buffer.as_mut_ptr().cast(), &mut size)
        };
        if status != 0 {
            return Err(status);
        }
        let len = (size as usize / 2).saturating_sub(1).min(buffer.len());
        Ok(String::from_utf16_lossy(&buffer[..len]))
    }

    pub fn write(program: &str, value: &str) -> Result<(), i32> {
        let (key, name, data) = (wide(KEY), wide(program), wide(value));
        let status = unsafe {
            RegSetKeyValueW(HKEY_CURRENT_USER, key.as_ptr(), name.as_ptr(), REG_SZ, data.as_ptr().cast(), (data.len() * 2) as u32)
        };
        if status == 0 { Ok(()) } else { Err(status) }
    }
}
