/**
 * Copy text to the clipboard, working on non-secure origins too.
 *
 * `navigator.clipboard` is only defined in secure contexts (https / localhost).
 * The app is explicitly used over `http://<LAN-IP>:3000` from phones and VPN,
 * where `navigator.clipboard` is `undefined` and touching `.writeText` throws
 * synchronously — so fall back to a hidden <textarea> + execCommand there.
 *
 * Returns true on success so callers only show "copied" feedback when it worked.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the legacy path */
  }

  if (typeof document === "undefined") return false;
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "-1000px";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
