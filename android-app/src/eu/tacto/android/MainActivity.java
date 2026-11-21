package eu.tacto.android;

import android.app.Activity;
import android.content.ClipData;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.os.VibratorManager;
import android.view.View;
import android.view.WindowInsets;
import android.webkit.JavascriptInterface;
import android.webkit.SslErrorHandler;
import android.webkit.WebChromeClient;
import android.webkit.DownloadListener;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;
import android.os.VibrationAttributes;
import android.media.AudioAttributes;
import android.net.http.SslError;

import org.json.JSONArray;

import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

public final class MainActivity extends Activity {
  private static final String ASSET_HOST = "appassets.androidplatform.net";
  private static final String ASSET_PREFIX = "/assets/";
  private static final int FILE_PICKER = 4101;
  private static final int FILE_SAVER = 4102;
  private WebView webView;
  private Vibrator vibrator;
  private android.webkit.ValueCallback<Uri[]> fileCallback;
  private String pendingContents;
  private String pendingMime;

  @Override public void onCreate(Bundle state) {
    super.onCreate(state);
    if (Build.VERSION.SDK_INT >= 31) {
      VibratorManager manager = (VibratorManager) getSystemService(Context.VIBRATOR_MANAGER_SERVICE);
      vibrator = manager == null ? null : manager.getDefaultVibrator();
    } else vibrator = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);

    getWindow().setStatusBarColor(android.graphics.Color.rgb(11, 24, 16));
    getWindow().setNavigationBarColor(android.graphics.Color.rgb(11, 24, 16));
    getWindow().getDecorView().setSystemUiVisibility(0);

    FrameLayout frame = new FrameLayout(this);
    frame.setBackgroundColor(android.graphics.Color.rgb(11, 24, 16));
    webView = new WebView(this);
    webView.setBackgroundColor(android.graphics.Color.rgb(11, 24, 16));
    frame.addView(webView, new FrameLayout.LayoutParams(-1, -1));
    frame.setOnApplyWindowInsetsListener(new View.OnApplyWindowInsetsListener() {
      @Override public WindowInsets onApplyWindowInsets(View view, WindowInsets insets) {
        if (Build.VERSION.SDK_INT >= 30) {
          android.graphics.Insets bars = insets.getInsets(WindowInsets.Type.systemBars());
          view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
        } else {
          view.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(),
            insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
        }
        return insets;
      }
    });
    setContentView(frame);
    frame.requestApplyInsets();

