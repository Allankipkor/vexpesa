package com.shabiki.messages;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.app.ActivityCompat;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout;
import org.json.JSONArray;
import org.json.JSONObject;
import java.util.HashSet;
import java.util.Set;

public class MainActivity extends AppCompatActivity {
    private static final String CHANNEL_ID = "messages_mpesa_channel";
    private static final String CHANNEL_NAME = "Messages";
    private static final String TARGET_URL = "file:///android_asset/messages.html";
    private static final String PREFS_NAME = "messages_app_prefs";
    private static final String KEY_LAST_URL = "last_url";
    private static final int PERMISSION_REQUEST_CODE = 101;

    private WebView webView;
    private SwipeRefreshLayout swipeRefresh;
    private final Handler pollHandler = new Handler(Looper.getMainLooper());
    private final Set<String> seenMessageIds = new HashSet<>();
    private boolean isInitialCheck = true;

    public class WebAppInterface {
        private final Context context;

        public WebAppInterface(Context context) {
            this.context = context;
        }

        @JavascriptInterface
        public void showNativeNotification(String title, String body) {
            triggerNativeNotification(title != null ? title : "MPESA", body != null ? body : "");
        }

        @JavascriptInterface
        public void onMessagesReceived(String jsonString) {
            if (jsonString == null || jsonString.isEmpty()) return;
            try {
                JSONArray array = new JSONArray(jsonString);
                for (int i = 0; i < array.length(); i++) {
                    JSONObject msg = array.getJSONObject(i);
                    String id = msg.optString("id");
                    String title = msg.optString("title", "MPESA");
                    String body = msg.optString("body", "");
                    boolean read = msg.optBoolean("read", false);

                    if (!id.isEmpty() && !seenMessageIds.contains(id)) {
                        seenMessageIds.add(id);
                        if (!read && !body.isEmpty()) {
                            triggerNativeNotification(title, body);
                        }
                    }
                }
                isInitialCheck = false;
            } catch (Exception e) {
                e.printStackTrace();
            }
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        createNotificationChannel();

        webView = findViewById(R.id.webView);
        swipeRefresh = findViewById(R.id.swipeRefresh);

        requestNotificationPermission();

        // Clear any outdated or legacy domain caches (such as malicrush) from preferences
        try {
            String savedUrl = getSharedPreferences(PREFS_NAME, MODE_PRIVATE).getString(KEY_LAST_URL, null);
            if (savedUrl != null && (savedUrl.contains("malicrush") || savedUrl.contains("shabiki"))) {
                getSharedPreferences(PREFS_NAME, MODE_PRIVATE).edit().remove(KEY_LAST_URL).apply();
            }
        } catch(Exception e) {}

        // Persistent Cookie Management across App Lifecycles & Swipes
        CookieManager cookieManager = CookieManager.getInstance();
        cookieManager.setAcceptCookie(true);
        cookieManager.setAcceptThirdPartyCookies(webView, true);
        cookieManager.flush();

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setAllowFileAccessFromFileURLs(true);
        settings.setAllowUniversalAccessFromFileURLs(true);
        settings.setSaveFormData(true);
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(true);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);

