// 统计页面客户端脚本
let statsPassword = '';
let autoRefreshInterval = null;

// 登录功能
document.getElementById('login-btn').addEventListener('click', async () => {
    const password = document.getElementById('stats-password').value;
    const errorDiv = document.getElementById('error-message');

    if (!password) {
        errorDiv.textContent = '请输入密码';
        return;
    }

    try {
        const response = await fetch('/api/stats/verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password })
        });

        const data = await response.json();

        if (data.verified) {
            statsPassword = password;
            document.getElementById('login-section').style.display = 'none';
            document.getElementById('stats-section').style.display = 'block';
            loadStatsData();
            setupAutoRefresh();
        } else {
            errorDiv.textContent = '密码错误';
        }
    } catch (error) {
        errorDiv.textContent = '验证失败，请重试';
        console.error('验证错误:', error);
    }
});

// 回车登录
document.getElementById('stats-password').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        document.getElementById('login-btn').click();
    }
});

// 手动刷新按钮
document.getElementById('manual-refresh').addEventListener('click', () => {
    loadStatsData();
});

// 自动刷新设置
function setupAutoRefresh() {
    const checkbox = document.getElementById('auto-refresh');

    checkbox.addEventListener('change', () => {
        if (checkbox.checked) {
            // 启动自动刷新（30秒）
            autoRefreshInterval = setInterval(() => {
                loadStatsData();
            }, 30000);
        } else {
            // 停止自动刷新
            if (autoRefreshInterval) {
                clearInterval(autoRefreshInterval);
                autoRefreshInterval = null;
            }
        }
    });
}

// 加载统计数据
async function loadStatsData() {
    try {
        const response = await fetch('/api/stats/data', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: statsPassword })
        });

        if (!response.ok) {
            throw new Error('获取数据失败');
        }

        const stats = await response.json();
        displayStats(stats);

        // 更新最后更新时间
        const now = new Date().toLocaleString('zh-CN');
        document.getElementById('last-update').textContent = `最后更新: ${now}`;
    } catch (error) {
        console.error('加载统计数据错误:', error);
        alert('加载数据失败');
    }
}

