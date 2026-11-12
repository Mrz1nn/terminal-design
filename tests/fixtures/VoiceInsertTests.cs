// Unit tests for the voice host's insertion safety rules (R1 focus, R2 modifiers, clipboard,
// single insertion). Compiled together with apps/voice-engine/native/voice-host.cs by
// tests/voice-insert.test.js. Everything runs against FakeEnv: no real keyboard input,
// no real window focus, no real clipboard, no audio.
using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using System.Web.Script.Serialization;
using System.Windows.Forms;

namespace TerminalDesign.Voice.Tests
{
    internal sealed class FakeEnv : IInputEnv
    {
        public IntPtr Fg = new IntPtr(100);
        public readonly HashSet<int> Down = new HashSet<int>();
        public readonly List<Native.INPUT> Sent = new List<Native.INPUT>();
        public int SendCalls, Sleeps, ClipSetTextCalls, ClipSetCalls, ClipClearCalls, ClipGetCalls;
        public int AcceptLimit = -1;              // accept only N inputs in the next Send (then reset)
        public Action<FakeEnv> AfterSend;         // e.g. move focus after the first batch
        public Action<FakeEnv, int> OnSleep;      // e.g. release a key after k sleeps
        public Action<FakeEnv> OnClipboardText;   // e.g. move focus right after the clipboard write
        public IDataObject Clip;
        public bool ClipGetThrows;
        public string ClipText;

        public IntPtr Foreground() { return Fg; }
        public bool IsDown(int vk) { return Down.Contains(vk); }
        public uint Send(Native.INPUT[] inputs)
        {
            SendCalls++;
            int n = AcceptLimit >= 0 ? Math.Min(AcceptLimit, inputs.Length) : inputs.Length;
            AcceptLimit = -1;
            for (int i = 0; i < n; i++) Sent.Add(inputs[i]);
            if (AfterSend != null) AfterSend(this);
            return (uint)n;
        }
        public void Sleep(int ms) { Sleeps++; if (OnSleep != null) OnSleep(this, Sleeps); }
        public IDataObject ClipboardGet() { ClipGetCalls++; if (ClipGetThrows) throw new InvalidOperationException("locked"); return Clip; }
        public void ClipboardSetText(string text) { ClipSetTextCalls++; ClipText = text; Clip = new DataObject(DataFormats.UnicodeText, text); if (OnClipboardText != null) OnClipboardText(this); }
        public void ClipboardSet(IDataObject data) { ClipSetCalls++; Clip = data; }
        public void ClipboardClear() { ClipClearCalls++; Clip = null; }
        public bool Elevated;                     // target window runs as administrator
        public bool TargetElevated(IntPtr target) { return Elevated; }

        /// <summary>Text delivered by Unicode key-downs.</summary>
        public string Typed()
        {
            var sb = new StringBuilder();
            foreach (var i in Sent)
                if ((i.u.ki.dwFlags & Native.KEYEVENTF_UNICODE) != 0 && (i.u.ki.dwFlags & Native.KEYEVENTF_KEYUP) == 0) sb.Append((char)i.u.ki.wScan);
            return sb.ToString();
        }

        /// <summary>Keys pressed by us and never released (must always be empty).</summary>
        public List<string> StuckKeys()
        {
            var net = new Dictionary<string, int>();
            foreach (var i in Sent)
            {
                bool uni = (i.u.ki.dwFlags & Native.KEYEVENTF_UNICODE) != 0;
                string k = uni ? "u" + i.u.ki.wScan : "vk" + i.u.ki.wVk;
                int d = (i.u.ki.dwFlags & Native.KEYEVENTF_KEYUP) != 0 ? -1 : 1;
                int v; net.TryGetValue(k, out v); net[k] = v + d;
            }
            var stuck = new List<string>();
            foreach (var kv in net) if (kv.Value > 0) stuck.Add(kv.Key);
            return stuck;
        }

        public bool SentCtrlV()
        {
            foreach (var i in Sent) if ((i.u.ki.dwFlags & Native.KEYEVENTF_UNICODE) == 0 && i.u.ki.wVk == 0x56 && (i.u.ki.dwFlags & Native.KEYEVENTF_KEYUP) == 0) return true;
            return false;
        }
    }

    public static class InsertTests
    {
        static readonly IntPtr Target = new IntPtr(100);
        static readonly IntPtr Other = new IntPtr(200);
        const int HotkeyVk = 0x78; // F9

