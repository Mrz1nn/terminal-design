// Terminal-Design voice host (compiled at runtime by voice-host.ps1 through Add-Type).
//
// Responsibilities (everything that needs Win32):
//   - global hotkey (RegisterHotKey) + key-release polling (GetAsyncKeyState) for push-to-talk
//   - microphone capture with the winmm waveIn API, 16 kHz / mono / 16-bit PCM WAV
//   - text insertion into the focused window (SendInput KEYEVENTF_UNICODE, or clipboard + Ctrl+V)
//   - indicators: tray NotifyIcon + small topmost overlay that never takes focus
//
// It talks to Node over stdin/stdout, one JSON object per line (UTF-8).
//   host -> node: {"event":"ready"|"recording"|"audio"|"cancelled"|"typed"|"devices"|"warn"|"error"|"quit", ...}
//   node -> host: {"cmd":"type"|"state"|"quit", ...}
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

    /// <summary>Text insertion into whatever window has keyboard focus.</summary>
    internal static class Typist
    {
        static readonly int InputSize = Marshal.SizeOf(typeof(Native.INPUT));
        static readonly int[] ModifierKeys = { 0x10, 0x11, 0x12, 0x5B, 0x5C }; // Shift, Ctrl, Alt, LWin, RWin

        static Native.INPUT Key(ushort vk, ushort scan, uint flags)
        {
            var i = new Native.INPUT { type = Native.INPUT_KEYBOARD };
            i.u.ki = new Native.KEYBDINPUT { wVk = vk, wScan = scan, dwFlags = flags };
            return i;
        }

        /// <summary>Typing while the user still holds Ctrl/Alt would turn letters into shortcuts.</summary>
        public static void WaitModifiersReleased(int hotkeyVk, int timeoutMs)
        {
            var until = DateTime.UtcNow.AddMilliseconds(timeoutMs);
            while (DateTime.UtcNow < until)
            {
                bool down = hotkeyVk != 0 && (Native.GetAsyncKeyState(hotkeyVk) & 0x8000) != 0;
                foreach (int k in ModifierKeys) if ((Native.GetAsyncKeyState(k) & 0x8000) != 0) down = true;
                if (!down) return;
                Thread.Sleep(15);
            }
        }

        /// <summary>
        /// Taps an unassigned virtual key (0xE8) so that releasing Alt/Win after the hotkey
        /// does not open the window menu bar / Start menu (same trick AutoHotkey uses).
        /// </summary>
        public static void MaskMenuKey()
        {
            var inputs = new[] { Key(0xE8, 0, 0), Key(0xE8, 0, Native.KEYEVENTF_KEYUP) };
            Native.SendInput((uint)inputs.Length, inputs, InputSize);
        }

        public static int TypeUnicode(string text)
        {
            int sent = 0;
            const int chunk = 32; // small batches: some console hosts drop very large bursts
            for (int start = 0; start < text.Length; start += chunk)
            {
                int end = Math.Min(text.Length, start + chunk);
                var list = new List<Native.INPUT>();
                for (int i = start; i < end; i++)
                {
                    ushort c = text[i];
                    list.Add(Key(0, c, Native.KEYEVENTF_UNICODE));
                    list.Add(Key(0, c, Native.KEYEVENTF_UNICODE | Native.KEYEVENTF_KEYUP));
                }
                var arr = list.ToArray();
                sent += (int)Native.SendInput((uint)arr.Length, arr, InputSize);
                Thread.Sleep(5);
            }
            return sent / 2;
        }

        public static int Paste(string text)
        {
            string previous = null;
            try { if (Clipboard.ContainsText()) previous = Clipboard.GetText(); } catch { }
            Clipboard.SetText(text);
            var inputs = new[]
            {
                Key(0x11, 0, 0), Key(0x56, 0, 0), Key(0x56, 0, Native.KEYEVENTF_KEYUP), Key(0x11, 0, Native.KEYEVENTF_KEYUP)
            };
            uint n = Native.SendInput((uint)inputs.Length, inputs, InputSize);
            // Give the target app time to read the clipboard before restoring it.
            Thread.Sleep(250);
            try { if (previous != null) Clipboard.SetText(previous); else Clipboard.Clear(); } catch { }
            return n == inputs.Length ? text.Length : 0;
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
        static bool useOverlay, useTray;

        static MessageWindow win;
        static Overlay overlay;
        static NotifyIcon tray;
        static System.Windows.Forms.Timer poll, flash;
        static Recorder recorder;
        static DateTime recStart;
        static uint device;
        static string deviceLabel;
        static int counter;
        static readonly Dictionary<string, Icon> icons = new Dictionary<string, Icon>();

        static readonly Color Red = Color.FromArgb(255, 95, 95);
        static readonly Color Amber = Color.FromArgb(255, 196, 80);
        static readonly Color Green = Color.FromArgb(110, 220, 140);
        static readonly Color Gray = Color.FromArgb(150, 150, 160);

        public static int Run(string mode_, uint modifiers_, uint vk_, string hotkeyLabel_, string trigger_,
            int maxSeconds_, int seconds_, string device_, string insertMode_, string outDir_, bool overlay_, bool tray_)
        {
            mode = mode_; modifiers = modifiers_; vk = vk_; hotkeyLabel = hotkeyLabel_; trigger = trigger_;
            maxSeconds = Math.Max(1, maxSeconds_); seconds = Math.Max(1, seconds_); deviceSpec = device_;
            insertMode = insertMode_; outDir = outDir_; useOverlay = overlay_; useTray = tray_;
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
                SetState("idle", null);
                Protocol.Emit("ready", "hotkey", hotkeyLabel, "mode", trigger, "device", deviceLabel);
            }

            StartStdinReader();
            if (mode == "record")
            {
                win.BeginInvoke((Action)delegate { StartRecording(); });
            }
            Application.Run();
            Shutdown();
            return 0;
        }

        static void Shutdown()
        {
            try { Native.UnregisterHotKey(win.Handle, 1); } catch { }
            if (recorder != null) { try { recorder.Stop(); } catch { } recorder = null; }
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
            if (cmd == "type")
            {
                string text = Str(msg, "text") ?? "";
                string how = Str(msg, "insertMode") ?? insertMode;
                Typist.WaitModifiersReleased((int)vk, 3000);
                if (Typist.TargetLooksElevated())
                    Protocol.Emit("warn", "code", "elevated",
                        "message", "a janela em foco parece rodar como administrador; o Windows pode bloquear a digitação");
                int n = 0;
                try { n = how == "paste" ? Typist.Paste(text) : Typist.TypeUnicode(text); }
                catch (Exception e) { Protocol.Emit("error", "code", "type", "message", e.Message); }
                Protocol.Emit("typed", "chars", n, "requested", text.Length, "insertMode", how);
                SetState("idle", null);
            }
        }

        static void OnHotkey()
        {
            // Releasing Alt/Win after a hotkey would otherwise pop the menu bar / Start menu.
            if ((modifiers & 0x9) != 0) Typist.MaskMenuKey();
            if (recorder == null) StartRecording();
            else if (trigger == "toggle") StopRecording("hotkey");
        }

        static void StartRecording()
        {
            recorder = new Recorder();
            try { recorder.Start(device); }
            catch (Exception e)
            {
                recorder = null;
                Protocol.Emit("error", "code", "mic", "message", e.Message);
                SetState("error", e.Message);
                if (mode == "record") Application.ExitThread();
                return;
            }
            recStart = DateTime.UtcNow;
            SetState("recording", null);
            Protocol.Emit("recording", "device", deviceLabel);
            poll.Start();
        }

        static void OnPoll()
        {
            if (recorder == null) { poll.Stop(); return; }
            double elapsed = (DateTime.UtcNow - recStart).TotalSeconds;
            int limit = mode == "record" ? seconds : maxSeconds;
            if (elapsed >= limit) { StopRecording(mode == "record" ? "done" : "max"); return; }
            if (mode == "listen" && trigger == "push-to-talk" && (Native.GetAsyncKeyState((int)vk) & 0x8000) == 0)
            {
                StopRecording("release");
                return;
            }
            if (overlay != null)
            {
                string hint = mode == "record" ? "teste: " + (int)Math.Ceiling(limit - elapsed) + "s"
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
            string path = Path.Combine(outDir, "td-voice-" + System.Diagnostics.Process.GetCurrentProcess().Id + "-" + (++counter) + ".wav");
            try { Recorder.WriteWav(path, data); }
            catch (Exception e)
            {
                Protocol.Emit("error", "code", "wav", "message", e.Message);
                SetState("error", e.Message);
                return;
            }
            SetState("processing", null);
            Protocol.Emit("audio", "path", path, "durationMs", ms, "peak", rec.Peak, "reason", reason);
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
            menu.MenuItems.Add("Sair da digitação por voz", delegate
            {
                Protocol.Emit("quit", "reason", "tray");
                Application.ExitThread();
            });
            tray.ContextMenu = menu;
        }

        static string Clip(string s, int max) { return s.Length <= max ? s : s.Substring(0, max - 1) + "…"; }

        static void SetState(string state, string message)
        {
            Color c = state == "recording" ? Red : state == "processing" ? Amber : state == "error" ? Red : Gray;
            string tip;
            if (state == "recording") tip = "Gravando…";
            else if (state == "processing") tip = "Transcrevendo…";
            else if (state == "error") tip = "Erro: " + (message ?? "");
            else tip = "Voz pronta (" + hotkeyLabel + ")";
            if (tray != null)
            {
                tray.Icon = Dot(state == "error" ? "error" : state, c);
                tray.Text = Clip("TD " + tip, 63); // NotifyIcon.Text throws above 63 chars
            }
            if (overlay == null) return;
            if (flash != null) { flash.Stop(); flash.Dispose(); flash = null; }
            if (state == "processing") overlay.ShowText("◌ Transcrevendo…", Amber);
            else if (state == "recording") overlay.ShowText("● Gravando…", Red);
            else if (message != null)
            {
                // Short-lived notice (e.g. "nada reconhecido"), then hide.
                overlay.ShowText(Clip(message, 44), state == "error" ? Red : Green);
                var t = new System.Windows.Forms.Timer { Interval = 2200 };
                t.Tick += delegate { t.Stop(); if (flash == t) { flash = null; overlay.Hide(); } t.Dispose(); };
                flash = t;
                t.Start();
            }
            else overlay.Hide();
        }
    }
}
