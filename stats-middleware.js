const fs = require('fs');
const path = require('path');

// 访问日志文件路径
const musicDir = path.join(__dirname, 'music');
const accessLogsFile = path.join(musicDir, '.access-logs.json');

// 加载访问日志
function loadAccessLogs() {
    try {
        if (fs.existsSync(accessLogsFile)) {
            const data = fs.readFileSync(accessLogsFile, 'utf8');
            return JSON.parse(data);
        }
    } catch (err) {
        console.error('加载访问日志失败:', err);
    }
    return [];
}

// 保存访问日志（异步）
function saveAccessLogs(logs) {
    fs.promises.writeFile(accessLogsFile, JSON.stringify(logs, null, 2), 'utf8')
        .catch(err => console.error('保存访问日志失败:', err));
}

// 判断是否为静态资源请求
function isStaticResource(url) {
    const staticExtensions = [
        '.css', '.js', '.jpg', '.jpeg', '.png', '.gif', '.svg', '.ico',
        '.mp3', '.wav', '.ogg', '.m4a', '.flac', '.aac', '.webm',
        '.woff', '.woff2', '.ttf', '.eot', '.ts', '.m3u8'
    ];

    const parsedUrl = url.split('?')[0]; // 移除查询参数
    return staticExtensions.some(ext => parsedUrl.toLowerCase().endsWith(ext));
}

// 获取客户端真实IP
function getClientIP(req) {
    return req.headers['x-forwarded-for']?.split(',')[0].trim() ||
        req.headers['x-real-ip'] ||
        req.connection.remoteAddress ||
        req.socket.remoteAddress ||
        'unknown';
}

// 提取IPv6前缀（/64网络前缀）用于UV统计
// 解决IPv6隐私扩展导致的同一用户被识别为多个UV的问题
function getIPv6Prefix(ip) {
    if (!ip || ip === 'unknown') return ip;

    // 判断是否为IPv6地址（包含冒号）
    if (ip.includes(':')) {
        // 移除IPv6地址中的压缩表示（::）以便处理
        let expandedIP = ip;

        // 处理IPv4映射的IPv6地址（如 ::ffff:192.168.1.1）
        if (ip.includes('::ffff:')) {
            // 提取IPv4部分
            const ipv4Part = ip.split('::ffff:')[1];
            if (ipv4Part && !ipv4Part.includes(':')) {
                return ipv4Part; // 返回IPv4地址
            }
        }

        // 标准IPv6地址：取前64位（前4段）作为网络前缀
        // 示例：2001:db8:1234:5678::a1b2:c3d4:e5f6 
        //      → 2001:db8:1234:5678::/64
        const parts = expandedIP.split(':');

        // 如果有足够的段，取前4段
        if (parts.length >= 4) {
            return parts.slice(0, 4).join(':') + '::/64';
        }

        // 处理压缩的IPv6地址
        return ip; // 保持原样
    }

    // IPv4地址直接返回
    return ip;
}

// 统计中间件
function statsMiddleware(req, res, next) {
    // 解析URL路径（去除查询参数）
    const urlPath = req.url.split('?')[0];

    // 过滤以下内容：
    // 1. 静态资源
    // 2. 所有 /stats 开头的请求（页面和API）
    // 3. 所有 /api/ 开头的API请求（包括 /api/music 等）
    if (isStaticResource(req.url) ||
        urlPath.startsWith('/stats') ||
        urlPath.startsWith('/api/')) {
        return next();
    }

    // 记录访问信息
    const logEntry = {
        ip: getClientIP(req),
        timestamp: new Date().toISOString(),
        url: req.url,
        method: req.method,
        userAgent: req.headers['user-agent'] || 'unknown'
    };

    // 异步保存日志（不阻塞请求）
    setImmediate(() => {
        const logs = loadAccessLogs();
        logs.push(logEntry);

        // 只保留最近30天的日志
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        const filteredLogs = logs.filter(log => new Date(log.timestamp) > thirtyDaysAgo);

        saveAccessLogs(filteredLogs);
    });

    next();
}