        static List<Dictionary<string, object>> results;

        static void Check(string name, bool ok, string detail)
        {
            results.Add(new Dictionary<string, object> { { "name", name }, { "ok", ok }, { "detail", detail ?? "" } });
        }

        static string Describe(InsertResult r, FakeEnv e)
        {
            return "outcome=" + r.Outcome + " reason=" + r.Reason + " keys=" + r.Keys + " chars=" + r.Chars +
                " mode=" + r.Mode + " typed='" + e.Typed() + "' stuck=" + string.Join(",", e.StuckKeys().ToArray()) +
                " sends=" + e.SendCalls + " clipSetText=" + e.ClipSetTextCalls;
        }

        static InsertResult Run(FakeEnv e, string text, string how = "type", int grace = 150)
        {
            return Typist.Insert(text, how, Target, HotkeyVk, e, grace);
        }

        static void Blocked(string name, FakeEnv e, InsertResult r, string reason, string keys)
        {
            bool ok = r.Outcome == "blocked" && r.Reason == reason && r.Chars == 0 && e.Sent.Count == 0
                && (keys == null || r.Keys == keys) && e.StuckKeys().Count == 0;
            Check(name, ok, Describe(r, e));
        }

        /// <summary>Semi-transparent reddish pixels above the mic disc (the recording halo).</summary>
        static int HaloPixels(System.Drawing.Bitmap bmp)
        {
            var mic = PillLayout.MicRect(false, false, 1f);
            double cx = mic.X + mic.Width / 2.0, cy = mic.Y + mic.Height / 2.0, r = mic.Width / 2.0 + 1.5;
            int n = 0;
            for (int y = 0; y < bmp.Height; y++)
                for (int x = 0; x < bmp.Width; x++)
                {
                    double dx = x + 0.5 - cx, dy = y + 0.5 - cy;
                    if (dx * dx + dy * dy <= r * r || dy > 2) continue; // skip the disc and the lowered shadow
                    var c = bmp.GetPixel(x, y);
                    if (c.A > 8 && c.R > c.B + 20) n++;
                }
            return n;
        }

