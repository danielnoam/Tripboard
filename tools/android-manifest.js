// Adds what Tripboard needs to the AndroidManifest.xml `npx cap add android`
// writes.
//
//   node tools/android-manifest.js
//
// - REQUEST_INSTALL_PACKAGES, for the in-app update: without it Android
//   refuses to install an APK an app hands it. The person still approves
//   each install on Android's own screen.
// - No cloud backup: allowBackup="false" on <application>. The WebView's
//   storage holds everything the app keeps, tokens included, and
//   Capacitor's template has allowBackup="true", which would put it in the
//   phone's Google backup. The template's attribute is replaced, not
//   skipped, which is what the `replace` flag is for.
// - Share → Tripboard: an intent filter on MainActivity for text another
//   app shares (Google Maps sends a place's name, address and link), and a
//   MainActivity that turns that SEND into a VIEW of tripboard-share:?text=…
//   so Capacitor's App plugin hands it to the page (appUrlOpen; views.js,
//   takeShares). No plugin and no permission: only text, never files.
//
// An app adds its own entries to the lists below. Idempotent, and fails
// loudly if a tag it needs isn't there.
const fs = require("fs");
const path = require("path");

const ENTRIES = [
  { inside: "manifest", xml: '<uses-permission android:name="android.permission.REQUEST_INSTALL_PACKAGES" />' },
];
const SHARE_FILTER = `<intent-filter>
                <action android:name="android.intent.action.SEND" />
                <category android:name="android.intent.category.DEFAULT" />
                <data android:mimeType="text/plain" />
            </intent-filter>`;
const ATTRS = [
  { on: "application", attr: 'android:allowBackup="false"', replace: true },
];

function patch(xml) {
  let out = xml;
  for (const { inside, xml: entry } of ENTRIES) {
    const name = entry.match(/android:name="([^"]+)"/)[1];
    if (out.includes('android:name="' + name + '"')) continue;
    const at = out.search(inside === "application" ? /<application\b[^>]*>/ : /<manifest\b[^>]*>/);
    if (at < 0) throw new Error("no <" + inside + "> tag in AndroidManifest.xml");
    const end = out.indexOf(">", at) + 1;
    out = out.slice(0, end) + "\n    " + (inside === "application" ? "    " : "") + entry + out.slice(end);
  }
  for (const { on, attr, replace } of ATTRS) {
    const name = attr.split("=")[0];
    const m = new RegExp("<" + on + "\\b[^>]*>").exec(out);
    if (!m) throw new Error("no <" + on + "> tag in AndroidManifest.xml");
    let tag;
    if (m[0].includes(name + "=")) {
      if (!replace || m[0].includes(attr)) continue;
      tag = m[0].replace(new RegExp(name + '="[^"]*"'), attr);
    } else {
      tag = m[0].replace(new RegExp("^<" + on), "<" + on + " " + attr);
    }
    out = out.slice(0, m.index) + tag + out.slice(m.index + m[0].length);
  }
  if (!out.includes("android.intent.action.SEND")) {
    const m = /<activity\b[^>]*android:name="\.MainActivity"[^>]*>/.exec(out);
    if (!m) throw new Error("no MainActivity <activity> in AndroidManifest.xml");
    const end = m.index + m[0].length;
    out = out.slice(0, end) + "\n\n            " + SHARE_FILTER + out.slice(end);
  }
  return out;
}

// Android's Share hands the app a SEND intent; Capacitor's App plugin only
// passes on a VIEW with an address. So a SEND becomes one, before the bridge
// reads it (onCreate) or the plugins see it (onNewIntent). Opened again from
// Recents, Android repeats the old intent: that one is dropped, not re-added.
function mainActivity(pkg) {
  return `package ${pkg};

import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        asView(getIntent(), savedInstanceState != null);
        super.onCreate(savedInstanceState);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        asView(intent, false);
        super.onNewIntent(intent);
    }

    private static void asView(Intent intent, boolean again) {
        if (intent == null || !Intent.ACTION_SEND.equals(intent.getAction())) return;
        String text = intent.getStringExtra(Intent.EXTRA_TEXT);
        String title = intent.getStringExtra(Intent.EXTRA_SUBJECT);
        if (again || (intent.getFlags() & Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY) != 0 || (text == null && title == null)) {
            intent.setAction(Intent.ACTION_MAIN);
            return;
        }
        intent.setAction(Intent.ACTION_VIEW);
        intent.setData(Uri.parse("tripboard-share://in?text=" + Uri.encode(text == null ? "" : text)
            + "&title=" + Uri.encode(title == null ? "" : title)));
    }
}
`;
}

if (require.main === module) {
  const main = path.resolve(__dirname, "..", "android", "app", "src", "main");
  const file = path.join(main, "AndroidManifest.xml");
  const before = fs.readFileSync(file, "utf8");
  fs.writeFileSync(file, patch(before));
  console.log("android: manifest " + (before === patch(before) ? "already had" : "gained") + " Tripboard's entries");
  const pkg = require("../capacitor.config.json").appId;
  const activity = path.join(main, "java", ...pkg.split("."), "MainActivity.java");
  if (!fs.existsSync(activity)) throw new Error("no " + activity + ": did `npx cap add android` run?");
  fs.writeFileSync(activity, mainActivity(pkg));
  console.log("android: MainActivity takes Share");
}
module.exports = { patch, mainActivity, ENTRIES, ATTRS };
