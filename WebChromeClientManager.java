package com.aistudio.deepmind.presentation.webview.client;

import android.view.View;
import android.webkit.WebChromeClient;
import android.webkit.WebView;
import android.widget.ProgressBar;

public class WebChromeClientManager extends WebChromeClient {
    private final ProgressBar progressBar;

    public WebChromeClientManager(ProgressBar progressBar) {
        this.progressBar = progressBar;
        if (this.progressBar != null) {
            this.progressBar.setMax(100);
            this.progressBar.setProgress(0);
            this.progressBar.setVisibility(View.GONE);
        }
    }

    @Override
    public void onProgressChanged(WebView view, int newProgress) {
        if (progressBar == null) return;
        if (newProgress == 100) {
            progressBar.setVisibility(View.GONE);
        } else {
            progressBar.setVisibility(View.VISIBLE);
            progressBar.setProgress(newProgress);
        }
    }
}
