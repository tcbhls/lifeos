package app.lifeos.health;

import android.content.res.Configuration;
import android.graphics.Color;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebView;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.Toast;

import androidx.activity.OnBackPressedCallback;

import com.getcapacitor.BridgeActivity;

/**
 * LifeOS 安卓主 Activity：
 * 1. 注册端侧原生 llama.cpp 本地大模型插件
 * 2. 使用无缝原生启动遮罩层覆盖 WebView 冷启动空窗期，待 React 首屏与主题渲染完成后 240ms 平滑淡出，彻底消除闪黑屏
 * 3. 拦截安卓系统返回手势，按层级优雅关闭 AI 管家/弹窗/设置页，根目录双击再退出
 */
public class MainActivity extends BridgeActivity {
    private ImageView splashOverlay;
    private boolean splashDismissed = false;
    private long lastBackPressMs = 0L;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // 注册 LifeOS 自研端侧 llama.cpp 本地大模型与启动衔接插件
        registerPlugin(LifeOsLocalLlmPlugin.class);
        super.onCreate(savedInstanceState);

        // 根据系统深浅色立即同步 WebView 底色，避免首帧闪黑或闪白
        boolean isNightMode =
                (getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK)
                        == Configuration.UI_MODE_NIGHT_YES;
        int surfaceColor = Color.parseColor(isNightMode ? "#0B0C0E" : "#F7F8F7");
        if (getBridge() != null && getBridge().getWebView() != null) {
            getBridge().getWebView().setBackgroundColor(surfaceColor);
        }

        // 添加与系统启动页像素一致的过渡层，直到前端首屏挂载完毕再淡出
        attachSeamlessSplashOverlay();
        // 兜底保护：最多 2.5 秒自动淡出，防止任何极端情况下卡住启动画面
        mainHandler.postDelayed(this::hideLaunchSplash, 2500L);

        // 原生返回手势接管：先交由 Web 层关闭抽屉/弹窗/设置页，首页根视图再双击退出
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                WebView webView = getBridge() != null ? getBridge().getWebView() : null;
                if (webView == null) {
                    finish();
                    return;
                }
                webView.evaluateJavascript(
                        "(function(){ return window.__lifeosHandleBack ? String(window.__lifeosHandleBack()) : 'false'; })()",
                        value -> {
                            boolean consumed = value != null && value.contains("true");
                            if (!consumed) {
                                long now = System.currentTimeMillis();
                                if (now - lastBackPressMs < 2000L) {
                                    finish();
                                } else {
                                    lastBackPressMs = now;
                                    Toast.makeText(
                                            MainActivity.this,
                                            "再返回一次退出 LifeOS",
                                            Toast.LENGTH_SHORT
                                    ).show();
                                }
                            }
                        }
                );
            }
        });
    }

    private void attachSeamlessSplashOverlay() {
        ViewGroup contentRoot = findViewById(android.R.id.content);
        if (contentRoot == null) return;

        ImageView overlay = new ImageView(this);
        overlay.setImageResource(R.drawable.splash);
        overlay.setScaleType(ImageView.ScaleType.CENTER_CROP);
        overlay.setBackgroundColor(Color.parseColor("#165E52"));
        overlay.setClickable(true);
        overlay.setFocusable(true);
        overlay.setLayoutParams(new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
        ));
        contentRoot.addView(overlay);
        this.splashOverlay = overlay;
    }

    /** 供前端首屏渲染完毕后调用：平滑淡出原生启动遮罩 */
    public void hideLaunchSplash() {
        mainHandler.post(() -> {
            if (splashDismissed) return;
            splashDismissed = true;
            final View overlay = splashOverlay;
            if (overlay == null) return;
            splashOverlay = null;
            overlay.animate()
                    .alpha(0f)
                    .setDuration(220L)
                    .withEndAction(() -> {
                        if (overlay.getParent() instanceof ViewGroup) {
                            ((ViewGroup) overlay.getParent()).removeView(overlay);
                        }
                    })
                    .start();
        });
    }

    @Override
    public void onDestroy() {
        mainHandler.removeCallbacksAndMessages(null);
        super.onDestroy();
    }
}
