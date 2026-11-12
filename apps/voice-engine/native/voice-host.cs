// Terminal-Design voice host (compiled at runtime by voice-host.ps1 through Add-Type).
//
// Responsibilities (everything that needs Win32):
//   - global hotkey (RegisterHotKey) + key-release polling (GetAsyncKeyState) for push-to-talk
//   - microphone capture with the winmm waveIn API, 16 kHz / mono / 16-bit PCM WAV
//   - text insertion into the focused window (SendInput KEYEVENTF_UNICODE, or clipboard + Ctrl+V)
//   - indicators: tray NotifyIcon + small topmost overlay that never takes focus
//
// It talks to Node over stdin/stdout, one JSON object per line (UTF-8).
//   host -> node: {"event":"ready"|"recording"|"audio"|"cancelled"|"typed"|"blocked"|"copied"|"devices"|"warn"|"error"|"quit", ...}
//   node -> host: {"cmd":"type"|"drop"|"copy"|"state"|"quit", ...}
// Each recording gets an id ("audio" event). It can be inserted once ("type" with that id), only
// into the window that had focus when recording started, and never while a modifier is held.
// When stdin closes (Node died) the host exits, so it can never be left running orphaned.
using System;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;

namespace TerminalDesign.Voice
{
    internal static class Native
    {
        public const int WM_HOTKEY = 0x0312;
        public const uint MOD_NOREPEAT = 0x4000;
        public const uint WAVE_MAPPER = 0xFFFFFFFF;
        public const uint WHDR_DONE = 0x00000001;
        public const uint INPUT_KEYBOARD = 1;
        public const uint KEYEVENTF_KEYUP = 0x0002;
        public const uint KEYEVENTF_UNICODE = 0x0004;

        [DllImport("user32.dll", SetLastError = true)]
        public static extern bool RegisterHotKey(IntPtr hWnd, int id, uint fsModifiers, uint vk);
        [DllImport("user32.dll", SetLastError = true)]
        public static extern bool UnregisterHotKey(IntPtr hWnd, int id);
        [DllImport("user32.dll")]
        public static extern short GetAsyncKeyState(int vKey);
        [DllImport("user32.dll", SetLastError = true)]
        public static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);
        [DllImport("user32.dll")]
        public static extern IntPtr GetForegroundWindow();
        [DllImport("user32.dll")]
        public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
        [DllImport("user32.dll")]
        public static extern bool DestroyIcon(IntPtr hIcon);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        public static extern int GetClassName(IntPtr hWnd, StringBuilder name, int max);