// 解析User Agent获取设备和浏览器信息
function parseUserAgent(ua) {
    let device = 'Unknown';
    let browser = 'Unknown';

    // 设备检测
    if (/Android/i.test(ua)) {
        device = 'Android';
    } else if (/iPad|iPhone|iPod/i.test(ua)) {
        device = 'iOS';
    } else if (/Windows NT/i.test(ua)) {
        device = 'Windows';
    } else if (/Macintosh|Mac OS X/i.test(ua)) {
        device = 'Mac';
    } else if (/Linux/i.test(ua)) {
        device = 'Linux';
    }

    // 浏览器检测
    if (/Edg\//i.test(ua)) {
        browser = 'Edge';
    } else if (/Chrome/i.test(ua) && !/Edg/i.test(ua)) {
        browser = 'Chrome';
    } else if (/Safari/i.test(ua) && !/Chrome/i.test(ua)) {
        browser = 'Safari';
    } else if (/Firefox/i.test(ua)) {
        browser = 'Firefox';
    } else if (/MSIE|Trident/i.test(ua)) {
        browser = 'IE';
    }

    return { device, browser };
}

// 获取统计数据
function getStats(startDate = null, endDate = null) {
    const logs = loadAccessLogs();
    const now = new Date();

    // 如果没有指定日期范围，使用今天
    const filterStart = startDate ? new Date(startDate) : new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const filterEnd = endDate ? new Date(endDate) : new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

    // 今日零点时间
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    // 今日日志
    const todayLogs = logs.filter(log => new Date(log.timestamp) >= todayStart);

    // 今日PV
    const todayPV = todayLogs.length;

    // 今日UV（使用IPv6前缀去重，解决隐私扩展问题）
    const todayIPs = new Set(todayLogs.map(log => getIPv6Prefix(log.ip)));
    const todayUV = todayIPs.size;

    // 近7天每日统计（倒序：最近→最久）
    const last7Days = [];
    for (let i = 0; i < 7; i++) {
        const dayStart = new Date(now);
        dayStart.setDate(dayStart.getDate() - i);
        dayStart.setHours(0, 0, 0, 0);

        const dayEnd = new Date(dayStart);
        dayEnd.setHours(23, 59, 59, 999);

        const dayLogs = logs.filter(log => {
            const logDate = new Date(log.timestamp);
            return logDate >= dayStart && logDate <= dayEnd;
        });

        // 使用IPv6前缀计算UV
        const dayIPs = new Set(dayLogs.map(log => getIPv6Prefix(log.ip)));

        last7Days.push({
            date: dayStart.toISOString().split('T')[0],
            pv: dayLogs.length,
            uv: dayIPs.size
        });
    }

    // 24小时时段分布
    const hourDistribution = Array(24).fill(0);
    todayLogs.forEach(log => {
        const hour = new Date(log.timestamp).getHours();
        hourDistribution[hour]++;
    });

    // 页面访问排行（Top 10）
    const pageCount = {};
    logs.forEach(log => {
        const url = log.url;
        // 过滤掉不应该显示的URL
        const urlPath = url.split('?')[0];

        // 排除：统计页面、API调用
        if (urlPath.startsWith('/stats') ||
            urlPath.startsWith('/api/stats') ||
            urlPath.startsWith('/api/')) {
            return; // 跳过这些URL
        }

        pageCount[url] = (pageCount[url] || 0) + 1;
    });
    const topPages = Object.entries(pageCount)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([url, count]) => ({ url, count }));

    // 设备统计
    const deviceCount = {};
    const browserCount = {};
    logs.forEach(log => {
        const { device, browser } = parseUserAgent(log.userAgent);
        deviceCount[device] = (deviceCount[device] || 0) + 1;
        browserCount[browser] = (browserCount[browser] || 0) + 1;
    });

    // 转换为数组并排序
    const deviceStats = Object.entries(deviceCount)
        .sort((a, b) => b[1] - a[1])
        .map(([name, count]) => ({ name, count }));

    const browserStats = Object.entries(browserCount)
        .sort((a, b) => b[1] - a[1])
        .map(([name, count]) => ({ name, count }));

    // 最近访问记录（取最新20条）
    const recentLogs = logs
        .slice(-20)
        .reverse()
        .map(log => ({
            ip: log.ip,
            timestamp: log.timestamp,
            url: log.url,
            userAgent: log.userAgent
        }));

    return {
        todayPV,
        todayUV,
        last7Days,
        hourDistribution,
        topPages,
        deviceStats,
        browserStats,
        recentLogs,
        totalLogs: logs.length
    };
}

module.exports = {
    statsMiddleware,
    getStats
};
