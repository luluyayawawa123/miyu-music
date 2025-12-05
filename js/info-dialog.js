// 音频信息弹窗控制器
(function () {
    // 创建弹窗 HTML
    const dialogHTML = `
        <div class="info-dialog-overlay" id="info-dialog-overlay">
            <div class="info-dialog">
                <div class="info-dialog-header">
                    <h3>音频信息</h3>
                    <button class="info-dialog-close" id="info-dialog-close">
                        <i class="bi bi-x-lg"></i>
                    </button>
                </div>
                <div class="info-dialog-content" id="info-dialog-content">
                    <div class="info-loading">
                        <i class="bi bi-disc"></i>
                        <span>加载中...</span>
                    </div>
                </div>
            </div>
        </div>
    `;

    // 插入弹窗到 body
    document.body.insertAdjacentHTML('beforeend', dialogHTML);

    const overlay = document.getElementById('info-dialog-overlay');
    const closeBtn = document.getElementById('info-dialog-close');
    const content = document.getElementById('info-dialog-content');

    // 关闭弹窗
    function closeDialog() {
        overlay.classList.remove('active');
    }

    closeBtn.addEventListener('click', closeDialog);
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeDialog();
    });

    // 按 ESC 关闭
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && overlay.classList.contains('active')) {
            closeDialog();
        }
    });

    // 显示音频信息
    window.showAudioInfo = async function (trackName) {
        overlay.classList.add('active');
        content.innerHTML = `
            <div class="info-loading">
                <i class="bi bi-disc"></i>
                <span>加载中...</span>
            </div>
        `;

        try {
            const response = await fetch(`/api/info/${encodeURIComponent(trackName)}`);
            if (!response.ok) throw new Error('获取信息失败');

            const info = await response.json();

            content.innerHTML = `
                <div class="info-group">
                    <div class="info-group-title">基本信息</div>
                    <div class="info-row">
                        <span class="info-label">标题</span>
                        <span class="info-value">${escapeHtml(info.title)}</span>
                    </div>
                    <div class="info-row">
                        <span class="info-label">艺术家</span>
                        <span class="info-value">${escapeHtml(info.artist)}</span>
                    </div>
                    <div class="info-row">
                        <span class="info-label">专辑</span>
                        <span class="info-value">${escapeHtml(info.album)}</span>
                    </div>
                    ${info.year !== '未知' ? `
                    <div class="info-row">
                        <span class="info-label">年份</span>
                        <span class="info-value">${info.year}</span>
                    </div>
                    ` : ''}
                    ${info.genre !== '未知' ? `
                    <div class="info-row">
                        <span class="info-label">流派</span>
                        <span class="info-value">${escapeHtml(info.genre)}</span>
                    </div>
                    ` : ''}
                </div>
                
                <div class="info-group">
                    <div class="info-group-title">音频参数</div>
                    <div class="info-row">
                        <span class="info-label">格式</span>
                        <span class="info-value highlight">${escapeHtml(info.format)}</span>
                    </div>
                    <div class="info-row">
                        <span class="info-label">编码器</span>
                        <span class="info-value highlight">${escapeHtml(info.codec)}${info.codecProfile ? ' (' + escapeHtml(info.codecProfile) + ')' : ''}</span>
                    </div>
                    <div class="info-row">
                        <span class="info-label">比特率</span>
                        <span class="info-value highlight">${info.bitrateFormatted}</span>
                    </div>
                    <div class="info-row">
                        <span class="info-label">采样率</span>
                        <span class="info-value">${info.sampleRateFormatted}</span>
                    </div>
                    <div class="info-row">
                        <span class="info-label">声道</span>
                        <span class="info-value">${info.channelsFormatted}</span>
                    </div>
                    ${info.bitsPerSample > 0 ? `
                    <div class="info-row">
                        <span class="info-label">位深</span>
                        <span class="info-value">${info.bitsPerSample} bit</span>
                    </div>
                    ` : ''}
                    <div class="info-row">
                        <span class="info-label">时长</span>
                        <span class="info-value">${info.durationFormatted}</span>
                    </div>
                </div>
                
                <div class="info-group">
                    <div class="info-group-title">文件信息</div>
                    <div class="info-row">
                        <span class="info-label">文件名</span>
                        <span class="info-value">${escapeHtml(info.fileName)}</span>
                    </div>
                    <div class="info-row">
                        <span class="info-label">文件大小</span>
                        <span class="info-value">${info.fileSizeFormatted}</span>
                    </div>
                </div>
            `;
        } catch (error) {
            console.error('获取音频信息失败:', error);
            content.innerHTML = `
                <div class="info-loading">
                    <i class="bi bi-exclamation-circle"></i>
                    <span>加载失败</span>
                </div>
            `;
        }
    };

    // HTML 转义
    function escapeHtml(text) {
        if (!text) return '未知';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
})();