// 显示统计数据
function displayStats(stats) {
    // 今日概览
    document.getElementById('today-pv').textContent = stats.todayPV;
    document.getElementById('today-uv').textContent = stats.todayUV;
    document.getElementById('total-logs').textContent = stats.totalLogs;

    // 24小时访问时段分布
    drawHourChart(stats.hourDistribution);

    // 页面访问排行
    displayTopPages(stats.topPages);

    // 设备和浏览器统计
    displayDeviceStats(stats.deviceStats);
    displayBrowserStats(stats.browserStats);

    // 7日趋势表格（反转显示：最久的在上面，最近的在下面）
    const tbody = document.getElementById('trends-tbody');
    tbody.innerHTML = '';
    [...stats.last7Days].reverse().forEach(day => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${day.date}</td>
            <td>${day.pv}</td>
            <td>${day.uv}</td>
        `;
        tbody.appendChild(tr);
    });

    // 7日趋势图表  
    drawTrendsChart(stats.last7Days);

    // 最近访问记录
    const accessList = document.getElementById('recent-access-list');
    accessList.innerHTML = '';
    if (stats.recentLogs.length === 0) {
        accessList.innerHTML = '<div class="no-data">暂无访问记录</div>';
    } else {
        stats.recentLogs.forEach(log => {
            const item = document.createElement('div');
            item.className = 'access-item';
            const time = new Date(log.timestamp).toLocaleString('zh-CN');

            // 解析URL显示歌曲文件名
            let displayUrl = log.url;

            // 处理 /?play=filename 格式
            if (log.url.includes('?play=')) {
                try {
                    const urlObj = new URL(log.url, 'http://localhost');
                    const playParam = urlObj.searchParams.get('play');
                    if (playParam) {
                        displayUrl = playParam; // 只显示文件名，不加emoji
                    }
                } catch (e) {
                    console.error('解析URL失败:', e);
                }
            }
            // 处理 /music/filename 格式
            else if (log.url.startsWith('/music/')) {
                try {
                    const filename = decodeURIComponent(log.url.replace('/music/', ''));
                    displayUrl = filename; // 只显示文件名
                } catch (e) {
                    console.error('解码文件名失败:', e);
                }
            }
            // 其他URL
            else if (log.url === '/') {
                displayUrl = '首页';
            } else if (log.url.startsWith('/s/')) {
                // 显示短链接ID
                const shortId = log.url.replace('/s/', '');
                displayUrl = `/s/${shortId}`; // 不加emoji
                // 异步解析文件名
                resolveShareLink(item, shortId);
            }

            item.innerHTML = `
                <div class="access-time">${time}</div>
                <div class="access-details">
                    <span class="access-ip"><i class="bi bi-geo-alt-fill"></i> ${log.ip}</span>
                    <span class="access-url"><i class="bi bi-link-45deg"></i> ${displayUrl}</span>
                </div>
            `;
            accessList.appendChild(item);
        });
    }
}

// 异步解析短链接ID到文件名（访问记录）
async function resolveShareLink(itemElement, shortId) {
    try {
        const response = await fetch('/api/stats/resolve-share', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: statsPassword, shortId })
        });

        if (response.ok) {
            const data = await response.json();
            if (data.filename) {
                // 更新显示为：/s/abc123 - 歌曲名.mp3
                const urlSpan = itemElement.querySelector('.access-url');
                if (urlSpan) {
                    urlSpan.innerHTML = `<i class="bi bi-link-45deg"></i> /s/${shortId} - ${data.filename}`;
                }
            }
        }
    } catch (error) {
        console.error('解析短链接失败:', error);
    }
}

// 异步解析短链接ID到文件名（页面排行）
async function resolveShareLinkForTopPage(itemElement, shortId) {
    try {
        const response = await fetch('/api/stats/resolve-share', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: statsPassword, shortId })
        });

        if (response.ok) {
            const data = await response.json();
            if (data.filename) {
                // 更新显示
                const nameSpan = itemElement.querySelector('.page-name span');
                if (nameSpan) {
                    nameSpan.textContent = `/s/${shortId} - ${data.filename}`;
                }
            }
        }
    } catch (error) {
        console.error('解析短链接失败:', error);
    }
}

// 绘制24小时时段分布图 - 清晰直观设计
function drawHourChart(hourData) {
    const canvas = document.getElementById('hour-chart');
    const ctx = canvas.getContext('2d');
    const width = canvas.parentElement.clientWidth;
    const height = 180;
    canvas.width = width;
    canvas.height = height;

    const padding = { top: 20, right: 20, bottom: 40, left: 40 };
    const chartWidth = width - padding.left - padding.right;
    const chartHeight = height - padding.top - padding.bottom;
    const barWidth = chartWidth / 24;
    const maxValue = Math.max(...hourData, 1);

    ctx.clearRect(0, 0, width, height);

    // 绘制背景网格线（横向）
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.08)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
        const y = padding.top + (chartHeight / 4) * i;
        ctx.beginPath();
        ctx.moveTo(padding.left, y);
        ctx.lineTo(width - padding.right, y);
        ctx.stroke();

        // Y轴刻度值
        const value = Math.round(maxValue * (1 - i / 4));
        ctx.fillStyle = '#64748b';
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText(value, padding.left - 5, y + 3);
    }

    // 绘制时段背景色块（增强可读性）
    const timePeriods = [
        { start: 0, end: 6, color: 'rgba(100, 116, 139, 0.03)', label: '深夜' },
        { start: 6, end: 12, color: 'rgba(251, 191, 36, 0.05)', label: '上午' },
        { start: 12, end: 18, color: 'rgba(59, 130, 246, 0.05)', label: '下午' },
        { start: 18, end: 24, color: 'rgba(139, 92, 246, 0.05)', label: '晚上' }
    ];

    timePeriods.forEach(period => {
        const startX = padding.left + barWidth * period.start;
        const periodWidth = barWidth * (period.end - period.start);
        ctx.fillStyle = period.color;
        ctx.fillRect(startX, padding.top, periodWidth, chartHeight);

        // 时段标签
        ctx.fillStyle = '#64748b';
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(period.label, startX + periodWidth / 2, padding.top - 5);
    });

    // 绘制柱状图
    hourData.forEach((count, hour) => {
        if (count === 0) return; // 没有数据不画

        const x = padding.left + barWidth * hour;
        const barHeight = (count / maxValue) * chartHeight;
        const y = padding.top + chartHeight - barHeight;

        // 根据时段设置渐变颜色
        let gradient = ctx.createLinearGradient(x, y, x, y + barHeight);

        if (hour >= 0 && hour < 6) {
            // 深夜 - 灰蓝渐变
            gradient.addColorStop(0, '#64748b');
            gradient.addColorStop(1, '#475569');
        } else if (hour >= 6 && hour < 12) {
            // 上午 - 金黄渐变
            gradient.addColorStop(0, '#fbbf24');
            gradient.addColorStop(1, '#f59e0b');
        } else if (hour >= 12 && hour < 18) {
            // 下午 - 蓝色渐变
            gradient.addColorStop(0, '#3b82f6');
            gradient.addColorStop(1, '#2563eb');
        } else {
            // 晚上 - 紫色渐变
            gradient.addColorStop(0, '#8b5cf6');
            gradient.addColorStop(1, '#7c3aed');
        }

        // 绘制圆角柱子
        const radius = 3;
        const actualBarWidth = barWidth - 3;

        ctx.fillStyle = gradient;
        ctx.beginPath();
        if (barHeight > radius) {
            ctx.moveTo(x, y + barHeight);
            ctx.lineTo(x, y + radius);
            ctx.arcTo(x, y, x + radius, y, radius);
            ctx.lineTo(x + actualBarWidth - radius, y);
            ctx.arcTo(x + actualBarWidth, y, x + actualBarWidth, y + radius, radius);
            ctx.lineTo(x + actualBarWidth, y + barHeight);
            ctx.closePath();
        } else {
            ctx.rect(x, y, actualBarWidth, barHeight);
        }
        ctx.fill();

        // 在较高的柱子上显示数值
        if (barHeight > 25) {
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 10px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(count, x + actualBarWidth / 2, y + 14);
        }
    });

    // 绘制X轴时间标签（每2小时显示一次）
    for (let hour = 0; hour < 24; hour += 2) {
        const x = padding.left + barWidth * hour + barWidth / 2;
        ctx.fillStyle = '#94a3b8';
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(hour + ':00', x, height - padding.bottom + 18);

        // 绘制刻度线
        ctx.strokeStyle = 'rgba(148, 163, 184, 0.2)';
        ctx.beginPath();
        ctx.moveTo(x, padding.top + chartHeight);
        ctx.lineTo(x, padding.top + chartHeight + 5);
        ctx.stroke();
    }

    // 绘制坐标轴
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.2)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(padding.left, padding.top);
    ctx.lineTo(padding.left, padding.top + chartHeight);
    ctx.lineTo(width - padding.right, padding.top + chartHeight);
    ctx.stroke();
}

// 显示页面访问排行
function displayTopPages(topPages) {
    const container = document.getElementById('top-pages-list');
    container.innerHTML = '';

    if (topPages.length === 0) {
        container.innerHTML = '<div class="no-data">暂无数据</div>';
        return;
    }

    const maxCount = topPages[0].count;

    topPages.forEach((page, index) => {
        const item = document.createElement('div');
        item.className = 'top-page-item';

        // 解析URL显示文件名
        let displayName = page.url;
        let icon = 'bi-file-earmark';

        // 处理 /?play=filename 格式
        if (page.url.includes('?play=')) {
            try {
                const urlObj = new URL(page.url, 'http://localhost');
                const playParam = urlObj.searchParams.get('play');
                if (playParam) {
                    displayName = playParam;
                    icon = 'bi-music-note-beamed';
                }
            } catch (e) {
                console.error('解析URL失败:', e);
            }
        }
        // 其他URL类型
        else if (page.url === '/') {
            displayName = '首页';
            icon = 'bi-house-fill';
        } else if (page.url.startsWith('/music/')) {
            try {
                const filename = decodeURIComponent(page.url.replace('/music/', ''));
                displayName = filename;
                icon = 'bi-music-note-beamed';
            } catch (e) {
                console.error('解码文件名失败:', e);
            }
        } else if (page.url.startsWith('/s/')) {
            // 显示短链接ID
            const shortId = page.url.replace('/s/', '');
            displayName = `/s/${shortId}`; // 不加emoji
            icon = 'bi-share-fill';
            // 异步解析文件名
            resolveShareLinkForTopPage(item, shortId);
        }

        const percentage = (page.count / maxCount * 100).toFixed(1);

        item.innerHTML = `
            <div class="page-rank">#${index + 1}</div>
            <div class="page-name">
                <i class="bi ${icon}"></i>
                <span>${displayName}</span>
            </div>
            <div class="page-bar">
                <div class="page-bar-fill" style="width: ${percentage}%"></div>
            </div>
            <div class="page-count">${page.count}</div>
        `;
        container.appendChild(item);
    });
}

// 显示设备统计
function displayDeviceStats(deviceStats) {
    const container = document.getElementById('device-stats');
    container.innerHTML = '';

    if (deviceStats.length === 0) {
        container.innerHTML = '<div class="no-data">暂无数据</div>';
        return;
    }

    const total = deviceStats.reduce((sum, item) => sum + item.count, 0);

    deviceStats.forEach(device => {
        const percentage = ((device.count / total) * 100).toFixed(1);
        const item = document.createElement('div');
        item.className = 'stat-bar-item';
        item.innerHTML = `
            <div class="stat-label">${device.name}</div>
            <div class="stat-bar">
                <div class="stat-bar-fill" style="width: ${percentage}%"></div>
            </div>
            <div class="stat-value">${percentage}% (${device.count})</div>
        `;
        container.appendChild(item);
    });
}

// 显示浏览器统计
function displayBrowserStats(browserStats) {
    const container = document.getElementById('browser-stats');
    container.innerHTML = '';

    if (browserStats.length === 0) {
        container.innerHTML = '<div class="no-data">暂无数据</div>';
        return;
    }

    const total = browserStats.reduce((sum, item) => sum + item.count, 0);

    browserStats.forEach(browser => {
        const percentage = ((browser.count / total) * 100).toFixed(1);
        const item = document.createElement('div');
        item.className = 'stat-bar-item';
        item.innerHTML = `
            <div class="stat-label">${browser.name}</div>
            <div class="stat-bar">
                <div class="stat-bar-fill" style="width: ${percentage}%"></div>
            </div>
            <div class="stat-value">${percentage}% (${browser.count})</div>
        `;
        container.appendChild(item);
    });
}

// 绘制7日趋势图 - 现代美观设计
function drawTrendsChart(data) {
    const canvas = document.getElementById('trends-chart');
    const ctx = canvas.getContext('2d');
    const width = canvas.parentElement.clientWidth;
    const height = 220;
    canvas.width = width;
    canvas.height = height;

    const padding = { top: 30, right: 30, bottom: 35, left: 45 };
    const chartWidth = width - padding.left - padding.right;
    const chartHeight = height - padding.top - padding.bottom;

    // 反转数据以匹配表格顺序（图表从左到右：最久→最近）
    const reversedData = [...data].reverse();
    const maxValue = Math.max(...reversedData.map(d => Math.max(d.pv, d.uv)), 1);
    const barGroupWidth = chartWidth / reversedData.length;
    const barWidth = Math.min(barGroupWidth / 2.5, 35); // 限制柱子最大宽度
    const gap = 4; // 柱子间隙

    ctx.clearRect(0, 0, width, height);

    // 绘制背景网格线
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.08)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
        const y = padding.top + (chartHeight / 4) * i;
        ctx.beginPath();
        ctx.moveTo(padding.left, y);
        ctx.lineTo(width - padding.right, y);
        ctx.stroke();

        // Y轴刻度值
        const value = Math.round(maxValue * (1 - i / 4));
        ctx.fillStyle = '#64748b';
        ctx.font = '11px sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText(value, padding.left - 8, y + 4);
    }

    // 绘制每组柱状图
    reversedData.forEach((day, index) => {
        const centerX = padding.left + barGroupWidth * index + barGroupWidth / 2;

        // PV柱 - 紫色渐变
        const pvBarHeight = (day.pv / maxValue) * chartHeight;
        const pvX = centerX - barWidth - gap / 2;
        const pvY = padding.top + chartHeight - pvBarHeight;

        // 创建渐变
        const pvGradient = ctx.createLinearGradient(pvX, pvY, pvX, pvY + pvBarHeight);
        pvGradient.addColorStop(0, '#8b5cf6');
        pvGradient.addColorStop(1, '#6366f1');

        // 绘制圆角柱子
        drawRoundedBar(ctx, pvX, pvY, barWidth, pvBarHeight, 4, pvGradient);

        // UV柱 - 蓝色渐变
        const uvBarHeight = (day.uv / maxValue) * chartHeight;
        const uvX = centerX + gap / 2;
        const uvY = padding.top + chartHeight - uvBarHeight;

        const uvGradient = ctx.createLinearGradient(uvX, uvY, uvX, uvY + uvBarHeight);
        uvGradient.addColorStop(0, '#3b82f6');
        uvGradient.addColorStop(1, '#06b6d4');

        drawRoundedBar(ctx, uvX, uvY, barWidth, uvBarHeight, 4, uvGradient);

        // 在柱子上显示数值（如果高度足够）
        if (pvBarHeight > 20) {
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 11px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(day.pv, pvX + barWidth / 2, pvY + 16);
        }

        if (uvBarHeight > 20) {
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 11px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(day.uv, uvX + barWidth / 2, uvY + 16);
        }

        // 日期标签
        ctx.fillStyle = '#94a3b8';
        ctx.font = '11px sans-serif';
        ctx.textAlign = 'center';
        const dateLabel = day.date.substring(5); // MM-DD
        ctx.fillText(dateLabel, centerX, height - padding.bottom + 20);
    });

    // 绘制坐标轴
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.2)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(padding.left, padding.top);
    ctx.lineTo(padding.left, height - padding.bottom);
    ctx.lineTo(width - padding.right, height - padding.bottom);
    ctx.stroke();

    // 图例 - 移到左上角避免遮挡
    const legendX = padding.left + 10;
    const legendY = 15;

    // PV图例
    const pvLegendGradient = ctx.createLinearGradient(legendX, legendY, legendX, legendY + 14);
    pvLegendGradient.addColorStop(0, '#8b5cf6');
    pvLegendGradient.addColorStop(1, '#6366f1');
    drawRoundedBar(ctx, legendX, legendY, 18, 14, 3, pvLegendGradient);

    ctx.fillStyle = '#cbd5e1';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('访问量(PV)', legendX + 24, legendY + 11);

    // UV图例
    const uvLegendGradient = ctx.createLinearGradient(legendX, legendY + 20, legendX, legendY + 34);
    uvLegendGradient.addColorStop(0, '#3b82f6');
    uvLegendGradient.addColorStop(1, '#06b6d4');
    drawRoundedBar(ctx, legendX, legendY + 20, 18, 14, 3, uvLegendGradient);

    ctx.fillStyle = '#cbd5e1';
    ctx.fillText('独立访客(UV)', legendX + 24, legendY + 31);
}

// 绘制圆角矩形柱状图
function drawRoundedBar(ctx, x, y, width, height, radius, fillStyle) {
    if (height < 1) return; // 太小不画

    ctx.fillStyle = fillStyle;
    ctx.beginPath();

    // 只在顶部做圆角
    if (height > radius) {
        ctx.moveTo(x, y + height);
        ctx.lineTo(x, y + radius);
        ctx.arcTo(x, y, x + radius, y, radius);
        ctx.lineTo(x + width - radius, y);
        ctx.arcTo(x + width, y, x + width, y + radius, radius);
        ctx.lineTo(x + width, y + height);
        ctx.lineTo(x, y + height);
    } else {
        // 高度太小，画普通矩形
        ctx.rect(x, y, width, height);
    }

    ctx.fill();

    // 添加细微阴影
    ctx.shadowColor = 'rgba(0, 0, 0, 0.2)';
    ctx.shadowBlur = 4;
    ctx.shadowOffsetY = 2;
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
}