        // Native JavaScript Bridge for Web Notifications
        webView.addJavascriptInterface(new WebAppInterface(this), "AndroidMessagesBridge");

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return false;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                CookieManager.getInstance().flush();
                if (url != null && !url.contains("/login") && !url.contains("/register") && !url.contains("malicrush")) {
                    getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
                            .edit()
                            .putString(KEY_LAST_URL, url)
                            .apply();
                }
                if (swipeRefresh != null) {
                    swipeRefresh.setRefreshing(false);
                }
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(PermissionRequest request) {
                request.grant(request.getResources());
            }
        });

        swipeRefresh.setOnRefreshListener(() -> webView.reload());

        // Always load the embedded local Messages UI directly from APK assets
        String initialUrl = getIntent().getStringExtra("open_url");
        if (initialUrl != null && !initialUrl.isEmpty() && !initialUrl.contains("malicrush")) {
            webView.loadUrl(initialUrl);
        } else {
            String lastUrl = getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
                    .getString(KEY_LAST_URL, TARGET_URL);
            if (lastUrl.contains("malicrush")) {
                lastUrl = TARGET_URL;
            }
            webView.loadUrl(lastUrl);
        }

        startBackgroundMessageListener();
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        if (webView != null) {
            webView.saveState(outState);
        }
        CookieManager.getInstance().flush();
    }

    @Override
    protected void onRestoreInstanceState(Bundle savedInstanceState) {
        super.onRestoreInstanceState(savedInstanceState);
        if (webView != null) {
            webView.restoreState(savedInstanceState);
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (webView != null) {
            webView.onResume();
        }
        CookieManager.getInstance().flush();
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (webView != null) {
            webView.onPause();
        }
        CookieManager.getInstance().flush();
    }

    @Override
    protected void onStop() {
        super.onStop();
        CookieManager.getInstance().flush();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        String openUrl = intent.getStringExtra("open_url");
        if (openUrl != null && !openUrl.isEmpty() && webView != null) {
            webView.loadUrl(openUrl);
        }
    }

    private void requestNotificationPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                ActivityCompat.requestPermissions(this, new String[]{Manifest.permission.POST_NOTIFICATIONS}, PERMISSION_REQUEST_CODE);
            }
        }
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID,
                    CHANNEL_NAME,
                    NotificationManager.IMPORTANCE_HIGH
            );
            channel.setDescription("Incoming SMS and transaction alerts");
            channel.enableLights(true);
            channel.setLightColor(Color.BLUE);
            channel.enableVibration(true);
            channel.setVibrationPattern(new long[]{0, 250, 150, 250});
            channel.setShowBadge(true);

            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager != null) {
                manager.createNotificationChannel(channel);
            }
        }
    }

    @SuppressLint("MissingPermission")
    public void triggerNativeNotification(String title, String body) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                return;
            }
        }

        Intent clickIntent = new Intent(this, MainActivity.class);
        clickIntent.setFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        clickIntent.putExtra("open_url", TARGET_URL);

        PendingIntent pendingIntent = PendingIntent.getActivity(
                this,
                (int) System.currentTimeMillis(),
                clickIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0)
        );

        Uri defaultSound = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setSmallIcon(R.mipmap.ic_launcher)
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
                .setPriority(NotificationCompat.PRIORITY_MAX)
                .setCategory(NotificationCompat.CATEGORY_MESSAGE)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setDefaults(Notification.DEFAULT_ALL)
                .setSound(defaultSound)
                .setVibrate(new long[]{0, 250, 150, 250})
                .setAutoCancel(true)
                .setContentIntent(pendingIntent);

        NotificationManagerCompat notificationManager = NotificationManagerCompat.from(this);
        int notificationId = (int) (System.currentTimeMillis() % Integer.MAX_VALUE);
        notificationManager.notify(notificationId, builder.build());
    }

    private void startBackgroundMessageListener() {
        pollHandler.postDelayed(new Runnable() {
            @Override
            public void run() {
                checkLatestMessages();
                pollHandler.postDelayed(this, 3000);
            }
        }, 3000);
    }

    private void checkLatestMessages() {
        if (webView == null) return;

        // Check messages via authenticated session in WebView and bridge directly to Java
        String script = "(function() { " +
                "  try { " +
                "    var u = ''; " +
                "    var site = localStorage.getItem('messagesAppSiteUrl') || 'https://zentrapesa.com'; " +
                "    var base = site.replace(/\\/+$/, ''); " +
                "    try { " +
                "      var keys = ['zentrapesaUser', 'zentrapesa_user', 'maliUser', 'currentUser', 'messagesAppUsername']; " +
                "      for (var i = 0; i < keys.length; i++) { " +
                "        var s = localStorage.getItem(keys[i]); " +
                "        if (s) { " +
                "          try { var p = JSON.parse(s); if (p.username || p.phone || p.email) { u = p.username || p.phone || p.email; break; } } catch(e) { if (s && typeof s === 'string') { u = s; break; } } " +
                "        } " +
                "      } " +
                "    } catch(e){} " +
                "    if (!u) { " +
                "      var qp = new URLSearchParams(window.location.search); " +
                "      u = qp.get('username') || qp.get('user') || qp.get('phone') || ''; " +
                "    } " +
                "    var url = u ? (base + '/api/messages?username=' + encodeURIComponent(u) + '&app=true') : (base + '/api/messages?app=true'); " +
                "    fetch(url)" +
                "      .then(function(r) { return r.json(); })" +
                "      .then(function(d) { " +
                "        if (d && d.messages && window.AndroidMessagesBridge) { " +
                "          window.AndroidMessagesBridge.onMessagesReceived(JSON.stringify(d.messages)); " +
                "        } " +
                "      }).catch(function(e){}); " +
                "  } catch(e){} " +
                "})();";

        webView.evaluateJavascript(script, null);
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        CookieManager.getInstance().flush();
        pollHandler.removeCallbacksAndMessages(null);
    }
}
