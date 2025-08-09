package com.aistudio.deepmind.presentation.webview.client;

import android.view.View;
import android.webkit.WebChromeClient;
import android.webkit.WebView;
import android.widget.ProgressBar;

public class WebChromeClientManager extends WebChromeClient {
    private final ProgressBar progressBar;

    public WebChromeClientManager(ProgressBar progressBar) {
        this.progressBar = progressBar;
    }

    @Override
    public void onProgressChanged(WebView view, int newProgress) {
        if (newProgress == 100) {
            progressBar.setVisibility(View.GONE);
        } else {
            progressBar.setVisibility(View.VISIBLE);
            progressBar.setProgress(newProgress);
        }
    }
}