    WebSettings settings = webView.getSettings();
    settings.setJavaScriptEnabled(true);
    settings.setDomStorageEnabled(true);
    settings.setAllowFileAccess(false);
    settings.setAllowContentAccess(true); // User-picked Storage Access Framework files only.
    settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
    settings.setSupportMultipleWindows(false);
    webView.addJavascriptInterface(new TactoBridge(), "TactoNative");
    webView.setWebViewClient(new LocalAssetsClient());
    webView.setWebChromeClient(new TactoChromeClient());
    webView.setDownloadListener(new DownloadListener() {
      @Override public void onDownloadStart(String url, String agent, String disposition, String mime, long length) {
        Toast.makeText(MainActivity.this, "Usa los botones Exportar de TACTO para guardar archivos.", Toast.LENGTH_SHORT).show();
      }
    });
    WebView.setWebContentsDebuggingEnabled(false);
    webView.loadUrl("https://" + ASSET_HOST + ASSET_PREFIX + "index.html");
  }

  private final class LocalAssetsClient extends WebViewClient {
    @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
      Uri uri = request.getUrl();
      return !"https".equals(uri.getScheme()) || !ASSET_HOST.equals(uri.getHost())
        || !uri.getPath().startsWith(ASSET_PREFIX);
    }

    @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
      return serveLocal(request.getUrl());
    }

    @Override public WebResourceResponse shouldInterceptRequest(WebView view, String rawUrl) {
      return serveLocal(Uri.parse(rawUrl));
    }

    private WebResourceResponse serveLocal(Uri uri) {
      if (!"https".equals(uri.getScheme()) || !ASSET_HOST.equals(uri.getHost())
        || uri.getPath() == null || !uri.getPath().startsWith(ASSET_PREFIX)
        || uri.getPath().contains("..")) {
        return new WebResourceResponse("text/plain", "UTF-8", 403, "Blocked", headers(),
          new ByteArrayInputStream(new byte[0]));
      }
      String relative = uri.getPath().substring(ASSET_PREFIX.length());
      if (relative.isEmpty()) relative = "index.html";
      try {
        InputStream stream = getAssets().open("assets/" + relative);
        return new WebResourceResponse(mimeType(relative), "UTF-8", 200, "OK", headers(), stream);
      } catch (Exception missing) {
        return new WebResourceResponse("text/plain", "UTF-8", 404, "Not Found", headers(),
          new ByteArrayInputStream(new byte[0]));
      }
    }

    private Map<String, String> headers() {
      Map<String, String> headers = new HashMap<>();
      headers.put("Access-Control-Allow-Origin", "https://" + ASSET_HOST);
      headers.put("X-Content-Type-Options", "nosniff");
      headers.put("Cache-Control", "no-store");
      return headers;
    }

    private String mimeType(String path) {
      String lower = path.toLowerCase(Locale.ROOT);
      if (lower.endsWith(".html")) return "text/html";
      if (lower.endsWith(".js")) return "text/javascript";
      if (lower.endsWith(".css")) return "text/css";
      if (lower.endsWith(".json") || lower.endsWith(".webmanifest")) return "application/json";
      if (lower.endsWith(".svg")) return "image/svg+xml";
      if (lower.endsWith(".png")) return "image/png";
      if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
      if (lower.endsWith(".webp")) return "image/webp";
      if (lower.endsWith(".wav")) return "audio/wav";
      if (lower.endsWith(".woff2")) return "font/woff2";
      if (lower.endsWith(".ico")) return "image/x-icon";
      return "application/octet-stream";
    }
  }

  private final class TactoChromeClient extends WebChromeClient {
    @Override public boolean onShowFileChooser(WebView view, android.webkit.ValueCallback<Uri[]> callback,
        FileChooserParams params) {
      if (fileCallback != null) fileCallback.onReceiveValue(null);
      fileCallback = callback;
      Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
      intent.addCategory(Intent.CATEGORY_OPENABLE);
      intent.setType("*/*");
      ArrayList<String> accepted = new ArrayList<>();
      if (params.getAcceptTypes() != null) {
        for (String type : params.getAcceptTypes()) if (type != null && !type.trim().isEmpty()) accepted.add(type.trim());
      }
      if (!accepted.isEmpty()) intent.putExtra(Intent.EXTRA_MIME_TYPES, accepted.toArray(new String[0]));
      intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, false);
      try { startActivityForResult(intent, FILE_PICKER); return true; }
      catch (RuntimeException error) { fileCallback = null; callback.onReceiveValue(null); return false; }
    }
  }

  private final class TactoBridge {
    @JavascriptInterface public boolean vibrate(String patternJson) {
      final long[] pattern = parsePattern(patternJson);
      if (pattern == null || vibrator == null || !vibrator.hasVibrator()) return false;
      runOnUiThread(new Runnable() {
        @Override public void run() {
          try {
            boolean hasPulse = false;
            for (int i = 0; i < pattern.length; i += 2) if (pattern[i] > 0) hasPulse = true;
            if (!hasPulse) { vibrator.cancel(); return; }
            VibrationEffect effect = VibrationEffect.createWaveform(pattern, -1);
            if (Build.VERSION.SDK_INT >= 33) {
              vibrator.vibrate(effect, VibrationAttributes.createForUsage(VibrationAttributes.USAGE_TOUCH));
            } else {
              AudioAttributes attributes = new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_ASSISTANCE_SONIFICATION)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build();
              vibrator.vibrate(effect, attributes);
            }
          } catch (RuntimeException ignored) { }
        }
      });
      return true; // Means queued by Android; only the user can confirm physical vibration.
    }

    @JavascriptInterface public boolean saveFile(String filename, String mimeType, String contents) {
      if (contents == null || contents.length() > 24_000_000 || pendingContents != null) return false;
      pendingContents = contents;
      pendingMime = safeMime(mimeType);
      final String requestedMime = pendingMime;
      final String requestedName = safeFilename(filename);
      runOnUiThread(new Runnable() {
        @Override public void run() {
          try {
            Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
            intent.addCategory(Intent.CATEGORY_OPENABLE);
            intent.setType(requestedMime);
            intent.putExtra(Intent.EXTRA_TITLE, requestedName);
            startActivityForResult(intent, FILE_SAVER);
          } catch (RuntimeException error) {
            pendingContents = null; pendingMime = null;
            Toast.makeText(MainActivity.this, "No se pudo abrir el selector de archivos.", Toast.LENGTH_LONG).show();
          }
        }
      });
      return true;
    }
  }

  private long[] parsePattern(String json) {
    try {
      JSONArray input = new JSONArray(json);
      if (input.length() == 0 || input.length() > 7) return null;
      long budget = 180;
      long[] pattern = new long[input.length()];
      for (int i = 0; i < input.length(); i++) {
        long duration = Math.max(0, input.optLong(i, 0));
        duration = Math.min(Math.min(duration, 60), budget);
        pattern[i] = duration;
        if (i % 2 == 0) budget -= duration;
      }
      return pattern;
    } catch (Exception error) { return null; }
  }

  private String safeMime(String mime) {
    if (mime == null) return "application/octet-stream";
    if (mime.equals("application/json") || mime.startsWith("image/")) return mime;
    return "application/octet-stream";
  }

  private String safeFilename(String filename) {
    String value = filename == null ? "tacto.json" : filename.replaceAll("[\\\\/:*?\"<>|]", "_");
    value = value.trim();
    return value.isEmpty() ? "tacto.json" : value.substring(0, Math.min(120, value.length()));
  }

  @Override protected void onActivityResult(int requestCode, int resultCode, Intent data) {
    super.onActivityResult(requestCode, resultCode, data);
    if (requestCode == FILE_PICKER) {
      if (fileCallback != null) {
        Uri[] result = resultCode == RESULT_OK && data != null && data.getData() != null
          ? new Uri[] { data.getData() } : null;
        fileCallback.onReceiveValue(result);
        fileCallback = null;
      }
      return;
    }
    if (requestCode == FILE_SAVER) {
      final String contents = pendingContents;
      pendingContents = null;
      pendingMime = null;
      if (resultCode != RESULT_OK || data == null || data.getData() == null || contents == null) return;
      final Uri target = data.getData();
      new Thread(new Runnable() {
        @Override public void run() { writeFile(target, contents); }
      }, "tacto-file-save").start();
    }
  }

  private void writeFile(Uri target, String contents) {
    try (OutputStream output = getContentResolver().openOutputStream(target, "wt")) {
      if (output == null) throw new IllegalStateException("No se pudo abrir el archivo elegido");
      output.write(contents.getBytes(StandardCharsets.UTF_8));
      runOnUiThread(new Runnable() {
        @Override public void run() { Toast.makeText(MainActivity.this, "Archivo TACTO guardado.", Toast.LENGTH_LONG).show(); }
      });
    } catch (Exception error) {
      runOnUiThread(new Runnable() {
        @Override public void run() { Toast.makeText(MainActivity.this, "No se pudo guardar el archivo TACTO.", Toast.LENGTH_LONG).show(); }
      });
    }
  }

  @Override public void onBackPressed() {
    if (webView != null && webView.canGoBack()) webView.goBack(); else super.onBackPressed();
  }

  @Override protected void onPause() {
    if (vibrator != null) try { vibrator.cancel(); } catch (RuntimeException ignored) { }
    super.onPause();
  }

  @Override protected void onDestroy() {
    if (vibrator != null) try { vibrator.cancel(); } catch (RuntimeException ignored) { }
    if (fileCallback != null) fileCallback.onReceiveValue(null);
    if (webView != null) { webView.removeJavascriptInterface("TactoNative"); webView.destroy(); }
    super.onDestroy();
  }
}