        // Foreground tracking (EVENT_SYSTEM_FOREGROUND, out of context: callback runs on our UI thread).
        public const uint EVENT_SYSTEM_FOREGROUND = 0x0003;
        public const uint WINEVENT_OUTOFCONTEXT = 0x0000;
        public delegate void WinEventProc(IntPtr hook, uint evt, IntPtr hwnd, int idObject, int idChild, uint thread, uint time);
        [DllImport("user32.dll")]
        public static extern IntPtr SetWinEventHook(uint min, uint max, IntPtr module, WinEventProc proc, uint pid, uint tid, uint flags);
        [DllImport("user32.dll")]
        public static extern bool UnhookWinEvent(IntPtr hook);
        [DllImport("kernel32.dll", SetLastError = true)]
        public static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
        [DllImport("kernel32.dll")]
        public static extern bool CloseHandle(IntPtr h);
        [DllImport("kernel32.dll")]
        public static extern IntPtr GetCurrentProcess();
        [DllImport("advapi32.dll", SetLastError = true)]
        public static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);
        [DllImport("advapi32.dll", SetLastError = true)]
        public static extern bool GetTokenInformation(IntPtr token, int cls, out int info, int len, out int retLen);

        [DllImport("winmm.dll")]
        public static extern uint waveInGetNumDevs();
        [DllImport("winmm.dll", CharSet = CharSet.Unicode)]
        public static extern int waveInGetDevCapsW(UIntPtr id, ref WAVEINCAPS caps, uint size);
        [DllImport("winmm.dll")]
        public static extern int waveInOpen(out IntPtr h, uint id, ref WAVEFORMATEX fmt, IntPtr cb, IntPtr inst, uint flags);
        [DllImport("winmm.dll")]
        public static extern int waveInPrepareHeader(IntPtr h, IntPtr hdr, int size);
        [DllImport("winmm.dll")]
        public static extern int waveInUnprepareHeader(IntPtr h, IntPtr hdr, int size);
        [DllImport("winmm.dll")]
        public static extern int waveInAddBuffer(IntPtr h, IntPtr hdr, int size);
        [DllImport("winmm.dll")]
        public static extern int waveInStart(IntPtr h);
        [DllImport("winmm.dll")]
        public static extern int waveInReset(IntPtr h);
        [DllImport("winmm.dll")]
        public static extern int waveInClose(IntPtr h);
        [DllImport("winmm.dll", CharSet = CharSet.Unicode)]
        public static extern int waveInGetErrorTextW(int err, StringBuilder text, int len);

        [StructLayout(LayoutKind.Sequential)]
        public struct WAVEFORMATEX
        {
            public ushort wFormatTag, nChannels;
            public uint nSamplesPerSec, nAvgBytesPerSec;
            public ushort nBlockAlign, wBitsPerSample, cbSize;
        }

        [StructLayout(LayoutKind.Sequential)]
        public struct WAVEHDR
        {
            public IntPtr lpData;
            public uint dwBufferLength, dwBytesRecorded;
            public IntPtr dwUser;
            public uint dwFlags, dwLoops;
            public IntPtr lpNext, reserved;
        }

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        public struct WAVEINCAPS
        {
            public ushort wMid, wPid;
            public uint vDriverVersion;
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string szPname;
            public uint dwFormats;
            public ushort wChannels, wReserved1;
        }

        // INPUT must include MOUSEINPUT in the union so Marshal.SizeOf matches the native
        // struct (40 bytes on x64); otherwise SendInput rejects every call.
        [StructLayout(LayoutKind.Sequential)]
        public struct INPUT { public uint type; public InputUnion u; }
        [StructLayout(LayoutKind.Explicit)]
        public struct InputUnion
        {
            [FieldOffset(0)] public MOUSEINPUT mi;
            [FieldOffset(0)] public KEYBDINPUT ki;
        }
        [StructLayout(LayoutKind.Sequential)]
        public struct MOUSEINPUT { public int dx, dy; public uint mouseData, dwFlags, time; public IntPtr dwExtraInfo; }
        [StructLayout(LayoutKind.Sequential)]
        public struct KEYBDINPUT { public ushort wVk, wScan; public uint dwFlags, time; public IntPtr dwExtraInfo; }

        public static string MmError(int code)
        {
            var sb = new StringBuilder(256);
            waveInGetErrorTextW(code, sb, sb.Capacity);
            return "MMSYSERR " + code + (sb.Length > 0 ? " (" + sb + ")" : "");
        }
    }

    /// <summary>Thread-safe JSON-lines writer/reader.</summary>
    internal static class Protocol
    {
        static readonly object Gate = new object();
        static readonly JavaScriptSerializer Json = new JavaScriptSerializer();
        static TextWriter output;

        public static void Init()
        {
            output = new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false));
        }

        public static void Emit(string evt, params object[] kv)
        {
            var d = new Dictionary<string, object>();
            d["event"] = evt;
            for (int i = 0; i + 1 < kv.Length; i += 2) d[(string)kv[i]] = kv[i + 1];
            string line = Json.Serialize(d);
            lock (Gate)
            {
                try { output.Write(line + "\n"); output.Flush(); } catch { /* parent gone */ }
            }
        }

        public static Dictionary<string, object> Parse(string line)
        {
            try { return Json.DeserializeObject(line) as Dictionary<string, object>; }
            catch { return null; }
        }
    }

    /// <summary>waveIn capture into memory, polled from a dedicated thread (no callbacks).</summary>
    internal sealed class Recorder
    {
        public const int Rate = 16000;
        const int BufferBytes = 3200;   // 100 ms of 16 kHz mono 16-bit
        const int BufferCount = 8;
        static readonly int HdrSize = Marshal.SizeOf(typeof(Native.WAVEHDR));

        IntPtr wave;
        readonly IntPtr[] headers = new IntPtr[BufferCount];
        readonly IntPtr[] datas = new IntPtr[BufferCount];
        readonly MemoryStream pcm = new MemoryStream();
        Thread thread;
        volatile bool stopping;
        public int Peak;
        public string Error;

        public static List<Dictionary<string, object>> ListDevices()
        {
            var list = new List<Dictionary<string, object>>();
            uint n = Native.waveInGetNumDevs();
            for (uint i = 0; i < n; i++)
            {
                var caps = new Native.WAVEINCAPS();
                if (Native.waveInGetDevCapsW(new UIntPtr(i), ref caps, (uint)Marshal.SizeOf(caps)) != 0) continue;
                var d = new Dictionary<string, object>();
                d["index"] = (int)i;
                d["name"] = caps.szPname;
                d["channels"] = (int)caps.wChannels;
                list.Add(d);
            }
            return list;
        }

        /// <summary>"default" -> WAVE_MAPPER, a number -> index, other text -> first name containing it.</summary>
        public static uint ResolveDevice(string spec, out string label)
        {
            label = "padrão do Windows";
            if (string.IsNullOrEmpty(spec) || spec.Equals("default", StringComparison.OrdinalIgnoreCase)) return Native.WAVE_MAPPER;
            var devices = ListDevices();
            int idx;
            if (int.TryParse(spec, out idx))
            {
                foreach (var d in devices) if ((int)d["index"] == idx) { label = (string)d["name"]; return (uint)idx; }
                throw new Exception("microfone " + idx + " não existe (veja td voice devices)");
            }
            foreach (var d in devices)
            {
                if (((string)d["name"]).IndexOf(spec, StringComparison.OrdinalIgnoreCase) >= 0)
                {
                    label = (string)d["name"];
                    return (uint)(int)d["index"];
                }
            }
            throw new Exception("nenhum microfone com o nome \"" + spec + "\" (veja td voice devices)");
        }

        public void Start(uint device)
        {
            var fmt = new Native.WAVEFORMATEX
            {
                wFormatTag = 1, nChannels = 1, nSamplesPerSec = Rate, nAvgBytesPerSec = Rate * 2,
                nBlockAlign = 2, wBitsPerSample = 16, cbSize = 0
            };
            int r = Native.waveInOpen(out wave, device, ref fmt, IntPtr.Zero, IntPtr.Zero, 0 /* CALLBACK_NULL */);
            if (r != 0) throw new Exception("não foi possível abrir o microfone: " + Native.MmError(r));
            for (int i = 0; i < BufferCount; i++)
            {
                datas[i] = Marshal.AllocHGlobal(BufferBytes);
                var h = new Native.WAVEHDR { lpData = datas[i], dwBufferLength = BufferBytes };
                headers[i] = Marshal.AllocHGlobal(HdrSize);
                Marshal.StructureToPtr(h, headers[i], false);
                Native.waveInPrepareHeader(wave, headers[i], HdrSize);
                Native.waveInAddBuffer(wave, headers[i], HdrSize);
            }
            r = Native.waveInStart(wave);
            if (r != 0) { Cleanup(); throw new Exception("waveInStart falhou: " + Native.MmError(r)); }
            thread = new Thread(Loop) { IsBackground = true, Name = "td-voice-capture" };
            thread.Start();
        }

        void Collect(IntPtr hp)
        {
            var h = (Native.WAVEHDR)Marshal.PtrToStructure(hp, typeof(Native.WAVEHDR));
            int n = (int)h.dwBytesRecorded;
            if (n <= 0) return;
            var buf = new byte[n];
            Marshal.Copy(h.lpData, buf, 0, n);
            for (int i = 0; i + 1 < n; i += 2)
            {
                int s = (short)(buf[i] | (buf[i + 1] << 8));
                if (s < 0) s = -s;
                if (s > Peak) Peak = s;
            }
            pcm.Write(buf, 0, n);
        }

        uint Flags(IntPtr hp)
        {
            return ((Native.WAVEHDR)Marshal.PtrToStructure(hp, typeof(Native.WAVEHDR))).dwFlags;
        }

        // Buffers complete in queue order, so walking them round-robin keeps audio in sequence.
        void Loop()
        {
            int idx = 0;
            try
            {
                while (!stopping)
                {
                    if ((Flags(headers[idx]) & Native.WHDR_DONE) != 0)
                    {
                        Collect(headers[idx]);
                        Native.waveInAddBuffer(wave, headers[idx], HdrSize);
                        idx = (idx + 1) % BufferCount;
                    }
                    else Thread.Sleep(10);
                }
                // waveInReset returns every queued buffer (partially filled) marked as done.
                Native.waveInReset(wave);
                for (int k = 0; k < BufferCount; k++)
                {
                    int i = (idx + k) % BufferCount;
                    if ((Flags(headers[i]) & Native.WHDR_DONE) != 0) Collect(headers[i]);
                }
            }
            catch (Exception e) { Error = e.Message; }
            finally { Cleanup(); }
        }

        void Cleanup()
        {
            for (int i = 0; i < BufferCount; i++)
            {
                if (headers[i] != IntPtr.Zero)
                {
                    Native.waveInUnprepareHeader(wave, headers[i], HdrSize);
                    Marshal.FreeHGlobal(headers[i]);
                    headers[i] = IntPtr.Zero;
                }
                if (datas[i] != IntPtr.Zero) { Marshal.FreeHGlobal(datas[i]); datas[i] = IntPtr.Zero; }
            }
            if (wave != IntPtr.Zero) { Native.waveInClose(wave); wave = IntPtr.Zero; }
        }

        /// <summary>Stops capture and returns the PCM bytes recorded.</summary>
        public byte[] Stop()
        {
            stopping = true;
            if (thread != null) thread.Join(3000);
            return pcm.ToArray();
        }

        public static void WriteWav(string path, byte[] data)
        {
            using (var fs = new FileStream(path, FileMode.Create, FileAccess.Write))
            using (var w = new BinaryWriter(fs))
            {
                w.Write(Encoding.ASCII.GetBytes("RIFF"));
                w.Write(36 + data.Length);
                w.Write(Encoding.ASCII.GetBytes("WAVEfmt "));
                w.Write(16);
                w.Write((short)1);          // PCM
                w.Write((short)1);          // mono
                w.Write(Rate);
                w.Write(Rate * 2);          // byte rate
                w.Write((short)2);          // block align
                w.Write((short)16);         // bits per sample
                w.Write(Encoding.ASCII.GetBytes("data"));
                w.Write(data.Length);
                w.Write(data);
            }
        }
    }

    /// <summary>
    /// Everything text insertion needs from Windows, behind an interface so the safety rules
    /// (focus, modifier keys, clipboard restore, no stuck keys) can be unit-tested with a fake
    /// environment that never touches the real keyboard, windows or clipboard.
    /// </summary>
    internal interface IInputEnv
    {
        IntPtr Foreground();
        bool IsDown(int vk);
        uint Send(Native.INPUT[] inputs);
        void Sleep(int ms);
        IDataObject ClipboardGet();
        void ClipboardSetText(string text);
        void ClipboardSet(IDataObject data);
        void ClipboardClear();
    }

    /// <summary>The real Win32 environment.</summary>
    internal sealed class WinInputEnv : IInputEnv
    {
        static readonly int InputSize = Marshal.SizeOf(typeof(Native.INPUT));
        public IntPtr Foreground() { return Native.GetForegroundWindow(); }
        public bool IsDown(int vk) { return (Native.GetAsyncKeyState(vk) & 0x8000) != 0; }
        public uint Send(Native.INPUT[] inputs) { return inputs.Length == 0 ? 0 : Native.SendInput((uint)inputs.Length, inputs, InputSize); }
        public void Sleep(int ms) { Thread.Sleep(ms); }
        public IDataObject ClipboardGet() { return Clipboard.GetDataObject(); }
        public void ClipboardSetText(string text) { Clipboard.SetText(text); }
        public void ClipboardSet(IDataObject data) { Clipboard.SetDataObject(data, true); }
        public void ClipboardClear() { Clipboard.Clear(); }
    }

    /// <summary>Outcome of one insertion attempt.</summary>
    internal sealed class InsertResult
    {
        public string Outcome = "typed";   // typed | blocked | interrupted
        public string Reason;              // focus | modifier | no-target | error (null when typed)
        public string Keys;                // pressed keys when Reason == modifier, e.g. "Ctrl+Shift"
        public string Mode;                // type | paste (what was actually used)
        public int Chars;                  // characters delivered
        public int Requested;
        public string Warning;             // non-fatal note (e.g. clipboard could not be preserved)
    }

    /// <summary>
    /// One pending insertion per recording. The host registers the window that had focus when
    /// the recording started; a `type` command can claim it exactly once.
    /// </summary>
    internal sealed class PendingTargets
    {
        readonly Dictionary<int, IntPtr> map = new Dictionary<int, IntPtr>();
        public void Add(int id, IntPtr target) { lock (map) map[id] = target; }
        public bool Take(int id, out IntPtr target)
        {
            lock (map)
            {
                if (!map.TryGetValue(id, out target)) return false;
                map.Remove(id);
                return true;
            }
        }
        public int Count { get { lock (map) return map.Count; } }
    }

    /// <summary>
    /// R1 target choice when a recording starts. The mic button never activates, so the foreground
    /// window is normally still the user's window. When the foreground is one of our own windows
    /// (button, overlay, menus), the taskbar (tray click) or nothing, fall back to the last
    /// foreground window that was not ignored. Zero means "no target": the insertion will be
    /// blocked with reason no-target and the text kept for manual copy.
    /// </summary>
    internal static class TargetPicker
    {
        static readonly string[] ShellTrayClasses =
        {
            "Shell_TrayWnd", "Shell_SecondaryTrayWnd", "NotifyIconOverflowWindow", "TopLevelWindowForOverflowXamlIsland",
        };

        public static IntPtr ChooseTarget(IntPtr currentFg, IntPtr lastExternalFg, Predicate<IntPtr> ignored)
        {
            if (currentFg != IntPtr.Zero && !ignored(currentFg)) return currentFg;
            if (lastExternalFg != IntPtr.Zero && !ignored(lastExternalFg)) return lastExternalFg;
            return IntPtr.Zero;
        }

        public static IntPtr ChooseTarget(IntPtr currentFg, IntPtr lastExternalFg, ICollection<IntPtr> ownHandles)
        {
            return ChooseTarget(currentFg, lastExternalFg, h => ownHandles.Contains(h));
        }

        /// <summary>Taskbar / notification area windows: clicking the tray icon focuses these.</summary>
        public static bool IsShellTrayClass(string className)
        {
            return className != null && Array.IndexOf(ShellTrayClasses, className) >= 0;
        }
    }

    internal enum RecAction { None, Start, Stop }

    /// <summary>
    /// Pure start/stop decisions shared by the hotkey, the mic button and the tray icon, so all of
    /// them go through the same StartRecording/StopRecording path.
    ///  - click (button or tray): toggles, whatever voice.mode is;
    ///  - hotkey down: starts when idle; stops only in toggle mode;
    ///  - hotkey release: stops only a push-to-talk recording that the hotkey started;
    ///  - clicks are ignored while a stop is in progress, right after a start and right after a
    ///    stop (ClickGuardMs), so a double click never produces start+stop or stop+start.
    /// </summary>
    internal sealed class RecordController
    {
        public const long ClickGuardMs = 400;
        readonly string trigger;
        public string State = "idle";   // idle | recording | stopping
        public string Source;           // hotkey | button | tray (while recording)
        long startedAt = long.MinValue / 2, stoppedAt = long.MinValue / 2;

        public RecordController(string trigger) { this.trigger = trigger; }

        public RecAction Click(long nowMs)
        {
            if (State == "stopping") return RecAction.None;
            if (State == "recording") return nowMs - startedAt < ClickGuardMs ? RecAction.None : RecAction.Stop;
            return nowMs - stoppedAt < ClickGuardMs ? RecAction.None : RecAction.Start;
        }

        public RecAction HotkeyDown()
        {
            if (State == "idle") return RecAction.Start;
            if (State == "recording" && trigger == "toggle") return RecAction.Stop;
            return RecAction.None;
        }

        public RecAction HotkeyReleased()
        {
            return State == "recording" && trigger == "push-to-talk" && Source == "hotkey" ? RecAction.Stop : RecAction.None;
        }

        public void Started(string source, long nowMs) { State = "recording"; Source = source; startedAt = nowMs; }
        public void StartFailed() { State = "idle"; Source = null; }
        public void BeginStop() { State = "stopping"; }
        public void Stopped(long nowMs) { State = "idle"; Source = null; stoppedAt = nowMs; }
    }

    /// <summary>
    /// Safe text insertion. Rules:
    ///  R1  text goes only to the window that had focus when recording started; if focus moved
    ///      (before or while typing) nothing more is typed.
    ///  R2  if Ctrl/Alt/Shift/Win (or the hotkey key) is still held after a short grace period,
    ///      nothing is typed, so letters can never turn into shortcuts. Every key this code
    ///      presses is released, even when Windows accepts only part of a batch.
    /// </summary>
    internal static class Typist
    {
        // Generic + left/right variants: Shift, Ctrl, Alt, LWin, RWin.
        static readonly int[] ModifierKeys = { 0x10, 0x11, 0x12, 0x5B, 0x5C, 0xA0, 0xA1, 0xA2, 0xA3, 0xA4, 0xA5 };
        public const int GraceMs = 1500;
        const int PollMs = 15;
        const int Chunk = 32; // small batches: some console hosts drop very large bursts

        internal static Native.INPUT Key(ushort vk, ushort scan, uint flags)
        {
            var i = new Native.INPUT { type = Native.INPUT_KEYBOARD };
            i.u.ki = new Native.KEYBDINPUT { wVk = vk, wScan = scan, dwFlags = flags };
            return i;
        }

        /// <summary>
        /// Taps an unassigned virtual key (0xE8) so that releasing Alt/Win after the hotkey
        /// does not open the window menu bar / Start menu (same trick AutoHotkey uses).
        /// </summary>
        public static void MaskMenuKey(IInputEnv env)
        {
            env.Send(new[] { Key(0xE8, 0, 0), Key(0xE8, 0, Native.KEYEVENTF_KEYUP) });
        }

        /// <summary>Human-readable list of held modifier keys ("" when none). AltGr = RightAlt.</summary>
        public static string HeldKeys(IInputEnv env, int hotkeyVk)
        {
            var names = new List<string>();
            bool rAlt = env.IsDown(0xA5), lAlt = env.IsDown(0xA4);
            bool ctrl = env.IsDown(0x11) || env.IsDown(0xA2) || env.IsDown(0xA3);
            bool alt = env.IsDown(0x12) || lAlt || rAlt;
            // Windows reports AltGr as Right Alt plus a synthesized Ctrl: show it as one key.
            bool altGr = rAlt && !lAlt;
            if (altGr) names.Add("AltGr");
            else
            {
                if (ctrl) names.Add("Ctrl");
                if (alt) names.Add("Alt");
            }
            if (env.IsDown(0x10) || env.IsDown(0xA0) || env.IsDown(0xA1)) names.Add("Shift");
            if (env.IsDown(0x5B) || env.IsDown(0x5C)) names.Add("Win");
            if (hotkeyVk != 0 && Array.IndexOf(ModifierKeys, hotkeyVk) < 0 && env.IsDown(hotkeyVk)) names.Add("tecla do atalho");
            return string.Join("+", names.ToArray());
        }

        /// <summary>Wait up to GraceMs for the user to let go of the hotkey; returns what is still held.</summary>
        public static string WaitModifiersReleased(IInputEnv env, int hotkeyVk, int graceMs)
        {
            int loops = Math.Max(1, graceMs / PollMs);
            string held = HeldKeys(env, hotkeyVk);
            for (int i = 0; i < loops && held.Length > 0; i++)
            {
                env.Sleep(PollMs);
                held = HeldKeys(env, hotkeyVk);
            }
            return held;
        }

        /// <summary>null when it is safe to send input to `target` right now, otherwise the block reason.</summary>
        static InsertResult Check(IInputEnv env, IntPtr target, int hotkeyVk, InsertResult r)
        {
            if (env.Foreground() != target) { r.Reason = "focus"; return r; }
            string held = HeldKeys(env, hotkeyVk);
            if (held.Length > 0) { r.Reason = "modifier"; r.Keys = held; return r; }
            return null;
        }

        /// <summary>
        /// Insert `text` into `target` with mode "type" or "paste". Never types into another window,
        /// never types while a modifier is held, never leaves an injected key down.
        /// </summary>
        public static InsertResult Insert(string text, string how, IntPtr target, int hotkeyVk, IInputEnv env, int graceMs)
        {
            var r = new InsertResult { Requested = text.Length, Mode = how == "paste" ? "paste" : "type" };
            if (target == IntPtr.Zero) { r.Outcome = "blocked"; r.Reason = "no-target"; return r; }

            string held = WaitModifiersReleased(env, hotkeyVk, graceMs);
            if (env.Foreground() != target) { r.Outcome = "blocked"; r.Reason = "focus"; return r; }
            if (held.Length > 0) { r.Outcome = "blocked"; r.Reason = "modifier"; r.Keys = held; return r; }

            if (r.Mode == "paste")
            {
                bool wasEmpty;
                DataObject previous = SnapshotClipboard(env, out wasEmpty);
                if (previous != null || wasEmpty) return Paste(text, target, hotkeyVk, env, previous, r);
                // Could not copy what the user has on the clipboard: never overwrite it, type instead.
                r.Mode = "type";
                r.Warning = "área de transferência com conteúdo que não dá para preservar; digitando em vez de colar";
            }
            return TypeUnicode(text, target, hotkeyVk, env, r);
        }

        static InsertResult TypeUnicode(string text, IntPtr target, int hotkeyVk, IInputEnv env, InsertResult r)
        {
            for (int start = 0; start < text.Length; start += Chunk)
            {
                // Re-check before every batch: focus can move or a key can be pressed mid-way.
                if (Check(env, target, hotkeyVk, r) != null)
                {
                    r.Outcome = r.Chars == 0 ? "blocked" : "interrupted";
                    return r;
                }
                int end = Math.Min(text.Length, start + Chunk);
                var list = new List<Native.INPUT>();
                for (int i = start; i < end; i++)
                {
                    ushort c = text[i];
                    list.Add(Key(0, c, Native.KEYEVENTF_UNICODE));
                    list.Add(Key(0, c, Native.KEYEVENTF_UNICODE | Native.KEYEVENTF_KEYUP));
                }
                var arr = list.ToArray();
                int sent = (int)env.Send(arr);
                // An odd count means a key-down went through without its key-up: release it.
                if (sent % 2 == 1) env.Send(new[] { Key(0, arr[sent - 1].u.ki.wScan, Native.KEYEVENTF_UNICODE | Native.KEYEVENTF_KEYUP) });
                r.Chars += sent / 2;
                if (sent < arr.Length)
                {
                    r.Outcome = r.Chars == 0 ? "blocked" : "interrupted";
                    r.Reason = "error";
                    return r;
                }
                env.Sleep(5);
            }
            return r;
        }

        /// <summary>
        /// Snapshot every clipboard format (text, images, file lists, HTML...) into a new DataObject.
        /// Returns null when some format cannot be read (e.g. delayed rendering by the owner app):
        /// in that case the caller must NOT restore, because a partial restore would lose data.
        /// `empty` is true when the clipboard had nothing at all.
        /// </summary>
        internal static DataObject SnapshotClipboard(IInputEnv env, out bool empty)
        {
            empty = false;
            IDataObject current;
            try { current = env.ClipboardGet(); } catch { return null; }
            if (current == null) { empty = true; return null; }
            string[] formats;
            try { formats = current.GetFormats(false); } catch { return null; }
            if (formats == null || formats.Length == 0) { empty = true; return null; }
            var copy = new DataObject();
            foreach (string f in formats)
            {
                object data;
                try { data = current.GetData(f, false); } catch { return null; }
                if (data == null) return null;
                // Streams belong to the old clipboard owner; copy their bytes.
                var stream = data as Stream;
                if (stream != null)
                {
                    var ms = new MemoryStream();
                    try { if (stream.CanSeek) stream.Position = 0; stream.CopyTo(ms); } catch { return null; }
                    ms.Position = 0;
                    data = ms;
                }
                copy.SetData(f, false, data);
            }
            return copy;
        }

        static InsertResult Paste(string text, IntPtr target, int hotkeyVk, IInputEnv env, DataObject previous, InsertResult r)
        {
            try
            {
                env.ClipboardSetText(text);
                // Last check right before Ctrl+V: the clipboard write can take a moment.
                if (Check(env, target, hotkeyVk, r) != null) { r.Outcome = "blocked"; return r; }
                var inputs = new[]
                {
                    Key(0x11, 0, 0), Key(0x56, 0, 0), Key(0x56, 0, Native.KEYEVENTF_KEYUP), Key(0x11, 0, Native.KEYEVENTF_KEYUP)
                };
                uint n = env.Send(inputs);
                if (n < inputs.Length)
                {
                    // Partial batch: release V and Ctrl so nothing stays artificially held.
                    if (n > 0) env.Send(new[] { Key(0x56, 0, Native.KEYEVENTF_KEYUP), Key(0x11, 0, Native.KEYEVENTF_KEYUP) });
                    r.Outcome = "blocked";
                    r.Reason = "error";
                    return r;
                }
                r.Chars = text.Length;
                // Give the target app time to read the clipboard before restoring it.
                env.Sleep(250);
                return r;
            }
            finally
            {
                // Restore every format that was there (or leave it empty if it was empty).
                try { if (previous != null) env.ClipboardSet(previous); else env.ClipboardClear(); } catch { }
            }
        }

        static bool IsElevated(IntPtr process, out bool known)
        {
            known = false;
            IntPtr token;
            if (!Native.OpenProcessToken(process, 0x0008 /* TOKEN_QUERY */, out token)) return false;
            try
            {
                int elevated, len;
                if (!Native.GetTokenInformation(token, 20 /* TokenElevation */, out elevated, 4, out len)) return false;
                known = true;
                return elevated != 0;
            }
            finally { Native.CloseHandle(token); }
        }

        /// <summary>
        /// Best effort: Windows (UIPI) silently drops SendInput aimed at a window of a more
        /// privileged (admin) process. Returns true when the focused window seems elevated and we are not.
        /// </summary>
        public static bool TargetLooksElevated()
        {
            bool known;
            if (IsElevated(Native.GetCurrentProcess(), out known)) return false;
            uint pid;
            Native.GetWindowThreadProcessId(Native.GetForegroundWindow(), out pid);
            if (pid == 0) return false;
            IntPtr p = Native.OpenProcess(0x1000 /* PROCESS_QUERY_LIMITED_INFORMATION */, false, pid);
            if (p == IntPtr.Zero) return false;
            try
            {
                bool elevated = IsElevated(p, out known);
                // Not being allowed to read the token of a process we can see is itself a strong hint.
                return elevated || !known;
            }
            finally { Native.CloseHandle(p); }
        }

        /// <summary>AltGr on ABNT2 and other layouts is reported as Ctrl+Alt with Right Alt down.</summary>
        public static bool IsAltGr(IInputEnv env)
        {
            return env.IsDown(0xA5) && !env.IsDown(0xA4);
        }
    }

    /// <summary>Small borderless topmost label that never activates (keeps focus in the user's window).</summary>
    internal sealed class Overlay : Form
    {
        readonly Label label;

        public Overlay()
        {
            FormBorderStyle = FormBorderStyle.None;
            ShowInTaskbar = false;
            TopMost = true;
            StartPosition = FormStartPosition.Manual;
            BackColor = Color.FromArgb(24, 24, 32);
            Opacity = 0.92;
            Size = new Size(300, 38);
            label = new Label
            {
                Dock = DockStyle.Fill, ForeColor = Color.White, TextAlign = ContentAlignment.MiddleCenter,
                Font = new Font("Segoe UI", 10f, FontStyle.Bold)
            };
            Controls.Add(label);
        }

        protected override bool ShowWithoutActivation { get { return true; } }

        protected override CreateParams CreateParams
        {
            get
            {
                var cp = base.CreateParams;
                cp.ExStyle |= 0x08000000 /* WS_EX_NOACTIVATE */ | 0x00000080 /* WS_EX_TOOLWINDOW */ | 0x00000008 /* WS_EX_TOPMOST */;
                return cp;
            }
        }

        public void ShowText(string text, Color accent)
        {
            label.Text = text;
            label.ForeColor = accent;
            var area = Screen.FromHandle(Native.GetForegroundWindow()).WorkingArea;
            Location = new Point(area.Left + (area.Width - Width) / 2, area.Bottom - Height - 48);
            if (!Visible) Show();
        }
    }

    /// <summary>
    /// Floating round mic button. It never activates (WS_EX_NOACTIVATE, MA_NOACTIVATE on
    /// WM_MOUSEACTIVATE), so clicking it leaves keyboard focus in the user's window, which is
    /// what R1 captures as the insertion target. Left click toggles recording, drag moves it,
    /// right click opens the menu.
    /// </summary>
    internal sealed class MicButton : Form
    {
        const int WM_MOUSEACTIVATE = 0x0021;
        const int MA_NOACTIVATE = 3;
        const int DragThreshold = 4;
        public const int Diameter = 44;

        public event Action Clicked;
        public event Action<Point> Moved;
        public ContextMenuStrip PopupMenu;
        readonly ToolTip tip = new ToolTip { InitialDelay = 400, ShowAlways = true };

        string state = "idle";
        double elapsed, limit = 60;
        Point downScreen, downLocation;
        bool pressed, dragging;

        static readonly Color Gray = Color.FromArgb(90, 90, 104);
        static readonly Color Red = Color.FromArgb(220, 60, 60);
        static readonly Color Amber = Color.FromArgb(222, 160, 40);

        public MicButton()
        {
            FormBorderStyle = FormBorderStyle.None;
            ShowInTaskbar = false;
            TopMost = true;
            StartPosition = FormStartPosition.Manual;
            Size = new Size(Diameter, Diameter);
            BackColor = Color.Magenta;
            TransparencyKey = Color.Magenta; // only the circle is visible and clickable
            DoubleBuffered = true;
            Cursor = Cursors.Hand;
            using (var path = new System.Drawing.Drawing2D.GraphicsPath())
            {
                path.AddEllipse(0, 0, Diameter, Diameter);
                Region = new Region(path);
            }
        }

        protected override bool ShowWithoutActivation { get { return true; } }

        protected override CreateParams CreateParams
        {
            get
            {
                var cp = base.CreateParams;
                cp.ExStyle |= 0x08000000 /* WS_EX_NOACTIVATE */ | 0x00000080 /* WS_EX_TOOLWINDOW */ | 0x00000008 /* WS_EX_TOPMOST */;
                return cp;
            }
        }

        protected override void WndProc(ref Message m)
        {
            // Clicking must not make this window the foreground window.
            if (m.Msg == WM_MOUSEACTIVATE) { m.Result = (IntPtr)MA_NOACTIVATE; return; }
            base.WndProc(ref m);
        }

        public void SetState(string s, string tooltip)
        {
            state = s;
            if (s != "recording") elapsed = 0;
            tip.SetToolTip(this, tooltip);
            Invalidate();
        }

        public void SetElapsed(double seconds, double maxSeconds)
        {
            elapsed = seconds;
            limit = Math.Max(1, maxSeconds);
            Invalidate();
        }

        protected override void OnMouseDown(MouseEventArgs e)
        {
            if (e.Button == MouseButtons.Left)
            {
                pressed = true;
                dragging = false;
                downScreen = Control.MousePosition;
                downLocation = Location;
                Capture = true;
            }
            base.OnMouseDown(e);
        }

        protected override void OnMouseMove(MouseEventArgs e)
        {
            if (pressed)
            {
                var p = Control.MousePosition;
                int dx = p.X - downScreen.X, dy = p.Y - downScreen.Y;
                if (!dragging && (Math.Abs(dx) > DragThreshold || Math.Abs(dy) > DragThreshold)) dragging = true;
                if (dragging) Location = new Point(downLocation.X + dx, downLocation.Y + dy);
            }
            base.OnMouseMove(e);
        }

        protected override void OnMouseUp(MouseEventArgs e)
        {
            if (e.Button == MouseButtons.Left && pressed)
            {
                pressed = false;
                Capture = false;
                if (dragging) { if (Moved != null) Moved(Location); }
                else if (Clicked != null) Clicked();
            }
            else if (e.Button == MouseButtons.Right && PopupMenu != null)
            {
                PopupMenu.Show(this, e.Location);
            }
            base.OnMouseUp(e);
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics;
            g.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
            Color fill = state == "recording" ? Red : state == "processing" || state == "blocked" ? Amber : Gray;
            using (var b = new SolidBrush(fill)) g.FillEllipse(b, 1, 1, Diameter - 2, Diameter - 2);

            if (state == "recording")
            {
                // Elapsed-time ring (fraction of maxSeconds) plus a soft pulse once per second.
                float frac = (float)Math.Min(1.0, elapsed / limit);
                using (var ring = new Pen(Color.White, 3f)) g.DrawArc(ring, 3, 3, Diameter - 7, Diameter - 7, -90, Math.Max(4f, 360f * frac));
                int alpha = (int)(70 + 60 * Math.Abs(Math.Sin(elapsed * Math.PI)));
                using (var pulse = new Pen(Color.FromArgb(alpha, Color.White), 1.5f)) g.DrawEllipse(pulse, 7, 7, Diameter - 15, Diameter - 15);
            }

            // Microphone glyph: capsule, cradle arc and stand.
            using (var w = new SolidBrush(Color.White))
            using (var pen = new Pen(Color.White, 2f))
            using (var capsule = new System.Drawing.Drawing2D.GraphicsPath())
            {
                float cx = Diameter / 2f, top = 11, cw = 8, ch = 14;
                capsule.AddArc(cx - cw / 2, top, cw, cw, 180, 180);
                capsule.AddArc(cx - cw / 2, top + ch - cw, cw, cw, 0, 180);
                capsule.CloseFigure();
                g.FillPath(w, capsule);
                g.DrawArc(pen, cx - 8, top + 4, 16, 14, 0, 180);
                g.DrawLine(pen, cx, top + 18, cx, top + 22);
                g.DrawLine(pen, cx - 4, top + 22, cx + 4, top + 22);
            }
        }

        /// <summary>Saved position if it is still on a screen, otherwise bottom right of the primary screen.</summary>
        public static Point ResolvePosition(Point? saved, Rectangle[] workAreas, Rectangle primary)
        {
            if (saved.HasValue)
            {
                var r = new Rectangle(saved.Value, new Size(Diameter, Diameter));
                foreach (var a in workAreas) if (a.Contains(r)) return saved.Value;
            }
            return new Point(primary.Right - Diameter - 24, primary.Bottom - Diameter - 96);
        }

        /// <summary>Parse {"x":N,"y":N}; null when missing or invalid.</summary>
        public static Point? ParsePosition(string json)
        {
            if (string.IsNullOrEmpty(json)) return null;
            var d = Protocol.Parse(json);
            if (d == null || !d.ContainsKey("x") || !d.ContainsKey("y")) return null;
            try { return new Point(Convert.ToInt32(d["x"]), Convert.ToInt32(d["y"])); }
            catch { return null; }
        }

        public static string FormatPosition(Point p)
        {
            return "{\"x\":" + p.X.ToString(System.Globalization.CultureInfo.InvariantCulture)
                + ",\"y\":" + p.Y.ToString(System.Globalization.CultureInfo.InvariantCulture) + "}\n";
        }
    }

    /// <summary>Hidden window: receives WM_HOTKEY and is the UI-thread marshal target.</summary>
    internal sealed class MessageWindow : Form
    {
        public event Action Hotkey;
        protected override void WndProc(ref Message m)
        {
            if (m.Msg == Native.WM_HOTKEY && Hotkey != null) Hotkey();
            base.WndProc(ref m);
        }
    }

    public static class Host
    {
        // Configuration (set from voice-host.ps1)
        static string mode, trigger, insertMode, outDir, deviceSpec, hotkeyLabel;
        static uint modifiers, vk;
        static int maxSeconds, seconds;
        static bool useOverlay, useTray, useButton;
        static string stateDir;

        static MessageWindow win;
        static MicButton button;
        static MenuItem showButtonItem;
        static ToolStripMenuItem buttonCopyItem;
        static RecordController ctrl;
        // Last foreground window that was not ours nor the taskbar (fallback target for clicks).
        static IntPtr lastExternalFg;
        static IntPtr fgHook;
        static Native.WinEventProc fgProc; // kept in a field so the GC never collects the callback
        static readonly uint ownPid = (uint)System.Diagnostics.Process.GetCurrentProcess().Id;
        static readonly System.Diagnostics.Stopwatch clock = System.Diagnostics.Stopwatch.StartNew();
        static Overlay overlay;
        static NotifyIcon tray;
        static System.Windows.Forms.Timer poll, flash;
        static Recorder recorder;
        static DateTime recStart;
        static uint device;
        static string deviceLabel;
        static int counter;
        static readonly Dictionary<string, Icon> icons = new Dictionary<string, Icon>();
        static readonly IInputEnv env = new WinInputEnv();
        // R1: the window that had focus when the current recording started, and one pending
        // insertion per finished recording (claimed once by a `type` command).
        static IntPtr recTarget;
        static readonly PendingTargets pending = new PendingTargets();
        // Last transcription that could not be inserted; offered for manual copy (memory only).
        static string lastText;
        static MenuItem copyItem;

        static readonly Color Red = Color.FromArgb(255, 95, 95);
        static readonly Color Amber = Color.FromArgb(255, 196, 80);
        static readonly Color Green = Color.FromArgb(110, 220, 140);
        static readonly Color Gray = Color.FromArgb(150, 150, 160);

        public static int Run(string mode_, uint modifiers_, uint vk_, string hotkeyLabel_, string trigger_,
            int maxSeconds_, int seconds_, string device_, string insertMode_, string outDir_, bool overlay_, bool tray_,
            bool button_, string stateDir_)
        {
            mode = mode_; modifiers = modifiers_; vk = vk_; hotkeyLabel = hotkeyLabel_; trigger = trigger_;
            maxSeconds = Math.Max(1, maxSeconds_); seconds = Math.Max(1, seconds_); deviceSpec = device_;
            insertMode = insertMode_; outDir = outDir_; useOverlay = overlay_; useTray = tray_;
            useButton = button_ && mode == "listen"; stateDir = stateDir_;
            ctrl = new RecordController(trigger);
            Protocol.Init();

            if (mode == "devices")
            {
                Protocol.Emit("devices", "devices", Recorder.ListDevices());
                return 0;
            }

            try { device = Recorder.ResolveDevice(deviceSpec, out deviceLabel); }
            catch (Exception e) { Protocol.Emit("error", "code", "device", "message", e.Message); return 4; }

            Directory.CreateDirectory(outDir);
            Application.EnableVisualStyles();
            win = new MessageWindow();
            IntPtr handle = win.Handle; // forces window creation without showing it
            if (useOverlay) { overlay = new Overlay(); IntPtr oh = overlay.Handle; }
            if (useTray) SetupTray();

            poll = new System.Windows.Forms.Timer { Interval = 30 };
            poll.Tick += delegate { OnPoll(); };

            if (mode == "listen")
            {
                if (!Native.RegisterHotKey(handle, 1, modifiers | Native.MOD_NOREPEAT, vk))
                {
                    int err = Marshal.GetLastWin32Error();
                    Protocol.Emit("error", "code", err == 1409 ? "hotkey_in_use" : "hotkey",
                        "message", err == 1409
                            ? "o atalho " + hotkeyLabel + " já está em uso por outro programa"
                            : "RegisterHotKey falhou (erro " + err + ")");
                    Shutdown();
                    return 3;
                }
                win.Hotkey += OnHotkey;
                StartForegroundTracking();
                if (useButton) SetupButton();
                SetState("idle", null);
                Protocol.Emit("ready", "hotkey", hotkeyLabel, "mode", trigger, "device", deviceLabel, "button", useButton);
            }

            StartStdinReader();
            if (mode == "record")
            {
                win.BeginInvoke((Action)delegate { StartRecording("test"); });
            }
            Application.Run();
            Shutdown();
            return 0;
        }

        static void Shutdown()
        {
            try { Native.UnregisterHotKey(win.Handle, 1); } catch { }
            if (recorder != null) { try { recorder.Stop(); } catch { } recorder = null; }
            if (fgHook != IntPtr.Zero) { Native.UnhookWinEvent(fgHook); fgHook = IntPtr.Zero; }
            if (button != null) { try { button.Close(); button.Dispose(); } catch { } button = null; }
            if (tray != null) { tray.Visible = false; tray.Dispose(); tray = null; }
            foreach (var ic in icons.Values) { try { Native.DestroyIcon(ic.Handle); } catch { } }
            icons.Clear();
        }

        static void StartStdinReader()
        {
            var t = new Thread(delegate ()
            {
                var reader = new StreamReader(Console.OpenStandardInput(), new UTF8Encoding(false));
                string line;
                while ((line = reader.ReadLine()) != null)
                {
                    var msg = Protocol.Parse(line);
                    if (msg == null) continue;
                    try { win.BeginInvoke((Action)delegate { OnCommand(msg); }); } catch { break; }
                }
                // Parent closed our stdin (or died): exit instead of lingering.
                try { win.BeginInvoke((Action)delegate { Application.ExitThread(); }); } catch { }
            }) { IsBackground = true, Name = "td-voice-stdin" };
            t.Start();
        }

        static string Str(Dictionary<string, object> m, string k)
        {
            object v;
            return m.TryGetValue(k, out v) && v != null ? v.ToString() : null;
        }

        static void OnCommand(Dictionary<string, object> msg)
        {
            string cmd = Str(msg, "cmd");
            if (cmd == "quit") { Application.ExitThread(); return; }
            if (cmd == "state") { SetState(Str(msg, "state") ?? "idle", Str(msg, "message")); return; }
            if (cmd == "copy") { CopyLast(); return; }
            if (cmd == "drop")
            {
                // Nothing to insert for this recording (silence, nothing recognized, error).
                IntPtr ignored;
                pending.Take(Int(msg, "id"), out ignored);
                return;
            }
            if (cmd == "type")
            {
                string text = Str(msg, "text") ?? "";
                string how = Str(msg, "insertMode") ?? insertMode;
                int id = Int(msg, "id");
                IntPtr target;
                if (!pending.Take(id, out target))
                {
                    // Unknown or already used id: a recording is inserted at most once.
                    Protocol.Emit("warn", "code", "duplicate", "id", id, "message", "pedido de inserção repetido ignorado");
                    return;
                }
                lastText = text;
                if (env.Foreground() == target && Typist.TargetLooksElevated())
                    Protocol.Emit("warn", "code", "elevated",
                        "message", "a janela em foco parece rodar como administrador; o Windows pode bloquear a digitação");
                InsertResult r;
                try { r = Typist.Insert(text, how, target, (int)vk, env, Typist.GraceMs); }
                catch (Exception e)
                {
                    r = new InsertResult { Outcome = "blocked", Reason = "error", Requested = text.Length, Mode = how };
                    Protocol.Emit("error", "code", "type", "message", e.Message);
                }
                if (r.Warning != null) Protocol.Emit("warn", "code", "clipboard", "message", r.Warning);
                if (r.Outcome == "typed")
                {
                    lastText = null;
                    SetCopyEnabled(false);
                    Protocol.Emit("typed", "id", id, "chars", r.Chars, "requested", r.Requested, "insertMode", r.Mode);
                    SetState("idle", null);
                    return;
                }
                // Blocked or interrupted: keep the text for manual copy and say why.
                SetCopyEnabled(true);
                Protocol.Emit("blocked", "id", id, "outcome", r.Outcome, "reason", r.Reason ?? "error", "keys", r.Keys ?? "",
                    "chars", r.Chars, "requested", r.Requested);
                SetState("blocked", BlockedMessage(r));
            }
        }

        static string BlockedMessage(InsertResult r)
        {
            string why = r.Reason == "focus" ? "a janela mudou"
                : r.Reason == "modifier" ? "tecla pressionada (" + r.Keys + ")"
                : r.Reason == "no-target" ? "nenhuma janela em foco"
                : "o Windows recusou a digitação";
            return (r.Outcome == "interrupted" ? "Inserção interrompida: " : "Inserção cancelada: ") + why + " · texto guardado";
        }

        static void CopyLast()
        {
            if (string.IsNullOrEmpty(lastText)) { Protocol.Emit("warn", "code", "nothing", "message", "não há transcrição guardada para copiar"); return; }
            try
            {
                env.ClipboardSetText(lastText);
                Protocol.Emit("copied", "chars", lastText.Length);
                SetState("idle", "Transcrição copiada");
            }
            catch (Exception e) { Protocol.Emit("error", "code", "copy", "message", e.Message); }
        }

        static int Int(Dictionary<string, object> m, string k)
        {
            object v;
            if (!m.TryGetValue(k, out v) || v == null) return -1;
            try { return Convert.ToInt32(v); } catch { return -1; }
        }

        static void OnHotkey()
        {
            // R3: on ABNT2 and similar layouts AltGr is reported as Ctrl+Alt. A Ctrl+Alt hotkey must not
            // fire while the user is typing an AltGr character (AltGr+Q = "/", then Space...).
            if ((modifiers & 0x3) == 0x3 && Typist.IsAltGr(env))
            {
                Protocol.Emit("warn", "code", "altgr", "message", "atalho ignorado: AltGr pressionado (use o Alt da esquerda)");
                return;
            }
            // Releasing Alt/Win after a hotkey would otherwise pop the menu bar / Start menu.
            if ((modifiers & 0x9) != 0) Typist.MaskMenuKey(env);
            Apply(ctrl.HotkeyDown(), "hotkey", "hotkey");
        }

        /// <summary>Mic button or tray icon left click: toggles, whatever voice.mode is.</summary>
        static void OnClick(string source)
        {
            Apply(ctrl.Click(clock.ElapsedMilliseconds), source, source);
        }

        static void Apply(RecAction action, string source, string stopReason)
        {
            if (action == RecAction.Start) StartRecording(source);
            else if (action == RecAction.Stop) StopRecording(stopReason);
        }

        /// <summary>Ours (button, overlay, menus, tooltips) or the taskbar: never an insertion target.</summary>
        static bool IsIgnoredWindow(IntPtr h)
        {
            if (h == IntPtr.Zero) return true;
            uint pid;
            Native.GetWindowThreadProcessId(h, out pid);
            if (pid == ownPid) return true;
            var sb = new StringBuilder(64);
            Native.GetClassName(h, sb, sb.Capacity);
            return TargetPicker.IsShellTrayClass(sb.ToString());
        }

        static void StartForegroundTracking()
        {
            IntPtr fg = env.Foreground();
            if (!IsIgnoredWindow(fg)) lastExternalFg = fg;
            fgProc = delegate (IntPtr hook, uint evt, IntPtr hwnd, int idObject, int idChild, uint thread, uint time)
            {
                if (!IsIgnoredWindow(hwnd)) lastExternalFg = hwnd;
            };
            fgHook = Native.SetWinEventHook(Native.EVENT_SYSTEM_FOREGROUND, Native.EVENT_SYSTEM_FOREGROUND,
                IntPtr.Zero, fgProc, 0, 0, Native.WINEVENT_OUTOFCONTEXT);
        }

        static string ButtonFile() { return string.IsNullOrEmpty(stateDir) ? null : Path.Combine(stateDir, "button.json"); }

        static void SetupButton()
        {
            button = new MicButton();
            Point? saved = null;
            try { string f = ButtonFile(); if (f != null && File.Exists(f)) saved = MicButton.ParsePosition(File.ReadAllText(f)); } catch { }
            var areas = new List<Rectangle>();
            foreach (var s in Screen.AllScreens) areas.Add(s.WorkingArea);
            button.Location = MicButton.ResolvePosition(saved, areas.ToArray(), Screen.PrimaryScreen.WorkingArea);
            button.Clicked += delegate { OnClick("button"); };
            button.Moved += delegate (Point p)
            {
                try
                {
                    string f = ButtonFile();
                    if (f == null) return;
                    Directory.CreateDirectory(stateDir);
                    File.WriteAllText(f, MicButton.FormatPosition(p));
                }
                catch { /* position is a convenience only */ }
            };
            var menu = new ContextMenuStrip();
            buttonCopyItem = new ToolStripMenuItem("Copiar última transcrição não inserida", null, delegate { CopyLast(); }) { Enabled = false };
            menu.Items.Add(buttonCopyItem);
            menu.Items.Add("Esconder botão", null, delegate { ShowButton(false); });
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add("Sair", null, delegate
            {
                Protocol.Emit("quit", "reason", "button");
                Application.ExitThread();
            });
            button.PopupMenu = menu;
            ShowButton(true);
        }

        static void ShowButton(bool show)
        {
            if (button == null) return;
            if (show) button.Show(); else button.Hide();
            if (showButtonItem != null) showButtonItem.Enabled = !show;
        }

        static void SetCopyEnabled(bool on)
        {
            if (copyItem != null) copyItem.Enabled = on;
            if (buttonCopyItem != null) buttonCopyItem.Enabled = on;
        }

        static void StartRecording(string source)
        {
            recorder = new Recorder();
            try { recorder.Start(device); }
            catch (Exception e)
            {
                recorder = null;
                ctrl.StartFailed();
                Protocol.Emit("error", "code", "mic", "message", e.Message);
                SetState("error", e.Message);
                if (mode == "record") Application.ExitThread();
                return;
            }
            recStart = DateTime.UtcNow;
            ctrl.Started(source, clock.ElapsedMilliseconds);
            // R1: text may only go back to this window. A click on our button keeps the user's
            // window in the foreground; anything of ours or the taskbar falls back to the last
            // external foreground window; zero means the insertion will be blocked (no-target).
            recTarget = TargetPicker.ChooseTarget(env.Foreground(), lastExternalFg, IsIgnoredWindow);
            SetState("recording", null);
            Protocol.Emit("recording", "device", deviceLabel, "source", source, "target", recTarget != IntPtr.Zero);
            poll.Start();
        }

        static void OnPoll()
        {
            if (recorder == null) { poll.Stop(); return; }
            double elapsed = (DateTime.UtcNow - recStart).TotalSeconds;
            int limit = mode == "record" ? seconds : maxSeconds;
            if (elapsed >= limit) { StopRecording(mode == "record" ? "done" : "max"); return; }
            if (mode == "listen" && !env.IsDown((int)vk) && ctrl.HotkeyReleased() == RecAction.Stop)
            {
                StopRecording("release");
                return;
            }
            if (button != null) button.SetElapsed(elapsed, limit);
            if (overlay != null)
            {
                string hint = mode == "record" ? "teste: " + (int)Math.Ceiling(limit - elapsed) + "s"
                    : ctrl.Source == "button" || ctrl.Source == "tray" ? "clique de novo para parar"
                    : trigger == "toggle" ? "atalho de novo para parar" : "solte para parar";
                overlay.ShowText("● Gravando " + (int)elapsed + "s  ·  " + hint, Red);
            }
        }

        static void StopRecording(string reason)
        {
            poll.Stop();
            var rec = recorder;
            recorder = null;
            if (rec == null) return;
            string source = ctrl.Source;
            ctrl.BeginStop();
            try { FinishRecording(rec, reason, source); }
            finally { ctrl.Stopped(clock.ElapsedMilliseconds); }
        }

        static void FinishRecording(Recorder rec, string reason, string source)
        {
            byte[] data = rec.Stop();
            int ms = data.Length * 1000 / (Recorder.Rate * 2);
            if (rec.Error != null) Protocol.Emit("error", "code", "mic", "message", rec.Error);
            if (ms < 300)
            {
                Protocol.Emit("cancelled", "reason", "short", "durationMs", ms);
                SetState("idle", "gravação muito curta");
                if (mode == "record") Application.ExitThread();
                return;
            }
            int id = ++counter;
            string path = Path.Combine(outDir, "td-voice-" + System.Diagnostics.Process.GetCurrentProcess().Id + "-" + id + ".wav");
            try { Recorder.WriteWav(path, data); }
            catch (Exception e)
            {
                Protocol.Emit("error", "code", "wav", "message", e.Message);
                SetState("error", e.Message);
                return;
            }
            if (mode == "listen") pending.Add(id, recTarget);
            SetState("processing", null);
            Protocol.Emit("audio", "id", id, "path", path, "durationMs", ms, "peak", rec.Peak, "reason", reason, "source", source ?? "");
            if (mode == "record") Application.ExitThread();
        }

        // ---- indicators -------------------------------------------------------------

        static Icon Dot(string key, Color c)
        {
            Icon icon;
            if (icons.TryGetValue(key, out icon)) return icon;
            using (var bmp = new Bitmap(16, 16))
            using (var g = Graphics.FromImage(bmp))
            using (var b = new SolidBrush(c))
            {
                g.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
                g.Clear(Color.Transparent);
                g.FillEllipse(b, 2, 2, 12, 12);
                icon = Icon.FromHandle(bmp.GetHicon());
            }
            icons[key] = icon;
            return icon;
        }

        static void SetupTray()
        {
            tray = new NotifyIcon { Icon = Dot("idle", Gray), Visible = true, Text = "Terminal-Design voz" };
            var menu = new ContextMenu();
            copyItem = new MenuItem("Copiar última transcrição não inserida", delegate { CopyLast(); }) { Enabled = false };
            menu.MenuItems.Add(copyItem);
            menu.MenuItems.Add("Sair da digitação por voz", delegate
            {
                Protocol.Emit("quit", "reason", "tray");
                Application.ExitThread();
            });
            showButtonItem = new MenuItem("Mostrar botão do microfone", delegate { ShowButton(true); }) { Enabled = false };
            menu.MenuItems.Add(1, showButtonItem);
            tray.ContextMenu = menu;
            // Left click on the tray icon toggles recording, like the mic button.
            tray.MouseClick += delegate (object sender, MouseEventArgs e) { if (e.Button == MouseButtons.Left) OnClick("tray"); };
        }

        static string ButtonTip(string state)
        {
            if (state == "recording") return "Gravando: clique para parar";
            if (state == "processing") return "Transcrevendo…";
            if (state == "blocked") return "texto guardado, clique com o botão direito para copiar";
            return "Clique para falar (ou " + hotkeyLabel + ")";
        }

        static string Clip(string s, int max) { return s.Length <= max ? s : s.Substring(0, max - 1) + "…"; }

        static void SetState(string state, string message)
        {
            Color c = state == "recording" ? Red : state == "processing" || state == "blocked" ? Amber : state == "error" ? Red : Gray;
            string tip;
            if (state == "recording") tip = "Gravando…";
            else if (state == "processing") tip = "Transcrevendo…";
            else if (state == "blocked") tip = "Texto guardado: clique com o botão direito para copiar";
            else if (state == "error") tip = "Erro: " + (message ?? "");
            else tip = "Voz pronta (" + hotkeyLabel + ")";
            if (tray != null)
            {
                tray.Icon = Dot(state == "error" ? "error" : state, c);
                tray.Text = Clip("TD " + tip, 63); // NotifyIcon.Text throws above 63 chars
            }
            if (button != null) button.SetState(state == "error" ? "idle" : state, ButtonTip(state));
            if (overlay == null) return;
            if (flash != null) { flash.Stop(); flash.Dispose(); flash = null; }
            if (state == "processing") overlay.ShowText("◌ Transcrevendo…", Amber);
            else if (state == "recording") overlay.ShowText("● Gravando…", Red);
            else if (message != null)
            {
                // Short-lived notice (e.g. "nada reconhecido"), then hide.
                overlay.ShowText(Clip(message, state == "blocked" ? 70 : 44), state == "error" ? Red : state == "blocked" ? Amber : Green);
                // Blocked insertions stay visible longer so the user notices the text was kept.
                var t = new System.Windows.Forms.Timer { Interval = state == "blocked" ? 6000 : 2200 };
                t.Tick += delegate { t.Stop(); if (flash == t) { flash = null; overlay.Hide(); } t.Dispose(); };
                flash = t;
                t.Start();
            }
            else overlay.Hide();
        }
    }
}