        public static string RunAll()
        {
            results = new List<Dictionary<string, object>>();

            // ---- R1: focus ----------------------------------------------------------
            { var e = new FakeEnv { Fg = Other }; var r = Run(e, "olá mundo");
              Blocked("focus changed during processing: nothing typed", e, r, "focus", null); }

            { var e = new FakeEnv(); e.Down.Add(0x11);
              e.OnSleep = (f, n) => { if (n == 2) { f.Down.Clear(); f.Fg = Other; } };
              var r = Run(e, "texto");
              Blocked("focus changed right before insertion (during the key-release wait)", e, r, "focus", null); }

            { var e = new FakeEnv(); string text = new string('a', 100);
              e.AfterSend = f => { if (f.SendCalls == 1) f.Fg = Other; };
              var r = Run(e, text);
              Check("focus changed mid-typing: stops after the current batch, no stuck keys",
                  r.Outcome == "interrupted" && r.Reason == "focus" && r.Chars == 32 && e.Typed().Length == 32 && e.StuckKeys().Count == 0, Describe(r, e)); }

            { var e = new FakeEnv(); var r = Typist.Insert("x", "type", IntPtr.Zero, HotkeyVk, e, 150);
              Blocked("no window had focus when recording started", e, r, "no-target", null); }

            // ---- R2: modifiers --------------------------------------------------------
            { var e = new FakeEnv(); e.Down.Add(0x11); var r = Run(e, "abc");
              Blocked("Ctrl held: blocked, no shortcut sent", e, r, "modifier", "Ctrl");
              Check("Ctrl held: waited the grace period before giving up", e.Sleeps >= 9, "sleeps=" + e.Sleeps); }

            { var e = new FakeEnv(); e.Down.Add(0x12); e.Down.Add(0xA4); var r = Run(e, "abc");
              Blocked("Alt held: blocked", e, r, "modifier", "Alt"); }

            { var e = new FakeEnv(); e.Down.Add(0xA1); var r = Run(e, "abc");
              Blocked("Shift held (right Shift): blocked", e, r, "modifier", "Shift"); }

            { var e = new FakeEnv(); e.Down.Add(0x5B); var r = Run(e, "abc");
              Blocked("Win held: blocked", e, r, "modifier", "Win"); }

            { var e = new FakeEnv(); e.Down.Add(0x11); e.Down.Add(0x10); var r = Run(e, "abc");
              Blocked("Ctrl+Shift held: blocked", e, r, "modifier", "Ctrl+Shift"); }

            { var e = new FakeEnv(); e.Down.Add(0x11); e.Down.Add(0x12); e.Down.Add(0xA4); var r = Run(e, "abc");
              Blocked("Ctrl+Alt held: blocked", e, r, "modifier", "Ctrl+Alt"); }

            { var e = new FakeEnv(); e.Down.Add(0x11); e.Down.Add(0x12); e.Down.Add(0xA5); var r = Run(e, "abc");
              Blocked("AltGr held (ABNT2): blocked and shown as AltGr", e, r, "modifier", "AltGr"); }

            { var e = new FakeEnv(); e.Down.Add(HotkeyVk); var r = Run(e, "abc");
              Blocked("hotkey key still held: blocked", e, r, "modifier", "tecla do atalho"); }

            { var e = new FakeEnv(); e.Down.Add(0x11);
              e.OnSleep = (f, n) => { if (n == 3) f.Down.Clear(); };
              var r = Run(e, "pronto");
              Check("modifier released within the grace period: text typed once",
                  r.Outcome == "typed" && e.Typed() == "pronto" && e.StuckKeys().Count == 0, Describe(r, e)); }

            { var e = new FakeEnv(); string text = new string('b', 70);
              e.AfterSend = f => { if (f.SendCalls == 1) f.Down.Add(0x11); };
              var r = Run(e, text);
              Check("Ctrl pressed mid-typing: stops, no stuck keys",
                  r.Outcome == "interrupted" && r.Reason == "modifier" && r.Chars == 32 && e.StuckKeys().Count == 0, Describe(r, e)); }

            // ---- cancellation leaves everything untouched -------------------------------
            { var e = new FakeEnv(); e.Down.Add(0x10); e.Clip = new DataObject(DataFormats.UnicodeText, "do usuário");
              var r = Run(e, "novo", "paste");
              Check("cancelled paste never touches the clipboard",
                  r.Outcome == "blocked" && e.ClipGetCalls == 0 && e.ClipSetTextCalls == 0 && e.ClipSetCalls == 0 && e.ClipClearCalls == 0 && e.Sent.Count == 0, Describe(r, e)); }

            // ---- normal typing -------------------------------------------------------
            { var e = new FakeEnv(); string text = "Olá, ação — “aspas” ✓ çÇ 123";
              var r = Run(e, text);
              Check("normal typing: exact Unicode text, once, no stuck keys",
                  r.Outcome == "typed" && e.Typed() == text && r.Chars == text.Length && e.StuckKeys().Count == 0, Describe(r, e)); }

            { var e = new FakeEnv(); e.AcceptLimit = 3; var r = Run(e, "abcdef");
              Check("Windows accepts an odd part of a batch: the dangling key-down is released",
                  r.Outcome == "interrupted" && r.Reason == "error" && e.StuckKeys().Count == 0, Describe(r, e)); }

            // ---- clipboard (paste mode) -------------------------------------------------
            { var e = new FakeEnv(); var old = new DataObject();
              old.SetData(DataFormats.UnicodeText, false, "conteúdo antigo");
              old.SetData("Custom.Format", false, new MemoryStream(new byte[] { 1, 2, 3 }));
              e.Clip = old;
              var r = Run(e, "colado", "paste");
              var restored = e.Clip;
              bool textBack = restored != null && (restored.GetData(DataFormats.UnicodeText) as string) == "conteúdo antigo";
              var ms = restored == null ? null : restored.GetData("Custom.Format") as MemoryStream;
              bool bytesBack = ms != null && ms.ToArray().Length == 3 && ms.ToArray()[2] == 3;
              Check("paste restores every clipboard format afterwards",
                  r.Outcome == "typed" && r.Mode == "paste" && e.SentCtrlV() && e.ClipText == "colado" && textBack && bytesBack && e.StuckKeys().Count == 0,
                  Describe(r, e) + " textBack=" + textBack + " bytesBack=" + bytesBack); }

            { var e = new FakeEnv { Clip = null }; var r = Run(e, "x", "paste");
              Check("paste with an empty clipboard leaves it empty again",
                  r.Outcome == "typed" && e.ClipClearCalls == 1 && e.Clip == null, Describe(r, e)); }

            { var e = new FakeEnv { ClipGetThrows = true }; var r = Run(e, "seguro", "paste");
              Check("unreadable clipboard is never overwritten: types instead",
                  r.Outcome == "typed" && r.Mode == "type" && e.ClipSetTextCalls == 0 && e.Typed() == "seguro" && r.Warning != null, Describe(r, e)); }

            { var e = new FakeEnv { Clip = new DataObject(DataFormats.UnicodeText, "antes") };
              e.OnClipboardText = f => f.Fg = Other;
              var r = Run(e, "x", "paste");
              Check("focus moves right after the clipboard write: no Ctrl+V, clipboard restored",
                  r.Outcome == "blocked" && r.Reason == "focus" && !e.SentCtrlV() && (e.Clip.GetData(DataFormats.UnicodeText) as string) == "antes", Describe(r, e)); }

            { var e = new FakeEnv { Clip = new DataObject(DataFormats.UnicodeText, "antes") };
              e.AcceptLimit = 2; // Ctrl down + V down accepted, ups rejected
              var r = Run(e, "x", "paste");
              Check("partial Ctrl+V batch: Ctrl and V are released, clipboard restored",
                  r.Outcome == "blocked" && e.StuckKeys().Count == 0 && (e.Clip.GetData(DataFormats.UnicodeText) as string) == "antes", Describe(r, e)); }

            // ---- single insertion per recording ---------------------------------------
            { var p = new PendingTargets(); p.Add(7, Target); IntPtr t1, t2;
              bool first = p.Take(7, out t1); bool second = p.Take(7, out t2);
              Check("a recording id can be inserted only once", first && t1 == Target && !second && p.Count == 0, "first=" + first + " second=" + second); }

            { var p = new PendingTargets(); IntPtr t;
              Check("unknown recording id is refused", !p.Take(42, out t), ""); }

            // ---- AltGr detection (R3) --------------------------------------------------
            { var e = new FakeEnv(); e.Down.Add(0x11); e.Down.Add(0x12); e.Down.Add(0xA5);
              var l = new FakeEnv(); l.Down.Add(0x11); l.Down.Add(0x12); l.Down.Add(0xA4);
              Check("AltGr is told apart from left Ctrl+Alt", Typist.IsAltGr(e) && !Typist.IsAltGr(l), ""); }

            // ---- R1 target choice for button / tray clicks ------------------------------
            { var user = new IntPtr(100); var last = new IntPtr(300);
              var btn = new IntPtr(901); var ovl = new IntPtr(902); var trayMenu = new IntPtr(903);
              var own = new HashSet<IntPtr> { btn, ovl, trayMenu };
              Check("target: foreground is the user's window (button never activates)",
                  TargetPicker.ChooseTarget(user, last, own) == user, "");
              Check("target: foreground is our button: falls back to last external window",
                  TargetPicker.ChooseTarget(btn, last, own) == last, "");
              Check("target: foreground is the overlay or tray menu: last external window",
                  TargetPicker.ChooseTarget(ovl, last, own) == last && TargetPicker.ChooseTarget(trayMenu, last, own) == last, "");
              Check("target: no foreground window: last external window",
                  TargetPicker.ChooseTarget(IntPtr.Zero, last, own) == last, "");
              Check("target: ours and no external window known: no-target (zero)",
                  TargetPicker.ChooseTarget(btn, IntPtr.Zero, own) == IntPtr.Zero
                  && TargetPicker.ChooseTarget(IntPtr.Zero, IntPtr.Zero, own) == IntPtr.Zero, "");
              Check("target: a stale last external that is ours is never used",
                  TargetPicker.ChooseTarget(btn, ovl, own) == IntPtr.Zero, "");
              Check("target: taskbar classes are recognized (tray click focuses the taskbar)",
                  TargetPicker.IsShellTrayClass("Shell_TrayWnd") && TargetPicker.IsShellTrayClass("NotifyIconOverflowWindow")
                  && !TargetPicker.IsShellTrayClass("CASCADIA_HOSTING_WINDOW_CLASS") && !TargetPicker.IsShellTrayClass(null), "");
              var p = new PendingTargets(); IntPtr t;
              p.Add(7, TargetPicker.ChooseTarget(btn, IntPtr.Zero, own));
              var e = new FakeEnv { Fg = btn };
              var r = p.Take(7, out t) ? Typist.Insert("oi", "type", t, 0x78, e, 30) : null;
              Check("button click with no external window: insertion blocked as no-target, nothing typed",
                  r != null && r.Outcome == "blocked" && r.Reason == "no-target" && e.Sent.Count == 0, r == null ? "no pending" : Describe(r, e)); }

            // ---- start/stop controller ----------------------------------------------
            { var c = new RecordController("push-to-talk");
              bool a = c.Click(1000) == RecAction.Start; c.Started("button", 1000);
              bool b = c.Click(1100) == RecAction.None;          // second click of a double click
              bool d = c.Click(3000) == RecAction.Stop; c.BeginStop();
              bool f = c.Click(3010) == RecAction.None;          // click while stopping
              c.Stopped(3050);
              bool g = c.Click(3100) == RecAction.None;          // just after the stop
              bool h = c.Click(4000) == RecAction.Start;
              Check("click: start, double click ignored, stop, clicks during and right after stop ignored, start again",
                  a && b && d && f && g && h, "" + a + b + d + f + g + h); }

            { var c = new RecordController("push-to-talk");
              c.Started("button", 0);
              Check("push-to-talk: hotkey release does not stop a button recording",
                  c.HotkeyReleased() == RecAction.None && c.HotkeyDown() == RecAction.None, "");
              Check("push-to-talk: a click stops a button recording", c.Click(5000) == RecAction.Stop, ""); }

            { var c = new RecordController("push-to-talk");
              bool a = c.HotkeyDown() == RecAction.Start; c.Started("hotkey", 0);
              bool b = c.HotkeyReleased() == RecAction.Stop;
              bool d = c.Click(5000) == RecAction.Stop;          // a click also stops a hotkey recording
              Check("push-to-talk: hotkey down starts, release stops; click stops too", a && b && d, "" + a + b + d); }

            { var c = new RecordController("toggle");
              bool a = c.HotkeyDown() == RecAction.Start; c.Started("hotkey", 0);
              bool b = c.HotkeyReleased() == RecAction.None;
              bool d = c.HotkeyDown() == RecAction.Stop;
              c.BeginStop(); bool f = c.HotkeyDown() == RecAction.None; c.Stopped(10);
              c.Started("button", 2000); bool g = c.HotkeyDown() == RecAction.Stop;
              Check("toggle: hotkey starts and stops, release ignored, ignored while stopping, stops a button recording",
                  a && b && d && f && g, "" + a + b + d + f + g); }

            { var c = new RecordController("toggle");
              c.Started("hotkey", 0); c.BeginStop(); c.Stopped(100);
              Check("hotkey is not delayed by the click guard", c.HotkeyDown() == RecAction.Start, ""); }

            { var c = new RecordController("push-to-talk");
              c.StartFailed();
              Check("failed start returns to idle", c.State == "idle" && c.Click(10000) == RecAction.Start, ""); }

            // ---- button position persistence -----------------------------------------
            { var screen = new System.Drawing.Rectangle(0, 0, 1920, 1040);
              var second = new System.Drawing.Rectangle(1920, 0, 1280, 1000);
              var areas = new[] { screen, second };
              var pos = MicButton.ParsePosition(MicButton.FormatPosition(new System.Drawing.Point(2000, 500)));
              Check("button position round-trips through button.json", pos.HasValue && pos.Value.X == 2000 && pos.Value.Y == 500, "");
              Check("saved position on a screen is kept", MicButton.ResolvePosition(pos, areas, screen) == new System.Drawing.Point(2000, 500), "");
              var off = MicButton.ResolvePosition(new System.Drawing.Point(5000, 5000), areas, screen);
              Check("off-screen position (monitor unplugged) falls back to bottom right",
                  screen.Contains(new System.Drawing.Rectangle(off, new System.Drawing.Size(MicButton.Diameter, MicButton.Diameter))), off.ToString());
              Check("invalid button.json is ignored",
                  MicButton.ParsePosition("{oops") == null && MicButton.ParsePosition("{\"x\":1}") == null && MicButton.ParsePosition("") == null, ""); }


            // ---- elevated target (UIPI would drop the keys silently) ---------------------
            { var e = new FakeEnv { Elevated = true }; var r = Run(e, "segredo");
              Blocked("admin target window: blocked as elevated, nothing typed", e, r, "elevated", null); }

            { var e = new FakeEnv { Elevated = true }; var r = Run(e, "colar", "paste");
              Check("admin target window in paste mode: clipboard never touched",
                  r.Outcome == "blocked" && r.Reason == "elevated" && e.ClipSetTextCalls == 0 && e.ClipGetCalls == 0 && e.SendCalls == 0, Describe(r, e)); }

            // ---- button.json: hidden flag ---------------------------------------------------
            { var p = new System.Drawing.Point(10, 20);
              Check("hidden flag round-trips through button.json",
                  MicButton.ParseHidden(MicButton.FormatPosition(p, true)) && !MicButton.ParseHidden(MicButton.FormatPosition(p))
                  && MicButton.ParsePosition(MicButton.FormatPosition(p, true)).Value == p, "");
              Check("hidden flag: invalid or missing means visible",
                  !MicButton.ParseHidden("{oops") && !MicButton.ParseHidden("") && !MicButton.ParseHidden(null) && !MicButton.ParseHidden("{\"hidden\":\"yes\"}"), ""); }

            // ---- pill layout -----------------------------------------------------------------
            { var anchor = new System.Drawing.Point(1800, 900);
              foreach (float s in new[] { 1f, 1.5f })
              {
                  foreach (bool left in new[] { true, false })
                  {
                      var w0 = PillLayout.WindowLocation(anchor, false, left, s);
                      var w1 = PillLayout.WindowLocation(anchor, true, left, s);
                      var m0 = PillLayout.MicRect(false, left, s); var m1 = PillLayout.MicRect(true, left, s);
                      Check("layout x" + s + (left ? " chip left" : " chip right") + ": mic stays under the mouse when the chip appears",
                          w0.X + m0.X == anchor.X && w1.X + m1.X == anchor.X && w0.Y + m0.Y == anchor.Y && w1.Y + m1.Y == anchor.Y,
                          w0 + " " + w1);
                  }
              }
              var area = new System.Drawing.Rectangle(0, 0, 1920, 1040);
              Check("chip goes left on the right half of the screen, right on the left half",
                  PillLayout.ChipOnLeft(new System.Drawing.Point(1800, 500), area, 1f) && !PillLayout.ChipOnLeft(new System.Drawing.Point(40, 500), area, 1f), ""); }

            { float s = 1f; var mic = PillLayout.MicRect(true, true, s); var chip = PillLayout.ChipRect(true, s);
              var micCenter = new System.Drawing.Point(mic.X + mic.Width / 2, mic.Y + mic.Height / 2);
              var chipCenter = new System.Drawing.Point(chip.X + chip.Width / 2, chip.Y + chip.Height / 2);
              Check("hit test: mic center is the mic, chip center is copy, the corner is nothing",
                  PillLayout.HitTest(micCenter, true, true, s) == "mic" && PillLayout.HitTest(chipCenter, true, true, s) == "copy"
                  && PillLayout.HitTest(new System.Drawing.Point(0, 0), true, true, s) == null, "");
              Check("hit test: no chip, no copy", PillLayout.HitTest(chipCenter, false, true, s) != "copy", "");
              Check("hit test: the halo/shadow margin around the mic is not a click",
                  PillLayout.HitTest(new System.Drawing.Point(PillLayout.MicRect(false, false, s).X - 3, micCenter.Y), false, false, s) == null, ""); }

            // ---- look plan -----------------------------------------------------------------------
            { Check("states map to five distinct looks",
                  LookPlan.For("idle") == Look.Idle && LookPlan.For("recording") == Look.Recording && LookPlan.For("processing") == Look.Processing
                  && LookPlan.For("done") == Look.Done && LookPlan.For("blocked") == Look.Blocked && LookPlan.For("error") == Look.Error
                  && LookPlan.For("whatever") == Look.Idle, "");
              Check("done/blocked/error return to ready by themselves; recording and processing never time out",
                  LookPlan.RevertMs("done") > 0 && LookPlan.RevertMs("blocked") > LookPlan.RevertMs("done") && LookPlan.RevertMs("error") > 0
                  && LookPlan.RevertMs("recording") == 0 && LookPlan.RevertMs("processing") == 0 && LookPlan.RevertMs("idle") == 0, "");
              Check("copy chip: hidden while recording/transcribing and when there is no text",
                  LookPlan.ChipVisible("idle", true) && LookPlan.ChipVisible("done", true) && LookPlan.ChipVisible("blocked", true)
                  && !LookPlan.ChipVisible("recording", true) && !LookPlan.ChipVisible("processing", true) && !LookPlan.ChipVisible("idle", false), "");
              Check("mic level: silence is near zero, speech is clearly visible, clipped to 1",
                  ButtonArt.LevelFromPeak(0) == 0 && ButtonArt.LevelFromPeak(150) < 0.12 && ButtonArt.LevelFromPeak(6000) > 0.5
                  && ButtonArt.LevelFromPeak(32767) == 1 && ButtonArt.LevelFromPeak(-5) == 0, ""); }

            // ---- rendering (offscreen bitmaps only, no window is shown) ---------------------------
            { var centers = new Dictionary<string, System.Drawing.Color>();
              bool ok = true; string detail = "";
              foreach (Look l in new[] { Look.Idle, Look.Recording, Look.Processing, Look.Done, Look.Blocked, Look.Error })
              {
                  var f = new ButtonFrame { Look = l, Phase = 0.5, Level = 0.6, Scale = 1f };
                  using (var bmp = ButtonArt.Render(f))
                  {
                      var size = PillLayout.Canvas(false, 1f);
                      var corner = bmp.GetPixel(0, 0);
                      // A point inside the disc but away from the glyph (left edge, mid height).
                      var mic = PillLayout.MicRect(false, false, 1f);
                      var body = bmp.GetPixel(mic.X + 6, mic.Y + mic.Height / 2);
                      if (bmp.Width != size.Width || bmp.Height != size.Height) { ok = false; detail += l + " size; "; }
                      if (corner.A != 0) { ok = false; detail += l + " corner alpha " + corner.A + "; "; }
                      if (body.A != 255) { ok = false; detail += l + " body alpha " + body.A + "; "; }
                      centers[l.ToString()] = body;
                  }
              }
              Check("every look renders with transparent corners and an opaque disc", ok, detail);
              var rec = centers["Recording"]; var done = centers["Done"]; var kept = centers["Blocked"]; var idle = centers["Idle"];
              Check("looks are told apart by color: recording red, done green, kept amber, ready graphite",
                  rec.R > rec.G + 60 && done.G > done.R + 40 && kept.R > kept.B + 80 && kept.G > kept.B + 40
                  && Math.Abs(idle.R - idle.G) < 12 && idle.R < 80, "rec=" + rec + " done=" + done + " kept=" + kept + " idle=" + idle); }

            { var a = new ButtonFrame { Look = Look.Recording, Phase = 0.3, Level = 0.05, Scale = 1f };
              var b = new ButtonFrame { Look = Look.Recording, Phase = 0.3, Level = 0.9, Scale = 1f };
              int ha, hb;
              using (var ba = ButtonArt.Render(a)) ha = HaloPixels(ba);
              using (var bb = ButtonArt.Render(b)) hb = HaloPixels(bb);
              Check("recording halo grows with the voice level", hb > ha, "quiet=" + ha + " loud=" + hb); }

            { var f = new ButtonFrame { Look = Look.Idle, Chip = true, ChipLeft = true, Scale = 1.5f };
              using (var bmp = ButtonArt.Render(f))
              {
                  var size = PillLayout.Canvas(true, 1.5f);
                  var chip = PillLayout.ChipRect(true, 1.5f);
                  var px = bmp.GetPixel(chip.X + 3, chip.Y + chip.Height / 2);
                  Check("150% scale with copy chip: bitmap is scaled and the chip is drawn",
                      bmp.Width == size.Width && bmp.Height == size.Height && size.Width > PillLayout.Canvas(false, 1.5f).Width && px.A == 255,
                      bmp.Width + "x" + bmp.Height + " chipA=" + px.A);
              } }

            { bool ok = true;
              foreach (var text in new[] { "Gravando 3s  ·  clique de novo para parar", "Inserção cancelada: a janela mudou · texto guardado" })
                  using (var t = ButtonArt.RenderToast(text, System.Drawing.Color.Red, 1f))
                      ok &= t.GetPixel(0, 0).A == 0 && t.GetPixel(t.Width / 2, t.Height / 2).A > 200 && t.Width < 520 && t.Height < 60;
              Check("toast: compact one-line pill with transparent corners", ok, ""); }

            // ASCII-only output (\uXXXX) so the console code page can never corrupt the JSON.
            string json = new JavaScriptSerializer().Serialize(results);
            var sb = new StringBuilder(json.Length);
            foreach (char ch in json) { if (ch < 128) sb.Append(ch); else sb.Append("\\u").Append(((int)ch).ToString("x4")); }
            return sb.ToString();
        }
    }
}
