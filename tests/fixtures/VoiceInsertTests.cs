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

            // ASCII-only output (\uXXXX) so the console code page can never corrupt the JSON.
            string json = new JavaScriptSerializer().Serialize(results);
            var sb = new StringBuilder(json.Length);
            foreach (char ch in json) { if (ch < 128) sb.Append(ch); else sb.Append("\\u").Append(((int)ch).ToString("x4")); }
            return sb.ToString();
        }
    }
}
